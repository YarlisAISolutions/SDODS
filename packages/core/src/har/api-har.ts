import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApiSnapshot } from '@automax/contracts';
import type { ApiClientDeps } from '../api/client.js';
import { redact } from '../logger.js';
import { VERSION } from '../version.js';

/**
 * API-layer HAR: Playwright's routeFromHAR only exists on Page/BrowserContext, so the ApiClient
 * records and replays through this module. Entries are HAR 1.2 with an `_automax.key` used for
 * lookup: `METHOD normalizedUrl sha1(body)`.
 */
export type ApiHarMode = 'off' | 'update' | 'replay';

interface HarHeader {
  name: string;
  value: string;
}

export interface AutomaxHarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: HarHeader[];
    queryString: HarHeader[];
    cookies: unknown[];
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: HarHeader[];
    cookies: unknown[];
    content: { size: number; mimeType: string; text: string };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
  _automax: { key: string; recordedAt: string };
}

export interface HarFile {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: AutomaxHarEntry[];
  };
}

const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;
const VOLATILE_QUERY = /^(_|t|ts|timestamp|nonce|cb|cache)$/i;

export function normalizeUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.trim();
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !VOLATILE_QUERY.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return `${u.protocol}//${u.host.toLowerCase()}${path}${search}`;
}

function stable(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
    .join(',')}}`;
}

export function bodyHash(body: unknown): string {
  const text = stable(body);
  if (!text) return '';
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

export function harKey(method: string, url: string, body?: unknown): string {
  return `${method.toUpperCase()} ${normalizeUrl(url)} ${bodyHash(body)}`.trim();
}

function toHeaders(headers: Record<string, string>): HarHeader[] {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: SECRET_HEADER.test(name) ? '***' : value,
  }));
}

function fromHeaders(headers: HarHeader[]): Record<string, string> {
  return Object.fromEntries(headers.map((h) => [h.name, h.value]));
}

export function readHarFile(file: string): HarFile {
  if (!existsSync(file)) {
    return { log: { version: '1.2', creator: { name: 'AutoMax', version: VERSION }, entries: [] } };
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<HarFile>;
  return {
    log: {
      version: '1.2',
      creator: parsed.log?.creator ?? { name: 'AutoMax', version: VERSION },
      entries: parsed.log?.entries ?? [],
    },
  };
}

export function snapshotToEntry(snap: ApiSnapshot): AutomaxHarEntry {
  const key = harKey(snap.request.method, snap.request.url, snap.request.body);
  const body = snap.request.body;
  const safeBody = redact(body);
  const responseText =
    typeof snap.response.rawBody === 'string'
      ? snap.response.rawBody
      : typeof snap.response.body === 'string'
        ? snap.response.body
        : JSON.stringify(snap.response.body ?? null);
  return {
    startedDateTime: snap.startedAt,
    time: snap.response.responseTime,
    request: {
      method: snap.request.method.toUpperCase(),
      url: snap.request.url,
      httpVersion: 'HTTP/1.1',
      headers: toHeaders(snap.request.headers ?? {}),
      queryString: Object.entries(snap.request.query ?? {}).map(([name, value]) => ({
        name,
        value,
      })),
      cookies: [],
      headersSize: -1,
      bodySize: -1,
      postData:
        body === undefined
          ? undefined
          : {
              mimeType: snap.request.headers?.['content-type'] ?? 'application/json',
              text: typeof safeBody === 'string' ? safeBody : JSON.stringify(safeBody),
            },
    },
    response: {
      status: snap.response.status,
      statusText: snap.response.statusText,
      httpVersion: 'HTTP/1.1',
      headers: toHeaders(snap.response.headers ?? {}),
      cookies: [],
      content: {
        size: responseText.length,
        mimeType: snap.response.headers?.['content-type'] ?? 'application/json',
        text: responseText,
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 0, wait: snap.response.responseTime, receive: 0 },
    _automax: { key, recordedAt: new Date().toISOString() },
  };
}

export function entryToResponse(entry: AutomaxHarEntry): ApiSnapshot['response'] {
  const text = entry.response.content.text ?? '';
  let body: unknown = text;
  try {
    body = text.length ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: entry.response.status,
    statusText: entry.response.statusText,
    headers: fromHeaders(entry.response.headers),
    body,
    rawBody: text,
    responseTime: entry.time ?? 0,
  };
}

/** Appends (or refreshes by key) entries in an API HAR file. */
export class HarRecorder {
  private har: HarFile;

  constructor(readonly file: string) {
    this.har = readHarFile(file);
  }

  get size(): number {
    return this.har.log.entries.length;
  }

  async record(snap: ApiSnapshot): Promise<void> {
    const entry = snapshotToEntry(snap);
    const idx = this.har.log.entries.findIndex((e) => e._automax?.key === entry._automax.key);
    if (idx >= 0) this.har.log.entries[idx] = entry;
    else this.har.log.entries.push(entry);
    this.flush();
  }

  flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.har, null, 2));
  }
}

/** Serves recorded responses for matching requests; misses return undefined (or throw in strict mode). */
export class HarReplayer {
  private readonly byKey = new Map<string, AutomaxHarEntry>();
  readonly hits: string[] = [];
  readonly misses: string[] = [];

  constructor(
    readonly file: string,
    private readonly opts: { strict?: boolean } = {},
  ) {
    for (const e of readHarFile(file).log.entries) {
      const key =
        e._automax?.key ?? harKey(e.request.method, e.request.url, e.request.postData?.text);
      this.byKey.set(key, e);
    }
  }

  get size(): number {
    return this.byKey.size;
  }

  async replay(req: ApiSnapshot['request']): Promise<ApiSnapshot['response'] | undefined> {
    const key = harKey(req.method, req.url, req.body);
    const entry = this.byKey.get(key);
    if (!entry) {
      this.misses.push(key);
      if (this.opts.strict) {
        throw new Error(`HAR strict mode: no recorded entry for ${key} in ${this.file}`);
      }
      return undefined;
    }
    this.hits.push(key);
    return entryToResponse(entry);
  }
}

export interface ApiHarOptions {
  mode: ApiHarMode;
  file: string;
  strict?: boolean;
}

/** Build the optional `har` hooks the ApiClient accepts in its deps. */
export function makeApiHarHooks(opts: ApiHarOptions): ApiClientDeps['har'] | undefined {
  if (opts.mode === 'off') return undefined;
  if (opts.mode === 'update') {
    const recorder = new HarRecorder(opts.file);
    return { record: (snap) => recorder.record(snap), strict: false };
  }
  const replayer = new HarReplayer(opts.file, { strict: opts.strict });
  return {
    replay: (req) => replayer.replay(req),
    strict: Boolean(opts.strict),
  };
}
