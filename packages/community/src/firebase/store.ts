/**
 * The Firestore implementation of CommunityStore, over Firestore's REST API with the Cloud Run
 * service account's token, so the image needs no Firebase SDK. Server writes bypass security
 * rules; the rules give browsers read access to published posts only.
 *
 * Everything Firebase-specific in this package lives under src/firebase/, so it can move to the
 * private deployment package (sdods-fcore) as one unit.
 */

import type { Role } from '../auth.js';
import { votePath, type Doc, type Transact, type Write } from '../engagement.js';
import type { VoteValue } from '../reputation.js';
import {
  POST_PATH,
  newId,
  collectionOf,
  fieldsFor,
  toQueueItem,
  toPendingEdit,
  toPublicAnswer,
  toPublicProfile,
  toPublicQuestion,
  toPublicRevision,
  feedbackRecord,
  type CommunityStore,
  type Feedback,
  type PublicAnswer,
  type PublicProfile,
  type NewPost,
  type PendingEdit,
  type QueueItem,
  type ReviewLog,
  type ReviewSummary,
  type Target,
} from '../store.js';
import { metadataToken } from './token.js';

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
  private readonly token: () => Promise<string>;

  constructor(opts: FirestoreStoreOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.token = opts.token ?? metadataToken(this.fetchImpl);
    this.root = `projects/${opts.project}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
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
    // Mirrored onto the public profile so the site can show the badge. The claim that grants the
    // role is written by identityToolkitRoleClaims (./roles.ts).
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

  async pendingEdits(): Promise<PendingEdit[]> {
    const res = await this.ok(
      await this.call('POST', `${this.base}:runQuery`, {
        structuredQuery: {
          from: [{ collectionId: 'revisions' }],
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
      }),
      'pendingEdits',
    );
    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    return rows.flatMap((r) => {
      if (!r.document) return [];
      const f = fromFields(r.document.fields ?? {});
      const id = r.document.name.split('/').at(-1)!;
      return [toPendingEdit(id, f, typeof f.createdAt === 'string' ? f.createdAt : null)];
    });
  }

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

  /**
   * A structured query under `parent` (a document path, or '' for the root). Equality filters on
   * `where`, then one order. These are the same queries the site used to run from the browser, so
   * they need no new composite indexes.
   */
  private async query(
    what: string,
    q: {
      parent?: string;
      collection: string;
      where: Record<string, string>;
      orderBy: string;
      direction: 'ASCENDING' | 'DESCENDING';
      limit?: number;
    },
  ): Promise<Array<{ id: string; fields: Record<string, unknown>; createdAt: string | null }>> {
    const filters = Object.entries(q.where).map(([fieldPath, stringValue]) => ({
      fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue } },
    }));
    const url = `${q.parent ? `${this.base}/${q.parent}` : this.base}:runQuery`;
    const res = await this.ok(
      await this.call('POST', url, {
        structuredQuery: {
          from: [{ collectionId: q.collection }],
          where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } },
          orderBy: [{ field: { fieldPath: q.orderBy }, direction: q.direction }],
          ...(q.limit ? { limit: q.limit } : {}),
        },
      }),
      what,
    );
    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    return rows.flatMap((r) => {
      if (!r.document) return [];
      const fields = fromFields(r.document.fields ?? {});
      const createdAt =
        typeof fields.createdAt === 'string' ? fields.createdAt : (r.document.createTime ?? null);
      return [{ id: r.document.name.split('/').at(-1)!, fields, createdAt }];
    });
  }

  private async answersOf(questionId: string): Promise<PublicAnswer[]> {
    const rows = await this.query('answers', {
      parent: `questions/${encodeURIComponent(questionId)}`,
      collection: 'answers',
      where: { status: 'published' },
      orderBy: 'createdAt',
      direction: 'ASCENDING',
    });
    return rows.map((a) => toPublicAnswer(a.id, a.fields, a.createdAt));
  }

  async publishedQuestions(limit: number) {
    const rows = await this.query('publishedQuestions', {
      collection: 'questions',
      where: { status: 'published' },
      orderBy: 'createdAt',
      direction: 'DESCENDING',
      limit,
    });
    return Promise.all(
      rows.map(async (q) =>
        toPublicQuestion(q.id, q.fields, q.createdAt, await this.answersOf(q.id)),
      ),
    );
  }

  async questionThread(id: string) {
    const res = await this.call('GET', `${this.base}/questions/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    await this.ok(res, 'questionThread');
    const doc = (await res.json()) as FsDocument;
    const f = fromFields(doc.fields ?? {});
    if (f.status !== 'published') return null;
    const createdAt = typeof f.createdAt === 'string' ? f.createdAt : (doc.createTime ?? null);
    return toPublicQuestion(id, f, createdAt, await this.answersOf(id));
  }

  async threadAnswers(slug: string) {
    const rows = await this.query('threadAnswers', {
      collection: 'threadAnswers',
      where: { slug, status: 'published' },
      orderBy: 'createdAt',
      direction: 'ASCENDING',
    });
    return rows.map((a) => toPublicAnswer(a.id, a.fields, a.createdAt));
  }

  async profiles(uids: string[]) {
    const out: Record<string, PublicProfile> = {};
    if (!uids.length) return out;
    const res = await this.ok(
      await this.call('POST', `${this.base}:batchGet`, {
        documents: uids.map((uid) => this.docName(`users/${uid}`)),
      }),
      'profiles',
    );
    const rows = (await res.json()) as Array<{ found?: FsDocument }>;
    for (const r of rows)
      if (r.found)
        out[r.found.name.split('/').at(-1)!] = toPublicProfile(fromFields(r.found.fields ?? {}));
    return out;
  }

  async revisions(path: string) {
    const rows = await this.query('revisions', {
      collection: 'revisions',
      where: { post: path, status: 'applied' },
      orderBy: 'revision',
      direction: 'ASCENDING',
    });
    return rows.map((r) => toPublicRevision(r.fields, r.createdAt));
  }

  async saveFeedback(f: Feedback) {
    const { collection, fields } = feedbackRecord(f);
    const res = await this.call('POST', `${this.base}:commit`, {
      writes: [
        {
          update: { name: this.docName(`${collection}/${newId()}`), fields: toFields(fields) },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
    });
    await this.ok(res, 'saveFeedback');
  }
}
