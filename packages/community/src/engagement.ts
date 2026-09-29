/**
 * Voting and accepting answers, on top of a store's transaction primitive.
 *
 * Each operation reads the documents it depends on, asks reputation.ts what changes, and returns the
 * writes; the store commits them atomically (a Firestore transaction retries the whole function if
 * any document it read changed underneath it). The vote document, the post's score, every affected
 * user's reputation and badges, and the reputation history all move together or not at all.
 */

import { forAccepting, forScore, forVoting, readBadges, type Awarded } from './badges.js';
import {
  applyFloor,
  netRep,
  planAccept,
  planVote,
  REP,
  type PostKind,
  type RepChange,
  type VoteValue,
} from './reputation.js';

export type Doc = Record<string, unknown>;

export interface Write {
  path: string;
  fields: Doc;
  /** Update only these fields (the document is created if missing). Omitted: replace the document. */
  mask?: string[];
}

/** Reads inside the transaction; the callback returns the writes to commit. */
export type Transact = <T>(
  fn: (get: (path: string) => Promise<Doc | null>) => Promise<{ writes: Write[]; result: T }>,
) => Promise<T>;

export type VoteOutcome =
  | { ok: true; score: number; value: VoteValue }
  | { ok: false; error: 'not_found' | 'own_post' | 'not_votable' };

export type AcceptOutcome =
  | { ok: true; acceptedAnswerId: string | null }
  | { ok: false; error: 'not_found' | 'not_owner' | 'not_answer' };

/** One vote per user per post, at a deterministic id: re-voting overwrites instead of duplicating. */
export const votePath = (uid: string, postPath: string) =>
  `votes/${uid}__${postPath.replaceAll('/', '~')}`;

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const kindOf = (path: string): PostKind =>
  /^questions\/[^/]+$/.test(path) ? 'question' : 'answer';

/** Computes the badges a user newly earns, given the ones they already hold. */
export type Awarder = { uid: string; award: (have: Awarded[]) => Awarded[] };

/**
 * Writes to users for a set of reputation changes and badge awards: reputation floored at 1, new
 * badges appended, each user read once. Reputation history rows go to repEvents.
 */
export async function userWrites(
  get: (path: string) => Promise<Doc | null>,
  changes: RepChange[],
  awarders: Awarder[],
  context: { path: string; by: string; at: Date },
  newId: () => string,
): Promise<Write[]> {
  const writes: Write[] = [];
  const deltas = netRep(changes);
  const uids = new Set([...deltas.keys(), ...awarders.map((a) => a.uid)]);
  for (const uid of uids) {
    const user = await get(`users/${uid}`);
    const fields: Doc = {};
    const delta = deltas.get(uid);
    if (delta) fields.rep = applyFloor(num(user?.rep, REP.floor), delta);
    const have = readBadges(user?.badges);
    const earned: Awarded[] = [];
    for (const a of awarders.filter((x) => x.uid === uid))
      earned.push(...a.award([...have, ...earned]));
    if (earned.length) fields.badges = [...have, ...earned];
    const mask = Object.keys(fields);
    if (mask.length) writes.push({ path: `users/${uid}`, fields, mask });
  }
  for (const c of changes)
    writes.push({
      path: `repEvents/${newId()}`,
      fields: {
        uid: c.uid,
        delta: c.delta,
        reason: c.reason,
        post: context.path,
        by: context.by,
        at: context.at,
      },
    });
  return writes;
}

export async function castVote(
  transact: Transact,
  newId: () => string,
  v: { uid: string; path: string; value: VoteValue },
  now = new Date(),
): Promise<VoteOutcome> {
  return transact<VoteOutcome>(async (get) => {
    const post = await get(v.path);
    if (!post || post.status !== 'published')
      return { writes: [], result: { ok: false, error: 'not_found' } };
    // Replies are conversation, not answers: they are not scored, as comments are not on Stack Overflow.
    if (str(post.parentId)) return { writes: [], result: { ok: false, error: 'not_votable' } };
    const author = str(post.uid);
    if (author === v.uid) return { writes: [], result: { ok: false, error: 'own_post' } };

    const vp = votePath(v.uid, v.path);
    const existing = await get(vp);
    const from = (num(existing?.value, 0) as VoteValue) ?? 0;
    const score = num(post.score, 0);
    if (from === v.value) return { writes: [], result: { ok: true, score, value: v.value } };

    const plan = planVote({
      kind: kindOf(v.path),
      authorUid: author,
      voterUid: v.uid,
      from,
      to: v.value,
    });
    const newScore = score + plan.scoreDelta;
    const kind = kindOf(v.path);
    // An answer's accepted state feeds the Guru badge; archive-thread answers are never accepted.
    const qMatch = /^(questions\/[^/]+)\/answers\/([^/]+)$/.exec(v.path);
    const accepted = qMatch ? str((await get(qMatch[1]!))?.acceptedAnswerId) === qMatch[2] : false;
    const awarders: Awarder[] = [
      { uid: v.uid, award: (have) => forVoting(v.value, have, now) },
      ...(author
        ? [
            {
              uid: author,
              award: (have: Awarded[]) =>
                forScore({ kind, score: newScore, accepted, post: v.path, have, at: now }),
            },
          ]
        : []),
    ];
    const writes: Write[] = [
      { path: v.path, fields: { score: newScore }, mask: ['score'] },
      { path: vp, fields: { uid: v.uid, post: v.path, value: v.value, at: now } },
      ...(await userWrites(get, plan.rep, awarders, { path: v.path, by: v.uid, at: now }, newId)),
    ];
    return { writes, result: { ok: true, score: newScore, value: v.value } };
  });
}

export async function acceptAnswer(
  transact: Transact,
  newId: () => string,
  a: { uid: string; questionId: string; answerId: string | null },
  now = new Date(),
): Promise<AcceptOutcome> {
  return transact<AcceptOutcome>(async (get) => {
    const qPath = `questions/${a.questionId}`;
    const q = await get(qPath);
    if (!q || q.status !== 'published')
      return { writes: [], result: { ok: false, error: 'not_found' } };
    if (str(q.uid) !== a.uid) return { writes: [], result: { ok: false, error: 'not_owner' } };

    const load = async (id: string | null) => {
      if (!id) return null;
      const d = await get(`${qPath}/answers/${id}`);
      if (!d || d.status !== 'published' || str(d.parentId)) return undefined;
      return { answerId: id, authorUid: str(d.uid) };
    };
    const to = await load(a.answerId);
    if (to === undefined) return { writes: [], result: { ok: false, error: 'not_answer' } };
    // A previously accepted answer that has since gone still has its reputation reversed.
    const fromId = str(q.acceptedAnswerId);
    const fromDoc = fromId ? await get(`${qPath}/answers/${fromId}`) : null;
    const from = fromId ? { answerId: fromId, authorUid: str(fromDoc?.uid) } : null;

    const changes = planAccept({ askerUid: a.uid, from, to });
    const awarders: Awarder[] = [];
    if (to && to.authorUid && to.authorUid !== a.uid) {
      awarders.push({ uid: a.uid, award: (have) => forAccepting(have, now) });
      const answerPath = `${qPath}/answers/${to.answerId}`;
      const score = num((await get(answerPath))?.score, 0);
      awarders.push({
        uid: to.authorUid,
        award: (have) =>
          forScore({ kind: 'answer', score, accepted: true, post: answerPath, have, at: now }),
      });
    }
    const writes: Write[] = [
      { path: qPath, fields: { acceptedAnswerId: a.answerId ?? '' }, mask: ['acceptedAnswerId'] },
      ...(await userWrites(get, changes, awarders, { path: qPath, by: a.uid, at: now }, newId)),
    ];
    return { writes, result: { ok: true, acceptedAnswerId: a.answerId } };
  });
}
