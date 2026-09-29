/**
 * Where posts, reviews, users and the spend counter live.
 *
 * Production writes to Firestore through its REST API with the Cloud Run service account's token,
 * as Maxi does, so the image needs no Firebase SDK. Server writes bypass security rules; the rules
 * give browsers read access to published posts only.
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
  setRole(uid: string, role: Role): Promise<void>;
  spentToday(day: string): Promise<number>;
  addSpend(day: string, usd: number): Promise<void>;
  /** Runs reads and commits the returned writes atomically (see engagement.ts). */
  transact: Transact;
  /** A user's reputation; 1 for someone with no profile yet. */
  userRep(uid: string): Promise<number>;
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

function collectionOf(target: Target): string {
  switch (target.kind) {
    case 'question':
      return 'questions';
    case 'answer':
      return `questions/${target.questionId}/answers`;
    case 'threadAnswer':
      return 'threadAnswers';
  }
}

function fieldsFor(target: Target, p: NewPost): Record<string, unknown> {
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
  readonly users = new Map<string, UserRecord & { role?: Role; rep?: number }>();
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
      return u ? { rep: u.rep ?? 1, role: u.role ?? 'member', display: u.display } : null;
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

  async myVotes(uid: string, paths: string[]) {
    const out: Record<string, VoteValue> = {};
    for (const p of paths) {
      const v = this.docs.get(votePath(uid, p))?.fields.value;
      if (v === 1 || v === -1) out[p] = v;
    }
    return out;
  }
}

function toQueueItem(
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

// ---------------------------------------------------------------------------------------------
// Firestore over REST

type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

function toValue(v: unknown): FsValue {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object')
    return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}

function toFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = toValue(v);
  return fields;
}

export function fromValue(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  return fromFields(v.mapValue.fields ?? {});
}

export function fromFields(fields: Record<string, FsValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromValue(v)]));
}

interface FsDocument {
  name: string;
  fields?: Record<string, FsValue>;
  createTime?: string;
}

export interface FirestoreStoreOptions {
  project: string;
  fetch?: typeof fetch;
  /** Returns an OAuth access token; defaults to the GCE/Cloud Run metadata server. */
  token?: () => Promise<string>;
}

export class FirestoreStore implements CommunityStore {
  private readonly fetchImpl: typeof fetch;
  private readonly root: string;
  private readonly base: string;
  private cached: { token: string; expires: number } | undefined;

  constructor(private readonly opts: FirestoreStoreOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.root = `projects/${opts.project}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }

  private async token(): Promise<string> {
    if (this.opts.token) return this.opts.token();
    if (this.cached && this.cached.expires > Date.now() + 60_000) return this.cached.token;
    const res = await this.fetchImpl(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) throw new Error(`metadata token: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call(method: string, url: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  private async ok(res: Response, what: string): Promise<Response> {
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${await res.text()}`);
    return res;
  }

  async ensureUser(u: { uid: string; name: string; picture: string | null; provider: string }) {
    const url = `${this.base}/users/${encodeURIComponent(u.uid)}`;
    const got = await this.call('GET', url);
    if (got.ok) {
      const doc = (await got.json()) as FsDocument;
      const f = fromFields(doc.fields ?? {});
      return {
        uid: u.uid,
        display: String(f.display ?? u.name),
        firstSeen: new Date(String(f.createdAt ?? doc.createTime ?? Date.now())),
      };
    }
    if (got.status !== 404) await this.ok(got, 'ensureUser');
    const now = new Date();
    // currentDocument.exists=false: two first posts racing create the profile once.
    const res = await this.call('PATCH', `${url}?currentDocument.exists=false`, {
      fields: toFields({
        display: u.name,
        picture: u.picture,
        provider: u.provider,
        rep: 1,
        badges: [],
        role: 'member',
        createdAt: now,
      }),
    });
    if (!res.ok && res.status !== 400 && res.status !== 409) await this.ok(res, 'ensureUser');
    return { uid: u.uid, display: u.name, firstSeen: now };
  }

  async publishedQuestion(id: string) {
    const res = await this.call('GET', `${this.base}/questions/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    await this.ok(res, 'publishedQuestion');
    const f = fromFields(((await res.json()) as FsDocument).fields ?? {});
    if (f.status !== 'published') return null;
    return { title: String(f.title ?? ''), body: String(f.body ?? '') };
  }

  async createPost(target: Target, post: NewPost): Promise<string> {
    const path = `${collectionOf(target)}/${newId()}`;
    // createdAt is the server's commit time, as serverTimestamp() gave the old browser path.
    const res = await this.call('POST', `${this.base}:commit`, {
      writes: [
        {
          update: { name: `${this.root}/${path}`, fields: toFields(fieldsFor(target, post)) },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
    });
    await this.ok(res, 'createPost');
    return path;
  }

  async saveReview(log: ReviewLog) {
    const res = await this.call('POST', `${this.base}/communityReviews`, {
      fields: toFields({ ...log, createdAt: new Date() }),
    });
    await this.ok(res, 'saveReview');
  }

  async queue(): Promise<QueueItem[]> {
    const pending = (collectionId: string, allDescendants: boolean) => ({
      structuredQuery: {
        from: [{ collectionId, allDescendants }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'pending' },
          },
        },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
        limit: 100,
      },
    });
    const run = async (q: unknown) => {
      const res = await this.ok(await this.call('POST', `${this.base}:runQuery`, q), 'queue');
      const rows = (await res.json()) as Array<{ document?: FsDocument }>;
      return rows.flatMap((r) => (r.document ? [r.document] : []));
    };
    const docs = (
      await Promise.all([
        run(pending('questions', false)),
        run(pending('answers', true)),
        run(pending('threadAnswers', false)),
      ])
    ).flat();
    return docs
      .map((d) => {
        const f = fromFields(d.fields ?? {});
        const path = d.name.slice(this.root.length + 1);
        return toQueueItem(
          path,
          f,
          typeof f.createdAt === 'string' ? f.createdAt : (d.createTime ?? null),
        );
      })
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  async resolve(path: string, status: 'published' | 'rejected', review: ReviewSummary) {
    if (!POST_PATH.test(path)) return false;
    const current = await this.call('GET', `${this.base}/${path}`);
    if (current.status === 404) return false;
    await this.ok(current, 'resolve');
    const doc = (await current.json()) as FsDocument & { updateTime?: string };
    if (fromFields(doc.fields ?? {}).status !== 'pending') return false;
    // updateTime precondition: an editor racing another editor resolves the post once.
    const url =
      `${this.base}/${path}?updateMask.fieldPaths=status&updateMask.fieldPaths=review` +
      `&currentDocument.updateTime=${encodeURIComponent(doc.updateTime ?? '')}`;
    const res = await this.call('PATCH', url, { fields: toFields({ status, review }) });
    if (res.status === 400 || res.status === 409 || res.status === 412) return false;
    await this.ok(res, 'resolve');
    return true;
  }

  async setRole(uid: string, role: Role) {
    // The role travels in the ID token as a custom claim, so rules and this service read it with
    // no extra lookup. It takes effect when the user's token next refreshes (within the hour).
    const project = this.root.split('/')[1]!;
    const claims = await this.call(
      'POST',
      `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`,
      { localId: uid, customAttributes: JSON.stringify(role === 'member' ? {} : { role }) },
    );
    await this.ok(claims, 'setRole claims');
    // Mirrored onto the public profile so the site can show the badge.
    const res = await this.call(
      'PATCH',
      `${this.base}/users/${encodeURIComponent(uid)}?updateMask.fieldPaths=role`,
      { fields: toFields({ role }) },
    );
    await this.ok(res, 'setRole profile');
  }

  async spentToday(day: string): Promise<number> {
    const res = await this.call('GET', `${this.base}/communityUsage/${day}`);
    if (res.status === 404) return 0;
    await this.ok(res, 'spentToday');
    const f = fromFields(((await res.json()) as FsDocument).fields ?? {});
    return Number(f.usd ?? 0);
  }

  async addSpend(day: string, usd: number): Promise<void> {
    const res = await this.call('POST', `${this.base}:commit`, {
      writes: [
        {
          update: { name: `${this.root}/communityUsage/${day}`, fields: toFields({ day }) },
          updateMask: { fieldPaths: ['day'] },
          updateTransforms: [
            { fieldPath: 'usd', increment: { doubleValue: usd } },
            { fieldPath: 'reviews', increment: { integerValue: '1' } },
          ],
        },
      ],
    });
    await this.ok(res, 'addSpend');
  }

  private docName(path: string) {
    return `${this.root}/${path}`;
  }

  private toWrite(w: Write) {
    return {
      update: { name: this.docName(w.path), fields: toFields(w.fields) },
      ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
    };
  }

  transact: Transact = async (fn) => {
    // Firestore aborts a transaction whose reads changed before commit; the whole function reruns.
    for (let attempt = 1; ; attempt++) {
      const begun = await this.ok(
        await this.call('POST', `${this.base}:beginTransaction`, { options: { readWrite: {} } }),
        'beginTransaction',
      );
      const { transaction } = (await begun.json()) as { transaction: string };
      const get = async (path: string): Promise<Doc | null> => {
        const res = await this.call(
          'GET',
          `${this.base}/${path}?transaction=${encodeURIComponent(transaction)}`,
        );
        if (res.status === 404) return null;
        await this.ok(res, `get ${path}`);
        return fromFields(((await res.json()) as FsDocument).fields ?? {});
      };
      const { writes, result } = await fn(get);
      const res = await this.call('POST', `${this.base}:commit`, {
        transaction,
        writes: writes.map((w) => this.toWrite(w)),
      });
      if (res.ok) return result;
      if (res.status === 409 && attempt < 5) continue;
      await this.ok(res, 'commit');
    }
  };

  async userRep(uid: string) {
    const res = await this.call('GET', `${this.base}/users/${encodeURIComponent(uid)}`);
    if (res.status === 404) return 1;
    await this.ok(res, 'userRep');
    const f = fromFields(((await res.json()) as FsDocument).fields ?? {});
    return typeof f.rep === 'number' ? f.rep : 1;
  }

  async myVotes(uid: string, paths: string[]) {
    const out: Record<string, VoteValue> = {};
    if (!paths.length) return out;
    const res = await this.ok(
      await this.call('POST', `${this.base}:batchGet`, {
        documents: paths.map((p) => this.docName(votePath(uid, p))),
      }),
      'myVotes',
    );
    const rows = (await res.json()) as Array<{ found?: FsDocument }>;
    for (const r of rows) {
      if (!r.found) continue;
      const f = fromFields(r.found.fields ?? {});
      if ((f.value === 1 || f.value === -1) && typeof f.post === 'string') out[f.post] = f.value;
    }
    return out;
  }
}
