/**
 * Where posts, reviews, users and the spend counter live.
 *
 * CommunityStore is the port; MemoryStore below keeps everything in the process (tests, local
 * development, a single-instance self-host). A deployment passes its own implementation to
 * buildCommunityServer — sdods.com's is the Firestore one in ./firebase/.
 *
 * Paths name documents in a tree (`questions/{id}/answers/{id}`, `users/{uid}`, `votes/{id}`), and
 * a Write replaces a document or, with `mask`, updates only those fields. Any document or
 * key-value store with atomic multi-document transactions can implement it.
 *
 * Posts keep the fields the site already renders (`name`, `title`, `body`, `category`, `status`,
 * `createdAt`, and `parentId` on answers), so questions posted through this service and the ones
 * posted before it look the same. What is new rides alongside: `uid`, `score`, and a short
 * `review` summary. The full verdict, token counts included, goes to `communityReviews`.
 */

import { randomInt } from 'node:crypto';
import type { Role } from './auth.js';
import { votePath, type Doc, type Transact, type Write } from './engagement.js';
import type { VoteValue } from './reputation.js';
import type { Decision, ReviewCall, Signals } from './review.js';

export type PostStatus = 'published' | 'pending' | 'rejected';

/** Where a post goes. Archive threads are the static pages; their answers live in threadAnswers. */
export type Target =
  | { kind: 'question' }
  | { kind: 'answer'; questionId: string; parentId: string }
  | { kind: 'threadAnswer'; slug: string; parentId: string };

export interface ReviewSummary {
  decision: Decision;
  /** Who decided: the reviewer model, or an editor's uid. */
  by: string;
  relevance: Signals['relevance'] | null;
  confidence: number | null;
  reason: string;
  notes: string[];
}

export interface NewPost {
  uid: string;
  name: string;
  title?: string;
  category?: string;
  body: string;
  status: PostStatus;
  review: ReviewSummary;
  /** Names of the credential patterns masked out of the body. */
  redacted: string[];
}

export interface ReviewLog {
  path: string;
  uid: string;
  kind: 'question' | 'answer';
  decision: Decision;
  calls: Array<Omit<ReviewCall, 'usage'> & { usage?: UsageTotals }>;
  costUsd: number;
  redacted: string[];
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface QueueItem {
  path: string;
  kind: 'question' | 'answer' | 'threadAnswer';
  title: string | null;
  body: string;
  name: string;
  uid: string | null;
  createdAt: string | null;
  review: Partial<ReviewSummary> | null;
  /** The question or archive slug an answer belongs to. */
  parent: string | null;
}

export interface PendingEdit {
  id: string;
  post: string;
  baseRevision: number;
  title: string | null;
  body: string;
  by: string;
  byName: string;
  comment: string;
  createdAt: string | null;
}

export function toPendingEdit(
  id: string,
  f: Record<string, unknown>,
  createdAt: string | null,
): PendingEdit {
  return {
    id,
    post: String(f.post ?? ''),
    baseRevision: typeof f.baseRevision === 'number' ? f.baseRevision : 0,
    title: typeof f.title === 'string' ? f.title : null,
    body: String(f.body ?? ''),
    by: String(f.by ?? ''),
    byName: String(f.byName ?? ''),
    comment: String(f.comment ?? ''),
    createdAt,
  };
}

export interface UserRecord {
  uid: string;
  display: string;
  firstSeen: Date;
}

// What the site reads. Only published posts, only public fields; dates are ISO strings.

export interface PublicAnswer {
  id: string;
  uid: string | null;
  score: number;
  revision: number;
  body: string;
  name: string;
  /** Empty for an answer to the question; otherwise the answer this replies to. */
  parentId: string;
  createdAt: string | null;
}

export interface PublicQuestion {
  id: string;
  uid: string | null;
  score: number;
  revision: number;
  acceptedAnswerId: string | null;
  title: string;
  body: string;
  name: string;
  category: string;
  createdAt: string | null;
  /** Published answers and replies, oldest first. */
  answers: PublicAnswer[];
}

export interface PublicProfile {
  rep: number;
  role: string;
  display: string;
  badges: Array<{ id: string; tier: 'gold' | 'silver' | 'bronze'; post?: string; at: string }>;
}

export interface PublicRevision {
  revision: number;
  title: string | null;
  body: string;
  byName: string;
  comment: string;
  createdAt: string | null;
}

/** A feature request or bug report from the site, or a "was this page helpful?" click. */
export type Feedback =
  | {
      type: 'site';
      kind: 'feature' | 'bug' | 'feedback';
      title: string;
      body: string;
      name: string;
      email: string;
    }
  | { type: 'page'; path: string; title: string; verdict: 'helpful' | 'not-helpful'; note: string };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
const orNull = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function toPublicAnswer(
  id: string,
  f: Record<string, unknown>,
  createdAt: string | null,
): PublicAnswer {
  return {
    id,
    uid: orNull(f.uid),
    score: num(f.score, 0),
    revision: num(f.revision, 0),
    body: str(f.body),
    name: str(f.name),
    parentId: str(f.parentId),
    createdAt,
  };
}

export function toPublicQuestion(
  id: string,
  f: Record<string, unknown>,
  createdAt: string | null,
  answers: PublicAnswer[],
): PublicQuestion {
  return {
    id,
    uid: orNull(f.uid),
    score: num(f.score, 0),
    revision: num(f.revision, 0),
    acceptedAnswerId: orNull(f.acceptedAnswerId),
    title: str(f.title),
    body: str(f.body),
    name: str(f.name),
    category: str(f.category) || 'other',
    createdAt,
    answers,
  };
}

export function toPublicProfile(f: Record<string, unknown>): PublicProfile {
  const badges = (Array.isArray(f.badges) ? f.badges : []).filter(
    (b): b is PublicProfile['badges'][number] =>
      Boolean(b) && typeof (b as { id?: unknown }).id === 'string',
  );
  return {
    rep: num(f.rep, 1),
    role: str(f.role) || 'member',
    display: str(f.display) || 'SDODS user',
    badges,
  };
}

export function toPublicRevision(
  f: Record<string, unknown>,
  createdAt: string | null,
): PublicRevision {
  return {
    revision: num(f.revision, 0),
    title: orNull(f.title),
    body: str(f.body),
    byName: str(f.byName),
    comment: str(f.comment),
    createdAt,
  };
}

/** The document a feedback row is stored as, with the fields the old browser path wrote. */
export function feedbackRecord(f: Feedback): {
  collection: string;
  fields: Record<string, unknown>;
} {
  const { type, ...fields } = f;
  return {
    collection: type === 'site' ? 'feedback' : 'pageFeedback',
    fields: { ...fields, status: 'new' },
  };
}

export interface CommunityStore {
  /** Creates the user's public profile on first sight; returns when they were first seen. */
  ensureUser(u: {
    uid: string;
    name: string;
    picture: string | null;
    provider: string;
  }): Promise<UserRecord>;
  /** A live question, or null when there is none or it is not published. */
  publishedQuestion(id: string): Promise<{ title: string; body: string } | null>;
  createPost(target: Target, post: NewPost): Promise<string>;
  saveReview(log: ReviewLog): Promise<void>;
  queue(): Promise<QueueItem[]>;
  /** Returns false when there is no pending post at that path. */
  resolve(path: string, status: 'published' | 'rejected', review: ReviewSummary): Promise<boolean>;
  /** Mirrors a role onto the user's public profile (the grant itself is RoleClaims, in auth.ts). */
  setRole(uid: string, role: Role): Promise<void>;
  spentToday(day: string): Promise<number>;
  addSpend(day: string, usd: number): Promise<void>;
  /** Runs reads and commits the returned writes atomically (see engagement.ts). */
  transact: Transact;
  /** A user's reputation; 1 for someone with no profile yet. */
  userRep(uid: string): Promise<number>;
  /** Suggested edits waiting for an editor, oldest first. */
  pendingEdits(): Promise<PendingEdit[]>;
  /** The user's current votes on these posts; posts they have not voted on are absent. */
  myVotes(uid: string, paths: string[]): Promise<Record<string, VoteValue>>;

  /** Published questions, newest first, each with its published answers. */
  publishedQuestions(limit: number): Promise<PublicQuestion[]>;
  /** One published question with its published answers; null when missing or not published. */
  questionThread(id: string): Promise<PublicQuestion | null>;
  /** Published answers on a static archive thread, oldest first. */
  threadAnswers(slug: string): Promise<PublicAnswer[]>;
  /** Public profiles for these users; users with no profile are absent. */
  profiles(uids: string[]): Promise<Record<string, PublicProfile>>;
  /** A post's applied revisions, oldest first. */
  revisions(path: string): Promise<PublicRevision[]>;
  /** Stores feedback for the moderator; it is never shown on the site. */
  saveFeedback(f: Feedback): Promise<void>;
}

/** A document path the service writes: guards every path that arrives from a browser. */
export const POST_PATH =
  /^(?:questions\/[A-Za-z0-9]{1,40}(?:\/answers\/[A-Za-z0-9]{1,40})?|threadAnswers\/[A-Za-z0-9]{1,40})$/;

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A 20-character id in the same alphabet Firestore uses for its own auto ids. */
export function newId(): string {
  let id = '';
  for (let i = 0; i < 20; i++) id += ID_CHARS[randomInt(ID_CHARS.length)];
  return id;
}

export function collectionOf(target: Target): string {
  switch (target.kind) {
    case 'question':
      return 'questions';
    case 'answer':
      return `questions/${target.questionId}/answers`;
    case 'threadAnswer':
      return 'threadAnswers';
  }
}

export function fieldsFor(target: Target, p: NewPost): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: p.name,
    body: p.body,
    status: p.status,
    uid: p.uid,
    score: 0,
    review: { ...p.review },
    redacted: p.redacted,
  };
  if (target.kind === 'question') return { ...base, title: p.title, category: p.category };
  if (target.kind === 'answer') return { ...base, parentId: target.parentId };
  return { ...base, slug: target.slug, parentId: target.parentId };
}

// ---------------------------------------------------------------------------------------------
// In memory

interface MemDoc {
  fields: Record<string, unknown>;
  createdAt: Date;
}

export class MemoryStore implements CommunityStore {
  readonly docs = new Map<string, MemDoc>();
  readonly users = new Map<
    string,
    UserRecord & { role?: Role; rep?: number; badges?: unknown[] }
  >();
  readonly reviews: ReviewLog[] = [];
  readonly spend = new Map<string, number>();
  private seq = 0;

  async ensureUser(u: { uid: string; name: string }): Promise<UserRecord> {
    const found = this.users.get(u.uid);
    if (found) return found;
    const rec = { uid: u.uid, display: u.name, firstSeen: new Date() };
    this.users.set(u.uid, rec);
    return rec;
  }
  async publishedQuestion(id: string) {
    const d = this.docs.get(`questions/${id}`);
    if (!d || d.fields.status !== 'published') return null;
    return { title: String(d.fields.title), body: String(d.fields.body) };
  }
  async createPost(target: Target, post: NewPost): Promise<string> {
    const path = `${collectionOf(target)}/m${++this.seq}`;
    this.docs.set(path, { fields: fieldsFor(target, post), createdAt: new Date() });
    return path;
  }
  async saveReview(log: ReviewLog) {
    this.reviews.push(log);
  }
  async queue(): Promise<QueueItem[]> {
    return [...this.docs.entries()]
      .filter(([, d]) => d.fields.status === 'pending')
      .map(([path, d]) => toQueueItem(path, d.fields, d.createdAt.toISOString()));
  }
  async resolve(path: string, status: 'published' | 'rejected', review: ReviewSummary) {
    const d = this.docs.get(path);
    if (!d || d.fields.status !== 'pending') return false;
    d.fields.status = status;
    d.fields.review = { ...review };
    return true;
  }
  async setRole(uid: string, role: Role) {
    const u = this.users.get(uid) ?? { uid, display: uid, firstSeen: new Date() };
    this.users.set(uid, { ...u, role });
  }
  async spentToday(day: string) {
    return this.spend.get(day) ?? 0;
  }
  async addSpend(day: string, usd: number) {
    this.spend.set(day, (this.spend.get(day) ?? 0) + usd);
  }

  private read(path: string): Doc | null {
    if (path.startsWith('users/')) {
      const u = this.users.get(path.slice(6));
      return u
        ? { rep: u.rep ?? 1, role: u.role ?? 'member', display: u.display, badges: u.badges ?? [] }
        : null;
    }
    const d = this.docs.get(path);
    return d ? { ...d.fields } : null;
  }

  transact: Transact = async (fn) => {
    const { writes, result } = await fn(async (path) => this.read(path));
    for (const w of writes) this.write(w);
    return result;
  };

  private write(w: Write) {
    if (w.path.startsWith('users/')) {
      const uid = w.path.slice(6);
      const u = this.users.get(uid) ?? { uid, display: uid, firstSeen: new Date() };
      this.users.set(uid, { ...u, ...(w.fields as { rep?: number }) });
      return;
    }
    const d = this.docs.get(w.path);
    if (d && w.mask) Object.assign(d.fields, w.fields);
    else this.docs.set(w.path, { fields: { ...w.fields }, createdAt: d?.createdAt ?? new Date() });
  }

  async userRep(uid: string) {
    return this.users.get(uid)?.rep ?? 1;
  }

  async pendingEdits(): Promise<PendingEdit[]> {
    return [...this.docs.entries()]
      .filter(([p, d]) => p.startsWith('revisions/') && d.fields.status === 'pending')
      .map(([p, d]) =>
        toPendingEdit(p.slice('revisions/'.length), d.fields, d.createdAt.toISOString()),
      );
  }

  async myVotes(uid: string, paths: string[]) {
    const out: Record<string, VoteValue> = {};
    for (const p of paths) {
      const v = this.docs.get(votePath(uid, p))?.fields.value;
      if (v === 1 || v === -1) out[p] = v;
    }
    return out;
  }

  /** Published documents directly under `prefix` (no deeper paths), with their ids. */
  private published(prefix: string, where: (f: Record<string, unknown>) => boolean = () => true) {
    return [...this.docs.entries()]
      .filter(([p, d]) => {
        const rest = p.startsWith(prefix) ? p.slice(prefix.length) : '';
        return rest && !rest.includes('/') && d.fields.status === 'published' && where(d.fields);
      })
      .map(([p, d]) => ({ id: p.slice(prefix.length), fields: d.fields, at: d.createdAt }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private thread(id: string, fields: Record<string, unknown>, at: Date): PublicQuestion {
    const answers = this.published(`questions/${id}/answers/`).map((a) =>
      toPublicAnswer(a.id, a.fields, a.at.toISOString()),
    );
    return toPublicQuestion(id, fields, at.toISOString(), answers);
  }

  async publishedQuestions(limit: number) {
    return this.published('questions/')
      .reverse()
      .slice(0, limit)
      .map((q) => this.thread(q.id, q.fields, q.at));
  }

  async questionThread(id: string) {
    const d = this.docs.get(`questions/${id}`);
    return d && d.fields.status === 'published' ? this.thread(id, d.fields, d.createdAt) : null;
  }

  async threadAnswers(slug: string) {
    return this.published('threadAnswers/', (f) => f.slug === slug).map((a) =>
      toPublicAnswer(a.id, a.fields, a.at.toISOString()),
    );
  }

  async profiles(uids: string[]) {
    const out: Record<string, PublicProfile> = {};
    for (const uid of uids) {
      const u = this.read(`users/${uid}`);
      if (u) out[uid] = toPublicProfile(u);
    }
    return out;
  }

  async revisions(path: string) {
    return [...this.docs.entries()]
      .filter(([p, d]) => p.startsWith('revisions/') && d.fields.post === path)
      .filter(([, d]) => d.fields.status === 'applied')
      .map(([, d]) => toPublicRevision(d.fields, d.createdAt.toISOString()))
      .sort((a, b) => a.revision - b.revision);
  }

  async saveFeedback(f: Feedback) {
    const { collection, fields } = feedbackRecord(f);
    this.docs.set(`${collection}/m${++this.seq}`, { fields, createdAt: new Date() });
  }
}

export function toQueueItem(
  path: string,
  f: Record<string, unknown>,
  createdAt: string | null,
): QueueItem {
  const kind: QueueItem['kind'] = path.startsWith('threadAnswers/')
    ? 'threadAnswer'
    : path.includes('/answers/')
      ? 'answer'
      : 'question';
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    path,
    kind,
    title: str(f.title),
    body: str(f.body) ?? '',
    name: str(f.name) ?? '',
    uid: str(f.uid),
    createdAt,
    review: (f.review as Partial<ReviewSummary> | undefined) ?? null,
    parent: kind === 'answer' ? path.split('/')[1]! : kind === 'threadAnswer' ? str(f.slug) : null,
  };
}
