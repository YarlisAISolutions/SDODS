import { readdirSync, readFileSync, renameSync, lstatSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SECRET_HEADER } from '../har/api-har.js';
import { entryContent, isZip, readZip, withContent, writeZip, type ZipEntry } from './zip.js';

/**
 * Strip credentials out of Playwright traces (#101).
 *
 * A trace records every request and response header, the context's options (`extraHTTPHeaders`,
 * `httpCredentials`, `storageState`), every `storageState()` / `addCookies()` call with its result,
 * DOM snapshots and the arguments of every action. For a project that signs in with pool accounts
 * that is the session cookie, the `Authorization` bearer and — for Firebase — the long-lived
 * refresh token in localStorage/IndexedDB.
 *
 * What is replaced with `[redacted]`:
 * - credential headers (`Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`,
 *   `X-Api-Key` and similar) wherever a `{ name, value }` header or a header map appears —
 *   `.network` request/response entries, context options, route and fetch parameters;
 * - every cookie value, localStorage/sessionStorage value and IndexedDB record;
 * - `password` / `passphrase` fields (`httpCredentials`, `proxy`, client certificates);
 * - the value of password inputs in DOM snapshots, and values typed by `fill`/`type` into a field
 *   whose locator names a password, secret, token or one-time code (best effort).
 *
 * Not covered: response and request bodies (`resources/`), page text and screenshots. A redacted
 * trace is safer to keep, not safe to publish.
 *
 * Only `*.trace` and `*.network` entries are rewritten; everything else (sources, screenshots,
 * resources, stacks) is copied through unchanged, so the trace viewer opens the result as before.
 */

export const REDACTED = '[redacted]';

export const TRACE_SECRET_HEADER = new RegExp(
  `${SECRET_HEADER.source}|^(x-auth-token|x-access-token|x-refresh-token|x-id-token|x-session-token|x-csrf-token|x-xsrf-token|x-amz-security-token|x-goog-api-key|x-firebase-appcheck|api-key|apikey)$`,
  'i',
);

/** A locator or selector that names a field whose typed value is a credential. */
const SECRET_FIELD = /pass(word|wd|code|phrase)?\b|passw|secret|token|\botp\b|one-time|\bpin\b/i;
const TYPING_METHODS = new Set(['fill', 'type', 'pressSequentially']);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function blank(holder: Json, key: string): number {
  const v = holder[key];
  if (v === undefined || v === null || v === '' || v === REDACTED) return 0;
  holder[key] = REDACTED;
  return 1;
}

/**
 * Redact one parsed trace event in place. Returns the number of values replaced.
 *
 * `typed` carries values redacted from typing actions across the events of one stream, by call id,
 * so the action's `log` lines (`fill("…")`) lose the value too.
 */
export function redactTraceEvent(event: unknown, typed = new Map<string, string>()): number {
  let n = walk(event, undefined);
  if (!isObject(event)) return n;
  const value = redactTypedSecret(event);
  if (value !== undefined) {
    n++;
    if (typeof event.callId === 'string') typed.set(event.callId, value);
  }
  if (
    event.type === 'log' &&
    typeof event.callId === 'string' &&
    typeof event.message === 'string'
  ) {
    const secret = typed.get(event.callId);
    if (secret && event.message.includes(secret)) {
      event.message = event.message.split(secret).join(REDACTED);
      n++;
    }
  }
  return n;
}

function walk(node: unknown, key: string | undefined): number {
  let n = 0;
  if (Array.isArray(node)) {
    if (key === 'cookies' || key === 'localStorage' || key === 'sessionStorage') {
      for (const item of node) if (isObject(item)) n += blank(item, 'value');
    }
    if (key === 'indexedDB') {
      for (const db of node) {
        const stores = isObject(db) && Array.isArray(db.stores) ? db.stores : [];
        for (const store of stores) {
          const records = isObject(store) && Array.isArray(store.records) ? store.records : [];
          for (const record of records) {
            if (!isObject(record)) continue;
            for (const f of ['key', 'keyEncoded', 'value', 'valueEncoded']) n += blank(record, f);
          }
        }
      }
    }
    // DOM snapshot node: ["INPUT", { type: "password", __playwright_value_: "..." }, ...children]
    if (
      typeof node[0] === 'string' &&
      node[0].toUpperCase() === 'INPUT' &&
      isObject(node[1]) &&
      String(node[1].type ?? '').toLowerCase() === 'password'
    ) {
      n += blank(node[1], '__playwright_value_') + blank(node[1], 'value');
    }
    for (const item of node) n += walk(item, undefined);
    return n;
  }
  if (!isObject(node)) return 0;
  if (typeof node.name === 'string' && 'value' in node && TRACE_SECRET_HEADER.test(node.name))
    n += blank(node, 'value');
  if (key !== undefined && /headers$/i.test(key)) {
    for (const [header, value] of Object.entries(node))
      if (typeof value === 'string' && TRACE_SECRET_HEADER.test(header)) n += blank(node, header);
  }
  for (const f of ['password', 'passphrase']) if (typeof node[f] === 'string') n += blank(node, f);
  for (const [k, v] of Object.entries(node)) if (typeof v === 'object') n += walk(v, k);
  return n;
}

/** Returns the typed value when it was redacted. */
function redactTypedSecret(event: Json): string | undefined {
  if (event.type !== 'before' || !isObject(event.params)) return undefined;
  const params = event.params;
  if (typeof params.value !== 'string' || !params.value || params.value === REDACTED)
    return undefined;
  const method = String(event.method ?? '');
  const title = typeof event.title === 'string' ? event.title : '';
  const typing =
    TYPING_METHODS.has(method) ||
    (method === 'pw:api' && /^(fill|type|press sequentially)\b/i.test(title));
  if (!typing) return undefined;
  const target = [params.selector, params.locator, event.subtitle]
    .filter((s): s is string => typeof s === 'string')
    .join(' ');
  if (!SECRET_FIELD.test(target)) return undefined;
  const typed = params.value;
  params.value = REDACTED;
  if (title.includes(typed)) event.title = title.split(typed).join(REDACTED);
  return typed;
}

/** Redact every JSON line of a `.trace` / `.network` entry. Unparseable lines are kept as they are. */
export function redactTraceJsonl(text: string): { text: string; changed: number } {
  let changed = 0;
  const typed = new Map<string, string>();
  const lines = text.split('\n').map((line) => {
    if (!line.trim()) return line;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return line;
    }
    const n = redactTraceEvent(event, typed);
    if (!n) return line;
    changed += n;
    return JSON.stringify(event);
  });
  return { text: changed ? lines.join('\n') : text, changed };
}

const isTraceEvents = (name: string) => /\.(trace|network)$/.test(name);

/** True when the buffer is a zip holding a Playwright trace (or a zip that nests one). */
export function isTraceZip(entries: ZipEntry[]): boolean {
  return entries.some((e) => isTraceEvents(e.name));
}

/**
 * Redact a trace zip held in memory. Zips nested inside (blob shard reports keep attachments as
 * `resources/<sha>.zip`) are redacted too. Non-trace zips come back untouched with `trace: false`.
 */
export function redactTraceZip(buf: Buffer): { buffer: Buffer; changed: number; trace: boolean } {
  if (!isZip(buf)) return { buffer: buf, changed: 0, trace: false };
  const entries = readZip(buf);
  let changed = 0;
  let trace = isTraceZip(entries);
  const out = entries.map((entry) => {
    if (isTraceEvents(entry.name)) {
      const res = redactTraceJsonl(entryContent(entry).toString('utf8'));
      if (!res.changed) return entry;
      changed += res.changed;
      return withContent(entry, Buffer.from(res.text, 'utf8'));
    }
    if (entry.name.endsWith('.zip')) {
      const inner = entryContent(entry);
      const res = redactTraceZip(inner);
      if (res.trace) trace = true;
      if (!res.changed) return entry;
      changed += res.changed;
      return withContent(entry, res.buffer);
    }
    return entry;
  });
  return { buffer: changed ? writeZip(out) : buf, changed, trace };
}

function writeAtomically(file: string, data: Buffer | string) {
  const tmp = join(file, '..', `.${basename(file)}.redacting-${process.pid}`);
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** Redact a trace zip on disk in place. Returns values replaced (0 when not a trace). */
export function redactTraceFile(file: string): number {
  const res = redactTraceZip(readFileSync(file));
  if (res.changed) writeAtomically(file, res.buffer);
  return res.changed;
}

/**
 * Cucumber messages embed each trace as a BASE64 attachment body, and ingest writes `trace.zip`
 * from those bytes — so the copy in `messages*.ndjson` is redacted as well.
 */
export function redactMessagesFile(file: string): number {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('"application/zip"')) return 0;
  let changed = 0;
  const lines = text.split('\n').map((line) => {
    if (!line.includes('"application/zip"')) return line;
    let env: { attachment?: { mediaType?: string; contentEncoding?: string; body?: string } };
    try {
      env = JSON.parse(line);
    } catch {
      return line;
    }
    const a = env.attachment;
    if (!a || a.mediaType !== 'application/zip' || a.contentEncoding !== 'BASE64' || !a.body)
      return line;
    const res = redactTraceZip(Buffer.from(a.body, 'base64'));
    if (!res.changed) return line;
    changed += res.changed;
    a.body = res.buffer.toString('base64');
    return JSON.stringify(env);
  });
  if (changed) writeAtomically(file, lines.join('\n'));
  return changed;
}

export interface RunTraceRedaction {
  /** trace zips and message files that were rewritten */
  files: string[];
  /** values replaced across all of them */
  values: number;
  /** files that could not be read or rewritten, with the reason */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Redact every trace a run left behind: `runner-output/<test>/trace.zip`, the HTML report's copies
 * under `html-report/data/`, blob shard reports, and the BASE64 bodies in `messages*.ndjson`.
 */
export function redactRunTraces(runDir: string, maxDepth = 10): RunTraceRedaction {
  const result: RunTraceRedaction = { files: [], values: 0, errors: [] };
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = join(dir, name);
      let st;
      try {
        st = lstatSync(file);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (name !== 'node_modules') visit(file, depth + 1);
        continue;
      }
      const isMessages = /^messages.*\.ndjson$/.test(name);
      if (!name.endsWith('.zip') && !isMessages) continue;
      try {
        const n = isMessages ? redactMessagesFile(file) : redactTraceFile(file);
        if (n) {
          result.files.push(file);
          result.values += n;
        }
      } catch (e) {
        result.errors.push({ file, error: (e as Error).message });
      }
    }
  };
  visit(runDir, 0);
  return result;
}
