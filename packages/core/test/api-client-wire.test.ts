import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as client from '../src/api/client.js';
const { ApiClient } = client;
import { ApiContext } from '../src/fixtures/api-context.js';
import { isSdodsError } from '../src/errors.js';
import { sendRaw } from '../src/steps/net.steps.js';
import '../src/steps/api.steps.js';

/**
 * What actually ARRIVES on the wire. Every assertion here reads the request as a real HTTP server
 * received it, through a real Playwright APIRequestContext — not the options object the client
 * built. The defects these lock down were all invisible at that level: the options were right and
 * the bytes were not.
 */

interface Received {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let base: string;
const received: Received[] = [];
const tokenHits = new Map<string, number>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = req.url ?? '/';
      if (path.startsWith('/token')) {
        // An OAuth2 token endpoint: form-encoded client credentials in, access token out.
        const form = new URLSearchParams(body);
        const clientId = form.get('client_id') ?? '';
        tokenHits.set(clientId, (tokenHits.get(clientId) ?? 0) + 1);
        if (
          form.get('grant_type') !== 'client_credentials' ||
          form.get('client_secret') !== 's3cret'
        ) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_client' }));
          return;
        }
        const expiresIn = Number(new URL(path, 'http://x').searchParams.get('expires_in') ?? 3600);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: `tok-${clientId}-${tokenHits.get(clientId)}`,
            token_type: 'Bearer',
            expires_in: expiresIn,
            scope: form.get('scope'),
            audience: form.get('audience'),
          }),
        );
        return;
      }
      received.push({ method: req.method ?? '', path, headers: req.headers, body });
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

const last = () => received.at(-1)!;

function config(auth: Record<string, unknown> = { type: 'none' }) {
  return {
    project: { timeouts: { api: 10_000 } },
    runtime: { ci: false },
    env: { name: 'test', api: { baseUrl: base, headers: {}, auth }, vars: {} },
  } as any;
}

/** A request context loaded with a signed-in browser session, as @ui/@hybrid scenarios get. */
async function sessionRequest(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    storageState: {
      cookies: [
        {
          name: 'sid',
          value: 'browser-session',
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  });
}

describe('#90 — isolated API client', () => {
  it('control: the shared request context carries the session cookie', async () => {
    const request = await sessionRequest();
    try {
      const api = new ApiClient({ request, config: config(), ctx: new ApiContext() });
      await api.get('/whoami', { silent: true });
      expect(last().headers.cookie).toBe('sid=browser-session');
    } finally {
      await request.dispose();
    }
  });

  it('apiContext.isolated sends only what the scenario set — no browser cookie jar', async () => {
    const request = await sessionRequest();
    // Built inline (not through the factory) so this test exercises the client alone.
    const fresh = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const isolated = { get: async () => fresh, dispose: () => fresh.dispose() };
    try {
      const ctx = new ApiContext();
      ctx.headers.set('X-API-Key', 'invalid');
      const api = new ApiClient({
        request,
        config: config(),
        ctx,
        isolatedRequest: isolated.get,
      } as any);
      (ctx as any).isolated = true;
      await api.get('/workflows');
      expect(last().headers.cookie).toBeUndefined();
      expect(last().headers['x-api-key']).toBe('invalid');
      // The evidence says which client carried the request.
      expect(ctx.last().request.isolated).toBe(true);
    } finally {
      await isolated.dispose();
      await request.dispose();
    }
  });

  it('the isolated context is created once, lazily, and disposed at teardown', async () => {
    let created = 0;
    const fake = {
      newContext: async (opts: Record<string, unknown>) => {
        created++;
        // An explicit empty jar: Playwright's runner fills in any context option whose key is
        // absent (including the role's storageState), so "absent" is not "empty".
        expect(opts.storageState).toEqual({ cookies: [], origins: [] });
        expect('httpCredentials' in opts).toBe(true);
        expect('extraHTTPHeaders' in opts).toBe(true);
        let disposed = false;
        return {
          dispose: async () => {
            disposed = true;
          },
          get disposed() {
            return disposed;
          },
        };
      },
    };
    const iso = client.isolatedRequestFactory(fake as any);
    await iso.dispose(); // nothing created yet: a no-op
    expect(created).toBe(0);
    const a = await iso.get();
    const b = await iso.get();
    expect(a).toBe(b);
    expect(created).toBe(1);
    await iso.dispose();
    expect((a as any).disposed).toBe(true);
  });

  it('`I use an isolated API client` switches the scenario to the isolated client', async () => {
    const ctx = new ApiContext();
    await step('I use an isolated API client')({ apiContext: ctx });
    expect(ctx.isolated).toBe(true);
  });

  it('raw (no-redirect) requests honour isolation too', async () => {
    const request = await sessionRequest();
    const fresh = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const isolated = { get: async () => fresh, dispose: () => fresh.dispose() };
    try {
      const ctx = new ApiContext();
      (ctx as any).isolated = true;
      const api = new ApiClient({
        request,
        config: config(),
        ctx,
        isolatedRequest: isolated.get,
      } as any);
      await sendRaw(
        { request, api, apiContext: ctx, env: config().env, config: config() } as any,
        'GET',
        '/raw',
      );
      expect(last().path).toBe('/raw');
      expect(last().headers.cookie).toBeUndefined();
    } finally {
      await isolated.dispose();
      await request.dispose();
    }
  });

  it('inside the real test runner, the isolated context does not inherit the role storageState', () => {
    // Playwright's runner copies every `use` context option into a new request context unless the
    // key is present in the options — so this is the case that only a real run can prove.
    const dir = mkdtempSync(join(tmpdir(), 'sdods-iso-run-'));
    const pwDir = dirname(require_.resolve('@playwright/test/package.json'));
    const clientTs = fileURLToPath(new URL('../src/api/client.ts', import.meta.url));
    writeFileSync(
      join(dir, 'iso.spec.ts'),
      `import { test } from ${JSON.stringify(join(pwDir, 'index.js'))};\n` +
        `import { isolatedRequestFactory } from ${JSON.stringify(clientTs)};\n` +
        `test.use({ storageState: { cookies: [{ name: 'sid', value: 'browser-session', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] } });\n` +
        `test('jar', async ({ request, playwright }) => {\n` +
        `  const naive = await playwright.request.newContext();\n` +
        `  const iso = isolatedRequestFactory(playwright.request);\n` +
        `  const names = async (c) => (await c.storageState()).cookies.map((k) => k.name);\n` +
        `  const out = { shared: await names(request), naive: await names(naive), isolated: await names(await iso.get()) };\n` +
        `  await naive.dispose();\n` +
        `  await iso.dispose();\n` +
        `  console.log('JAR=' + JSON.stringify(out));\n` +
        `});\n`,
    );
    writeFileSync(
      join(dir, 'playwright.config.mjs'),
      `export default { testDir: ${JSON.stringify(dir)}, testMatch: '**/*.spec.ts', reporter: 'line' };\n`,
    );
    const run = spawnSync(
      process.execPath,
      [join(pwDir, 'cli.js'), 'test', '-c', join(dir, 'playwright.config.mjs')],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '' } },
    );
    const line = /JAR=(\{.*\})/.exec(run.stdout)?.[1];
    expect(line, run.stdout + run.stderr).toBeDefined();
    expect(JSON.parse(line!)).toEqual({
      shared: ['sid'], // what `api` used on @ui/@hybrid before
      naive: ['sid'], // why the factory passes an explicit empty jar
      isolated: [],
    });
  });
});

describe('#90 — string bodies are delivered byte-for-byte', () => {
  it('a malformed JSON string with content-type application/json is not re-encoded', async () => {
    const request = await playwrightRequest.newContext();
    try {
      const api = new ApiClient({ request, config: config(), ctx: new ApiContext() });
      await api.post('/workflows', {
        body: '{ this is not json',
        headers: { 'content-type': 'application/json' },
        silent: true,
      });
      expect(last().body).toBe('{ this is not json');
      expect(last().headers['content-type']).toBe('application/json');
    } finally {
      await request.dispose();
    }
  });

  it('control: object bodies still arrive as JSON', async () => {
    const request = await playwrightRequest.newContext();
    try {
      const api = new ApiClient({ request, config: config(), ctx: new ApiContext() });
      await api.post('/workflows', { body: { name: 'a', n: 1 }, silent: true });
      expect(JSON.parse(last().body)).toEqual({ name: 'a', n: 1 });
      expect(last().headers['content-type']).toBe('application/json');
    } finally {
      await request.dispose();
    }
  });

  it('`I send a {method} request to {string} with the raw body:` sends the doc string untouched', async () => {
    const request = await playwrightRequest.newContext();
    try {
      const ctx = new ApiContext();
      ctx.vars.set('id', 7);
      const api = new ApiClient({ request, config: config(), ctx });
      await step('I send a {method} request to {string} with the raw body:')(
        { api, apiContext: ctx, env: config().env },
        'POST',
        '/workflows/{{id}}',
        '{ "name": "{{id}}", oops',
      );
      expect(last().path).toBe('/workflows/7');
      expect(last().body).toBe('{ "name": "{{id}}", oops');
      expect(last().headers['content-type']).toBe('application/json');
      // The evidence keeps the text, not a serialised Buffer.
      expect(ctx.last().request.body).toBe('{ "name": "{{id}}", oops');
    } finally {
      await request.dispose();
    }
  });
});

describe('#84 — env.api.auth oauth-client-credentials', () => {
  const oauth = (clientId: string, extra: Record<string, unknown> = {}) => ({
    type: 'oauth-client-credentials',
    tokenUrl: `${base}/token${extra.expiresIn !== undefined ? `?expires_in=${extra.expiresIn}` : ''}`,
    clientId,
    clientSecret: (extra.secret as string) ?? 's3cret',
    scope: 'read write',
    audience: 'https://api.example.com',
  });

  it('mints a token with client credentials and sends it as a bearer, reusing it until expiry', async () => {
    const request = await playwrightRequest.newContext();
    try {
      const api = new ApiClient({
        request,
        config: config(oauth('cc-cache')),
        ctx: new ApiContext(),
      });
      await api.get('/a', { silent: true });
      expect(last().headers.authorization).toBe('Bearer tok-cc-cache-1');
      await api.get('/b', { silent: true });
      expect(last().headers.authorization).toBe('Bearer tok-cc-cache-1');
      expect(tokenHits.get('cc-cache')).toBe(1);
    } finally {
      await request.dispose();
    }
  });

  it('mints a fresh token once the cached one has expired', async () => {
    const request = await playwrightRequest.newContext();
    try {
      const api = new ApiClient({
        request,
        config: config(oauth('cc-expiry', { expiresIn: 1 })),
        ctx: new ApiContext(),
      });
      await api.get('/a', { silent: true });
      await api.get('/b', { silent: true });
      expect(last().headers.authorization).toBe('Bearer tok-cc-expiry-2');
      expect(tokenHits.get('cc-expiry')).toBe(2);
    } finally {
      await request.dispose();
    }
  });

  it('a refused token request fails the call as AUTH_FAILED instead of going out anonymous', async () => {
    const request = await playwrightRequest.newContext();
    const before = received.length;
    try {
      const api = new ApiClient({
        request,
        config: config(oauth('cc-refused', { secret: 'wrong' })),
        ctx: new ApiContext(),
      });
      const err = await api.get('/a', { silent: true }).catch((e) => e);
      expect(isSdodsError(err) && err.code).toBe('AUTH_FAILED');
      expect(received.length).toBe(before);
    } finally {
      await request.dispose();
    }
  });

  it('`I use no authentication` still wins over the environment credential', async () => {
    const request = await playwrightRequest.newContext();
    try {
      const ctx = new ApiContext();
      ctx.auth = null;
      const api = new ApiClient({ request, config: config(oauth('cc-none')), ctx });
      await api.get('/a', { silent: true });
      expect(last().headers.authorization).toBeUndefined();
      expect(tokenHits.get('cc-none')).toBeUndefined();
    } finally {
      await request.dispose();
    }
  });

  it('raw (no-redirect) requests use the same credential resolution', async () => {
    const request = await playwrightRequest.newContext();
    try {
      const cfg = config(oauth('cc-raw'));
      const ctx = new ApiContext();
      const api = new ApiClient({ request, config: cfg, ctx });
      await sendRaw(
        { request, api, apiContext: ctx, env: cfg.env, config: cfg } as any,
        'GET',
        '/raw',
      );
      expect(last().headers.authorization).toBe('Bearer tok-cc-raw-1');
      // …and `I use no authentication` is honoured there as well (`null ?? env` used to fall back).
      ctx.auth = null;
      await sendRaw(
        { request, api, apiContext: ctx, env: cfg.env, config: cfg } as any,
        'GET',
        '/raw',
      );
      expect(last().headers.authorization).toBeUndefined();
    } finally {
      await request.dispose();
    }
  });

  it('an auth type the client does not implement throws NOT_SUPPORTED', async () => {
    const request = await playwrightRequest.newContext();
    const before = received.length;
    try {
      const api = new ApiClient({
        request,
        config: config({ type: 'digest', username: 'u', password: 'p' }),
        ctx: new ApiContext(),
      });
      const err = await api.get('/a', { silent: true }).catch((e) => e);
      expect(isSdodsError(err) && err.code).toBe('NOT_SUPPORTED');
      expect(received.length).toBe(before);
    } finally {
      await request.dispose();
    }
  });
});

/* ── registered step lookup (same approach as net.test.ts) ──────────── */

const require_ = createRequire(import.meta.url);
const { stepDefinitions } = require_(
  require_.resolve('playwright-bdd').replace(/index\.js$/, 'steps/stepRegistry.js'),
) as { stepDefinitions: Array<{ pattern: unknown; fn: (...a: any[]) => unknown }> };

function step(pattern: string): (fx: any, ...args: any[]) => Promise<void> {
  const found = stepDefinitions.filter((d) => String(d.pattern) === pattern);
  expect(found, `definitions registered for "${pattern}"`).toHaveLength(1);
  return found[0]!.fn as (fx: any, ...args: any[]) => Promise<void>;
}
