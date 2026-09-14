/**
 * Where Maxi keeps conversation logs and its daily spend counter.
 *
 * Production writes to Firestore through its REST API with the Cloud Run service account's token
 * (from the metadata server), so the image needs no Firebase SDK. Server writes bypass security
 * rules; firestore.rules keeps both collections closed to browsers.
 *
 * Logs are anonymous by design: no IP address, no user agent, no account.
 */

export interface ChatLog {
  id: string;
  question: string;
  answer: string;
  /** Number of messages in the conversation, this answer included. */
  turns: number;
  model: string;
  corpusHash: string;
  page?: string;
  toolCalls: string[];
  stopReason: string;
  usage: UsageTotals;
  costUsd: number;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export type Vote = 'up' | 'down';

export interface MaxiStore {
  saveChat(log: ChatLog): Promise<void>;
  /** Returns false when no conversation has that id. */
  vote(id: string, vote: Vote): Promise<boolean>;
  spentToday(day: string): Promise<number>;
  addSpend(day: string, usd: number): Promise<void>;
}

export class MemoryStore implements MaxiStore {
  readonly chats = new Map<string, ChatLog & { vote?: Vote }>();
  readonly spend = new Map<string, number>();

  async saveChat(log: ChatLog): Promise<void> {
    this.chats.set(log.id, { ...log });
  }
  async vote(id: string, vote: Vote): Promise<boolean> {
    const chat = this.chats.get(id);
    if (!chat) return false;
    chat.vote = vote;
    return true;
  }
  async spentToday(day: string): Promise<number> {
    return this.spend.get(day) ?? 0;
  }
  async addSpend(day: string, usd: number): Promise<void> {
    this.spend.set(day, (this.spend.get(day) ?? 0) + usd);
  }
}

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields: Record<string, FsValue> } };

function toValue(v: unknown): FsValue {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object' && v !== null)
    return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}

function toFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = toValue(v);
  return fields;
}

export interface FirestoreStoreOptions {
  project: string;
  fetch?: typeof fetch;
  /** Returns an OAuth access token; defaults to the GCE/Cloud Run metadata server. */
  token?: () => Promise<string>;
}

export class FirestoreStore implements MaxiStore {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private cached: { token: string; expires: number } | undefined;

  constructor(private readonly opts: FirestoreStoreOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.base = `https://firestore.googleapis.com/v1/projects/${opts.project}/databases/(default)/documents`;
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

  async saveChat(log: ChatLog): Promise<void> {
    const { id, ...rest } = log;
    const res = await this.call(
      'POST',
      `${this.base}/maxiChats?documentId=${encodeURIComponent(id)}`,
      {
        fields: toFields({ ...rest, createdAt: new Date() }),
      },
    );
    if (!res.ok) throw new Error(`saveChat: HTTP ${res.status} ${await res.text()}`);
  }

  async vote(id: string, vote: Vote): Promise<boolean> {
    const url =
      `${this.base}/maxiChats/${encodeURIComponent(id)}` +
      '?updateMask.fieldPaths=vote&updateMask.fieldPaths=votedAt&currentDocument.exists=true';
    const res = await this.call('PATCH', url, { fields: toFields({ vote, votedAt: new Date() }) });
    if (res.status === 404 || res.status === 400) return false;
    if (!res.ok) throw new Error(`vote: HTTP ${res.status} ${await res.text()}`);
    return true;
  }

  async spentToday(day: string): Promise<number> {
    const res = await this.call('GET', `${this.base}/maxiUsage/${day}`);
    if (res.status === 404) return 0;
    if (!res.ok) throw new Error(`spentToday: HTTP ${res.status}`);
    const doc = (await res.json()) as {
      fields?: { usd?: { doubleValue?: number; integerValue?: string } };
    };
    const usd = doc.fields?.usd;
    return Number(usd?.doubleValue ?? usd?.integerValue ?? 0);
  }

  async addSpend(day: string, usd: number): Promise<void> {
    const name = `${this.base.replace('https://firestore.googleapis.com/v1/', '')}/maxiUsage/${day}`;
    // An update with a mask and transforms but no precondition creates the day's document on the
    // first request and increments it atomically after that, across every instance.
    const res = await this.call('POST', `${this.base}:commit`, {
      writes: [
        {
          update: { name, fields: toFields({ day }) },
          updateMask: { fieldPaths: ['day'] },
          updateTransforms: [
            { fieldPath: 'usd', increment: { doubleValue: usd } },
            { fieldPath: 'requests', increment: { integerValue: '1' } },
          ],
        },
      ],
    });
    if (!res.ok) throw new Error(`addSpend: HTTP ${res.status} ${await res.text()}`);
  }
}
