import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/api/client.js';
import { ApiContext, HeaderMap } from '../src/fixtures/api-context.js';
import { sendRaw } from '../src/steps/net.steps.js';
import '../src/steps/api.steps.js';

/**
 * #121 — `ApiContext.headers` was a plain `Map`, so `X-API-Key` and `x-api-key` were two entries.
 * Deleting or reading a header by another casing silently did nothing, while the client lower-cased
 * both on the way out. HTTP header names are case-insensitive; the store now is too.
 */

const require_ = createRequire(import.meta.url);
const { stepDefinitions } = require_(
  require_.resolve('playwright-bdd').replace(/index\.js$/, 'steps/stepRegistry.js'),
) as { stepDefinitions: Array<{ pattern: unknown; fn: (...a: any[]) => unknown }> };

function step(pattern: string): (fx: any, ...args: any[]) => Promise<void> {
  const found = stepDefinitions.filter((d) => String(d.pattern) === pattern);
  expect(found, `definitions registered for "${pattern}"`).toHaveLength(1);
  return found[0]!.fn as (fx: any, ...args: any[]) => Promise<void>;
}

const SET_HEADER = 'I set the request header {string} to {string}';
const CLEAR = 'I clear the request headers and query parameters';

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
}

let server: Server;
let base: string;
const received: Received[] = [];
const last = () => received.at(-1)!;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      received.push({ path: req.url ?? '/', headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function config() {
  return {
    project: { timeouts: { api: 10_000 } },
    runtime: { ci: false },
    env: { name: 'test', api: { baseUrl: base, headers: {}, auth: { type: 'none' } }, vars: {} },
  } as any;
}

const env = () => ({ vars: {} }) as any;

describe('#121 — ApiContext.headers is case-insensitive', () => {
  it('the three lines from the issue', () => {
    const ctx = new ApiContext();
    ctx.headers.set('X-API-Key', 'key-1');
    ctx.headers.delete('x-api-key');
    expect(ctx.headers.has('X-API-Key')).toBe(false);
    expect(ctx.headers.size).toBe(0);

    ctx.headers.set('Cookie', 'sid=abc');
    expect(ctx.headers.get('cookie')).toBe('sid=abc');
    expect(ctx.headers.has('COOKIE')).toBe(true);
  });

  it('control: same-casing set/get/delete still works', () => {
    const ctx = new ApiContext();
    ctx.headers.set('accept', 'text/html');
    expect(ctx.headers.get('accept')).toBe('text/html');
    expect(ctx.headers.delete('accept')).toBe(true);
    expect(ctx.headers.get('accept')).toBeUndefined();
  });

  it('both casings collapse to one entry and the last set wins', () => {
    const ctx = new ApiContext();
    ctx.headers.set('x-api-key', 'first');
    ctx.headers.set('X-API-Key', 'second');
    ctx.headers.set('x-api-key', 'third');
    expect(ctx.headers.size).toBe(1);
    expect(ctx.headers.get('X-Api-Key')).toBe('third');
    expect([...ctx.headers]).toEqual([['x-api-key', 'third']]);
  });

  it('HeaderMap built from an iterable normalises too', () => {
    const map = new HeaderMap([
      ['Cookie', 'a'],
      ['X-API-Key', 'b'],
      ['x-api-key', 'c'],
    ]);
    expect(map).toBeInstanceOf(Map);
    expect(map.get('cookie')).toBe('a');
    expect(map.get('X-Api-Key')).toBe('c');
    expect([...map.keys()]).toEqual(['cookie', 'x-api-key']);
  });

  it('snapshot and restore round-trip through the real header steps', async () => {
    const ctx = new ApiContext();
    const fx = { apiContext: ctx, env: env() };
    await step(SET_HEADER)(fx, 'Cookie', 'sid=session');
    await step(SET_HEADER)(fx, 'X-API-Key', 'key-1');

    // What a "remember the API identity" step does: read the credential headers by name.
    const remembered = new Map<string, string>();
    for (const name of ['cookie', 'x-api-key', 'authorization']) {
      const value = ctx.headers.get(name);
      if (value !== undefined) remembered.set(name, value);
    }
    expect([...remembered.keys()]).toEqual(['cookie', 'x-api-key']);

    // Switch identity, then restore only the session (drop the key).
    await step(CLEAR)(fx);
    expect(ctx.headers.size).toBe(0);
    for (const [k, v] of remembered) ctx.headers.set(k, v);
    ctx.headers.delete('X-API-Key');

    expect(ctx.headers.get('Cookie')).toBe('sid=session');
    expect(ctx.headers.has('x-api-key')).toBe(false);

    // A plain-Map clone of the store keeps lower-cased names, so restoring it is idempotent.
    const clone = new Map(ctx.headers);
    ctx.headers.clear();
    for (const [k, v] of clone) ctx.headers.set(k.toUpperCase(), v);
    expect([...ctx.headers]).toEqual([['cookie', 'sid=session']]);
  });
});

describe('#121 — on the wire', () => {
  let request: APIRequestContext;
  beforeAll(async () => {
    request = await playwrightRequest.newContext();
  });
  afterAll(async () => {
    await request.dispose();
  });

  it('control: a header set through the step arrives', async () => {
    const ctx = new ApiContext();
    await step(SET_HEADER)({ apiContext: ctx, env: env() }, 'X-API-Key', 'key-1');
    await new ApiClient({ request, config: config(), ctx }).get('/control');
    expect(last().path).toBe('/control');
    expect(last().headers['x-api-key']).toBe('key-1');
  });

  it('a header deleted by another casing is not sent', async () => {
    const ctx = new ApiContext();
    await step(SET_HEADER)({ apiContext: ctx, env: env() }, 'X-API-Key', 'key-1');
    await step(SET_HEADER)({ apiContext: ctx, env: env() }, 'Cookie', 'sid=session');
    ctx.headers.delete('x-api-key');
    await new ApiClient({ request, config: config(), ctx }).get('/deleted');
    expect(last().path).toBe('/deleted');
    expect(last().headers['x-api-key']).toBeUndefined();
    expect(last().headers.cookie).toBe('sid=session');
  });

  it('the last set wins on the wire, whatever casing came first', async () => {
    const ctx = new ApiContext();
    ctx.headers.set('x-api-key', 'first');
    ctx.headers.set('X-API-Key', 'second');
    ctx.headers.set('x-api-key', 'third');
    await new ApiClient({ request, config: config(), ctx }).get('/last-wins');
    expect(last().headers['x-api-key']).toBe('third');
  });

  it('raw (no-redirect) requests see the same store', async () => {
    const ctx = new ApiContext();
    ctx.headers.set('X-API-Key', 'key-1');
    ctx.headers.delete('x-api-key');
    const api = new ApiClient({ request, config: config(), ctx });
    await sendRaw(
      { request, api, apiContext: ctx, env: config().env, config: config() } as any,
      'GET',
      '/raw',
    );
    expect(last().path).toBe('/raw');
    expect(last().headers['x-api-key']).toBeUndefined();
  });
});
