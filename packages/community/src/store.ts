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
