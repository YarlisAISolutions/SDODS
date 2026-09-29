/**
 * Votes, accepted answers and reputation: the rules, as pure functions.
 *
 * Both stores (Firestore and in-memory) read the current state, ask these functions what changes,
 * and write exactly that — inside one transaction in Firestore. So the rules live here once, the
 * tests exercise them directly, and a store cannot drift from them.
 *
 * The numbers follow Stack Overflow's: +10 for an upvoted question or answer, −2 for a downvoted
 * one, −1 to the voter for downvoting an answer, +15 for an accepted answer and +2 to the asker who
 * accepts it. Reputation never goes below 1. A vote changed or withdrawn is fully reversed.
 */

export const REP = {
  upvoted: 10,
  downvoted: -2,
  downvoterOnAnswer: -1,
  accepted: 15,
  acceptor: 2,
  floor: 1,
} as const;

export type VoteValue = -1 | 0 | 1;
export type PostKind = 'question' | 'answer';

export interface RepChange {
  uid: string;
  delta: number;
  reason: RepReason;
}

export type RepReason =
  | 'upvoted'
  | 'downvoted'
  | 'downvoted-answer'
  | 'accepted'
  | 'accepted-an-answer'
  | 'vote-undone'
  | 'accept-undone';

/** The effect of one vote value, before it is compared with the previous one. */
function effect(
  kind: PostKind,
  value: VoteValue,
): { score: number; author: number; voter: number } {
  if (value === 1) return { score: 1, author: REP.upvoted, voter: 0 };
  if (value === -1)
    return {
      score: -1,
      author: REP.downvoted,
      voter: kind === 'answer' ? REP.downvoterOnAnswer : 0,
    };
  return { score: 0, author: 0, voter: 0 };
}

export interface VotePlan {
  scoreDelta: number;
  rep: RepChange[];
}

/**
 * What changes when `voter` moves their vote on a post from `from` to `to`. The author may be
 * unknown (posts from before sign-in existed): the score still moves, reputation does not.
 */
export function planVote(p: {
  kind: PostKind;
  authorUid: string | null;
  voterUid: string;
  from: VoteValue;
  to: VoteValue;
}): VotePlan {
  const before = effect(p.kind, p.from);
  const after = effect(p.kind, p.to);
  const rep: RepChange[] = [];
  const reason: RepReason = p.to === 1 ? 'upvoted' : p.to === -1 ? 'downvoted' : 'vote-undone';
  const authorDelta = after.author - before.author;
  const voterDelta = after.voter - before.voter;
  if (p.authorUid && authorDelta) rep.push({ uid: p.authorUid, delta: authorDelta, reason });
  if (voterDelta)
    rep.push({
      uid: p.voterUid,
      delta: voterDelta,
      reason: p.to === -1 ? 'downvoted-answer' : 'vote-undone',
    });
  return { scoreDelta: after.score - before.score, rep };
}

/**
 * What changes when the asker marks `to` as the accepted answer (or clears it with null), replacing
 * `from`. No reputation for accepting your own answer, as on Stack Overflow.
 */
export function planAccept(p: {
  askerUid: string;
  from: { answerId: string; authorUid: string | null } | null;
  to: { answerId: string; authorUid: string | null } | null;
}): RepChange[] {
  if ((p.from?.answerId ?? null) === (p.to?.answerId ?? null)) return [];
  const rep: RepChange[] = [];
  const earns = (author: string | null): author is string => !!author && author !== p.askerUid;

  if (p.from && earns(p.from.authorUid))
    rep.push({ uid: p.from.authorUid, delta: -REP.accepted, reason: 'accept-undone' });
  if (p.to && earns(p.to.authorUid))
    rep.push({ uid: p.to.authorUid, delta: REP.accepted, reason: 'accepted' });

  // The asker's +2 is for having an accepted answer from someone else, not per change of mind.
  const had = !!p.from && earns(p.from.authorUid);
  const has = !!p.to && earns(p.to.authorUid);
  if (has && !had) rep.push({ uid: p.askerUid, delta: REP.acceptor, reason: 'accepted-an-answer' });
  if (had && !has) rep.push({ uid: p.askerUid, delta: -REP.acceptor, reason: 'accept-undone' });
  return rep;
}

/** Sums changes per user, so a user touched twice in one plan is written once. */
export function netRep(changes: RepChange[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of changes) out.set(c.uid, (out.get(c.uid) ?? 0) + c.delta);
  for (const [uid, d] of out) if (d === 0) out.delete(uid);
  return out;
}

export const applyFloor = (rep: number, delta: number) => Math.max(REP.floor, rep + delta);

export interface Privileges {
  upvote: number;
  downvote: number;
}

/** Stack Overflow's thresholds. Editors and admins are exempt. */
export const DEFAULT_PRIVILEGES: Privileges = { upvote: 15, downvote: 125 };

export function canVote(
  value: VoteValue,
  rep: number,
  role: 'member' | 'editor' | 'admin',
  p: Privileges = DEFAULT_PRIVILEGES,
): { ok: true } | { ok: false; need: number } {
  if (value === 0 || role !== 'member') return { ok: true };
  const need = value === 1 ? p.upvote : p.downvote;
  return rep >= need ? { ok: true } : { ok: false, need };
}
