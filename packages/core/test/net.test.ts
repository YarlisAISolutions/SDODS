import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiContext } from '../src/fixtures/api-context.js';
import { isSdodsError } from '../src/errors.js';
import { credentialFindings, globToRegExp, parseEventStream } from '../src/steps/net.steps.js';

/**
 * These tests drive the REAL registered step functions, not a re-implementation: playwright-bdd
 * keeps every definition in a module-level array, so a step can be looked up by its Gherkin
 * pattern and invoked as `fn(fixtures, ...args)`.
 *
 * Every `Then` is exercised in BOTH directions. A one-directional test is exactly as vacuous as
 * the steps this library exists to replace.
 */
const require_ = createRequire(import.meta.url);
const registryPath = require_
  .resolve('playwright-bdd')
  .replace(/index\.js$/, 'steps/stepRegistry.js');
const { stepDefinitions } = require_(registryPath) as {
  stepDefinitions: Array<{ pattern: unknown; fn: (...a: any[]) => unknown }>;
};

/** Every pattern this library owns. A rename or an accidental duplicate fails here first. */
const PATTERNS = [
  'I send a {method} request to {string} without following redirects',
  'I send a {method} request to {string} without following redirects with body:',
  'I send a {method} request to {string} without following redirects with form:',
  'the raw response status should be {int}',
  'the raw response status should be one of {string}',
  'the raw response Location should be {string}',
  'the raw response Location should contain {string}',
  'the raw response header {string} should contain {string}',
  'the raw response should have no {string} header',
  'the raw response body should contain {string}',
  'the raw response should set the {string} cookie',
  'the raw response should not set the {string} cookie',
  'the raw response cookie {string} should carry {string}',
  'the raw response cookie {string} should be cleared',
  'I save the raw response body as {string}',
  'the raw response body should be identical to {string}',
  'I click the {string} {role} and capture the download',
  'I click the element with test id {string} and capture the download',
  'the downloaded file name should end with {string}',
  'the downloaded file name should contain {string}',
  'the downloaded text first line should be {string}',
  'the downloaded text should contain {string}',
  'the downloaded text should have at least {int} data rows',
  'the downloaded text should have at most {int} data rows',
  'the downloaded JSON path {string} should equal {string}',
  'the downloaded JSON path {string} should have {int} items',
  'I allow {int} seconds for the event stream',
  'I read the event stream from a {method} request to {string}',
  'I read the event stream from a {method} request to {string} with body:',
  'the stream status should be {int}',
  'the stream content type should be {string}',
  'the stream should have at least {int} events',
  'the first stream event type should be {string}',
  'the last stream event type should be {string}',
  'the stream should have terminated cleanly',
  'I record outgoing browser requests',
  'I start counting requests to {string}',
  '{int} requests should have been counted for {string}',
  'at most {int} requests should have been counted for {string}',
  'at least {int} requests should have been counted for {string}',
  'no requests should have been counted for {string}',
  'no request matching {string} should have been made',
  'a request matching {string} should have been made',
  'the response should have no {string} header',
  'the response JSON path {string} should not exist',
  'the response should not contain any of {string}',
  'nothing in the response body should look like a credential',
  'nothing in the raw response body should look like a credential',
];

function step(pattern: string): (fx: any, ...args: any[]) => Promise<void> {
  const found = stepDefinitions.filter((d) => String(d.pattern) === pattern);
  expect(found, `definitions registered for "${pattern}"`).toHaveLength(1);
  return found[0]!.fn as (fx: any, ...args: any[]) => Promise<void>;
}

/** Assert a step rejects with an SdodsError carrying a usable hint. */
async function expectSdodsError(promise: Promise<unknown>, codeOrText?: string) {
  let caught: unknown;
  await promise.catch((e) => {
    caught = e;
  });
  expect(caught, 'expected the step to throw').toBeDefined();
  expect(isSdodsError(caught), `expected an SdodsError, got: ${String(caught)}`).toBe(true);
  const err = caught as { code: string; hint?: string; message: string };
  expect(err.hint, 'SdodsError must carry a hint').toBeTruthy();
  if (codeOrText) expect(`${err.code} ${err.message}`).toContain(codeOrText);
}

/* ── fakes ────────────────────────────────────────────────────────────── */

const config = {
  project: { timeouts: { api: 15_000, navigation: 30_000, action: 15_000 } },
} as any;

function makeEnv(over: Record<string, any> = {}) {
  return {
    name: 'test',
    api: {
      baseUrl: 'http://api.test/v1',
      headers: {},
      auth: { type: 'none' },
      ...(over.api ?? {}),
    },
    vars: over.vars ?? {},
  } as any;
}

interface FakeResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  setCookies?: string[];
  body?: string;
  throws?: string;
}

function fakeRequest(res: FakeResponse = {}) {
  const calls: Array<{ url: string; opts: any }> = [];
  return {
    calls,
    fetch: async (url: string, opts: any) => {
      calls.push({ url, opts });
      if (res.throws) throw new Error(res.throws);
      // Playwright's headers() comma-joins repeats — Set-Cookie included, which is precisely why
      // the raw family reads headersArray() instead.
      const headers: Record<string, string> = { ...(res.headers ?? {}) };
      if (res.setCookies?.length) headers['set-cookie'] = res.setCookies.join(', ');
      return {
        status: () => res.status ?? 200,
        statusText: () => res.statusText ?? 'OK',
        headers: () => headers,
        headersArray: () => [
          ...Object.entries(headers)
            .filter(([name]) => name.toLowerCase() !== 'set-cookie')
            .map(([name, value]) => ({ name, value })),
          ...(res.setCookies ?? []).map((value) => ({ name: 'Set-Cookie', value })),
        ],
        text: async () => res.body ?? '',
      };
    },
  } as any;
}

function fakePage() {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  let nextDownload: any;
  const page: any = {
    on(event: string, fn: (...a: any[]) => void) {
      (listeners[event] ??= []).push(fn);
    },
    emitRequest(method: string, url: string) {
      for (const fn of listeners.request ?? []) fn({ method: () => method, url: () => url });
    },
    setDownload(d: any) {
      nextDownload = d;
    },
    async waitForEvent() {
      return nextDownload;
    },
    getByRole: () => 'role-locator',
    getByTestId: () => 'testid-locator',
  };
  return page;
}

const clicks: string[] = [];
const heal = {
  resolve: async (_loc: unknown, ctx: { description: string }) => ({
    click: async () => {
      clicks.push(ctx.description);
    },
  }),
} as any;

function fakeDownload(opts: { name?: string; file?: string; failure?: string }) {
  return {
    suggestedFilename: () => opts.name ?? 'export.csv',
    path: async () => opts.file ?? null,
    failure: async () => opts.failure ?? null,
  } as any;
}

function tmpFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-net-'));
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
}

function recordResponse(
  apiContext: ApiContext,
  res: { status?: number; headers?: Record<string, string>; body?: unknown },
) {
  apiContext.record(
    {
      request: { method: 'GET', url: 'http://api.test/v1/x', headers: {} },
      response: {
        status: res.status ?? 200,
        statusText: 'OK',
        headers: res.headers ?? {},
        body: res.body ?? null,
        responseTime: 1,
      },
      startedAt: '2024-01-01T00:00:00.000Z',
    } as any,
    0,
  );
}

/* ── registration ─────────────────────────────────────────────────────── */

describe('net.steps registration', () => {
  it('registers every pattern exactly once', () => {
    const counts = new Map<string, number>();
    for (const d of stepDefinitions) {
      const p = String(d.pattern);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const duplicated = PATTERNS.filter((p) => (counts.get(p) ?? 0) !== 1);
    expect(duplicated, 'patterns missing or registered more than once').toEqual([]);
  });

  it('declares every pattern the source file defines', () => {
    // Guards the list above: a step added to net.steps.ts without an entry here would otherwise
    // ship untested, and the "exactly once" check would never look at it.
    const src = readFileSync(new URL('../src/steps/net.steps.ts', import.meta.url), 'utf8');
    const declared = [...src.matchAll(/\b(?:Given|When|Then)\(\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)].map(
      (m) => m[1]!,
    );
    expect([...declared].sort()).toEqual([...PATTERNS].sort());
  });

  it('does not re-use a pattern already owned by the built-in api/ui libraries', async () => {
    // Loading the whole core library must not produce a duplicate: bddgen would then be unable
    // to decide which implementation a scenario meant.
    await import('../src/steps/index.js');
    const counts = new Map<string, number>();
    for (const d of stepDefinitions) {
      const p = String(d.pattern);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });
});

/* ── raw requests ─────────────────────────────────────────────────────── */

describe('raw requests', () => {
  let apiContext: ApiContext;
  beforeEach(() => {
    apiContext = new ApiContext();
  });

  it('never follows a redirect and keeps the 3xx', async () => {
    const request = fakeRequest({ status: 307, headers: { location: '/login' } });
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'GET',
      '/dashboard',
    );
    expect(request.calls[0].opts.maxRedirects).toBe(0);
    expect(request.calls[0].opts.failOnStatusCode).toBe(false);
    await expect(
      step('the raw response status should be {int}')({ apiContext }, 307),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response status should be {int}')({ apiContext }, 200),
    ).rejects.toThrow();
  });

  it('interpolates the path, the body and form values', async () => {
    const request = fakeRequest();
    apiContext.vars.set('id', 'abc');
    const env = makeEnv({ vars: { tenant: 'acme' } });
    await step('I send a {method} request to {string} without following redirects with body:')(
      { request, apiContext, env, config },
      'POST',
      '/w/{{id}}/run',
      '{"tenant":"{{tenant}}"}',
    );
    expect(request.calls[0].url).toBe('http://api.test/v1/w/abc/run');
    // Sent as bytes, so Playwright cannot JSON-encode a body that does not parse.
    expect(Buffer.isBuffer(request.calls[0].opts.data)).toBe(true);
    expect(String(request.calls[0].opts.data)).toBe('{"tenant":"acme"}');

    await step('I send a {method} request to {string} without following redirects with form:')(
      { request, apiContext, env, config },
      'POST',
      '/login',
      { raw: () => [['email', 'u@{{tenant}}.test']] },
    );
    expect(request.calls[1].opts.form).toEqual({ email: 'u@acme.test' });
  });

  it('refuses a path whose variable did not resolve', async () => {
    await expectSdodsError(
      step('I send a {method} request to {string} without following redirects')(
        { request: fakeRequest(), apiContext, env: makeEnv(), config },
        'GET',
        '/w/{{missing}}',
      ),
      'CONFIG_UNRESOLVED_VAR',
    );
  });

  it('applies the scenario auth and the env auth, so a raw request is never silently anonymous', async () => {
    const request = fakeRequest();
    apiContext.auth = { type: 'bearer', token: 'T0KEN' };
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'GET',
      '/me',
    );
    expect(request.calls[0].opts.headers.authorization).toBe('Bearer T0KEN');

    const ctx2 = new ApiContext();
    const req2 = fakeRequest();
    await step('I send a {method} request to {string} without following redirects')(
      {
        request: req2,
        apiContext: ctx2,
        env: makeEnv({ api: { auth: { type: 'header', name: 'X-Key', value: 'K' } } }),
        config,
      },
      'GET',
      '/me',
    );
    expect(req2.calls[0].opts.headers['x-key']).toBe('K');
  });

  it('carries the scenario headers and query parameters', async () => {
    const request = fakeRequest();
    apiContext.headers.set('Accept', 'text/html');
    apiContext.query.set('locale', 'fr');
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'GET',
      '/page',
    );
    expect(request.calls[0].opts.headers.accept).toBe('text/html');
    expect(request.calls[0].url).toBe('http://api.test/v1/page?locale=fr');
  });

  it('asserts Location exactly, so a truncated return-to cannot pass', async () => {
    const request = fakeRequest({
      status: 302,
      headers: { location: '/login?next=%2Fbilling' },
    });
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'GET',
      '/billing',
    );
    await expect(
      step('the raw response Location should be {string}')(
        { apiContext, env: makeEnv() },
        '/login?next=%2Fbilling',
      ),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response Location should be {string}')(
        { apiContext, env: makeEnv() },
        '/login',
      ),
    ).rejects.toThrow();
    await expect(
      step('the raw response Location should contain {string}')(
        { apiContext, env: makeEnv() },
        '/login',
      ),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response Location should contain {string}')(
        { apiContext, env: makeEnv() },
        '/signup',
      ),
    ).rejects.toThrow();
  });

  it('interpolates the expected Location', async () => {
    apiContext.vars.set('wid', 'w1');
    const request = fakeRequest({ status: 307, headers: { location: '/w/w1' } });
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'GET',
      '/',
    );
    await expect(
      step('the raw response Location should be {string}')(
        { apiContext, env: makeEnv() },
        '/w/{{wid}}',
      ),
    ).resolves.toBeUndefined();
  });

  it('distinguishes an absent header from a header that does not contain a value', async () => {
    const request = fakeRequest({ status: 405, headers: { allow: 'GET, HEAD' } });
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'POST',
      '/page',
    );
    await expect(
      step('the raw response header {string} should contain {string}')(
        { apiContext, env: makeEnv() },
        'Allow',
        'HEAD',
      ),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response should have no {string} header')(
        { apiContext, env: makeEnv() },
        'Allow',
      ),
    ).rejects.toThrow();
    await expect(
      step('the raw response should have no {string} header')(
        { apiContext, env: makeEnv() },
        'X-Debug',
      ),
    ).resolves.toBeUndefined();
    await expectSdodsError(
      step('the raw response should have no {string} header')(
        { apiContext, env: makeEnv() },
        'X-{{nope}}',
      ),
      'CONFIG_UNRESOLVED_VAR',
    );
  });

  it('reads every Set-Cookie line, which headers() would have collapsed', async () => {
    const request = fakeRequest({
      setCookies: [
        '__session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=3300',
        'theme=dark; Path=/',
      ],
    });
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'POST',
      '/login',
    );
    const env = makeEnv();
    await expect(
      step('the raw response should set the {string} cookie')({ apiContext, env }, '__session'),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response should set the {string} cookie')({ apiContext, env }, 'other'),
    ).rejects.toThrow();
    await expect(
      step('the raw response should not set the {string} cookie')({ apiContext, env }, '__session'),
    ).rejects.toThrow();
    await expect(
      step('the raw response should not set the {string} cookie')({ apiContext, env }, 'other'),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response cookie {string} should carry {string}')(
        { apiContext, env },
        '__session',
        'httponly',
      ),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response cookie {string} should carry {string}')(
        { apiContext, env },
        '__session',
        'Secure',
      ),
    ).rejects.toThrow();
    await expect(
      step('the raw response cookie {string} should be cleared')({ apiContext, env }, '__session'),
    ).rejects.toThrow();
  });

  it('counts a Max-Age=0 line as a deletion, not as a grant', async () => {
    const request = fakeRequest({ setCookies: ['__session=; Path=/; Max-Age=0'] });
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'POST',
      '/logout',
    );
    const env = makeEnv();
    await expect(
      step('the raw response should not set the {string} cookie')({ apiContext, env }, '__session'),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response cookie {string} should be cleared')({ apiContext, env }, '__session'),
    ).resolves.toBeUndefined();
  });

  it('compares saved bodies byte for byte', async () => {
    const env = makeEnv();
    const send = step('I send a {method} request to {string} without following redirects');
    await send(
      { request: fakeRequest({ body: '{"error":"no such account"}' }), apiContext, env, config },
      'POST',
      '/reset',
    );
    await step('I save the raw response body as {string}')({ apiContext }, 'first');
    await send(
      { request: fakeRequest({ body: '{"error":"no such account"}' }), apiContext, env, config },
      'POST',
      '/reset',
    );
    await expect(
      step('the raw response body should be identical to {string}')({ apiContext }, 'first'),
    ).resolves.toBeUndefined();
    await send(
      { request: fakeRequest({ body: '{"error":"No such account"}' }), apiContext, env, config },
      'POST',
      '/reset',
    );
    await expect(
      step('the raw response body should be identical to {string}')({ apiContext }, 'first'),
    ).rejects.toThrow();
    await expectSdodsError(
      step('the raw response body should be identical to {string}')({ apiContext }, 'never-saved'),
    );
  });

  it('asserts the raw body text, in both directions, with interpolation', async () => {
    apiContext.vars.set('code', 'EMAIL_NOT_VERIFIED');
    await step('I send a {method} request to {string} without following redirects')(
      {
        request: fakeRequest({ status: 403, body: '{"code":"EMAIL_NOT_VERIFIED"}' }),
        apiContext,
        env: makeEnv(),
        config,
      },
      'GET',
      '/billing',
    );
    const fx = { apiContext, env: makeEnv() };
    await expect(
      step('the raw response body should contain {string}')(fx, '{{code}}'),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response body should contain {string}')(fx, 'PAYMENT_REQUIRED'),
    ).rejects.toThrow();
  });

  it('redacts credential headers in the attached evidence but keeps the cookie names', async () => {
    // The raw family exists so the ASSERTIONS can see Set-Cookie; the report artefact must still
    // redact exactly what ApiClient redacts, or every run writes a live session cookie to disk.
    const attached: Array<{ name: string; payload: any }> = [];
    apiContext.headers.set('cookie', '__session=live-value');
    await step('I send a {method} request to {string} without following redirects')(
      {
        request: fakeRequest({ setCookies: ['__session=granted; Path=/; HttpOnly'] }),
        apiContext,
        env: makeEnv({ api: { auth: { type: 'header', name: 'X-Api-Key', value: 'K' } } }),
        config,
        $testInfo: {
          attach: async (name: string, opts: { body: string }) => {
            attached.push({ name, payload: JSON.parse(opts.body) });
          },
        },
      },
      'GET',
      '/me',
    );
    expect(attached).toHaveLength(1);
    const { request: req, response: res } = attached[0]!.payload;
    expect(req.headers.cookie).toBe('***');
    expect(req.headers['x-api-key']).toBe('***');
    expect(res.headers['set-cookie']).toBe('***');
    expect(res.setCookieNames).toEqual(['__session']);
    // and the assertion path still sees the real value
    await expect(
      step('the raw response cookie {string} should carry {string}')(
        { apiContext, env: makeEnv() },
        '__session',
        'HttpOnly',
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses an assertion made before any raw request', async () => {
    await expectSdodsError(step('the raw response status should be {int}')({ apiContext }, 200));
  });

  it('refuses a status list that is not a list of codes', async () => {
    const request = fakeRequest({ status: 302 });
    await step('I send a {method} request to {string} without following redirects')(
      { request, apiContext, env: makeEnv(), config },
      'GET',
      '/',
    );
    await expectSdodsError(
      step('the raw response status should be one of {string}')({ apiContext }, 'redirects'),
    );
    await expect(
      step('the raw response status should be one of {string}')({ apiContext }, '301, 302, 307'),
    ).resolves.toBeUndefined();
    await expect(
      step('the raw response status should be one of {string}')({ apiContext }, '200, 204'),
    ).rejects.toThrow();
  });
});

/* ── downloads ────────────────────────────────────────────────────────── */

describe('downloads', () => {
  it('captures a download from a healed click and asserts its name', async () => {
    const page = fakePage();
    page.setDownload(fakeDownload({ name: 'usage-2024.csv' }));
    await step('I click the {string} {role} and capture the download')(
      { page, heal, config, apiContext: new ApiContext(), env: makeEnv() },
      'Export',
      'button',
    );
    expect(clicks.at(-1)).toBe('button "Export"');
    const env = makeEnv();
    await expect(
      step('the downloaded file name should end with {string}')(
        { page, apiContext: new ApiContext(), env },
        '.csv',
      ),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded file name should end with {string}')(
        { page, apiContext: new ApiContext(), env },
        '.json',
      ),
    ).rejects.toThrow();
  });

  it('uses endsWith, so a middle match cannot pass', async () => {
    const page = fakePage();
    page.setDownload(fakeDownload({ name: 'report.json.txt' }));
    await step('I click the element with test id {string} and capture the download')(
      { page, heal, config, apiContext: new ApiContext(), env: makeEnv() },
      'export',
    );
    await expect(
      step('the downloaded file name should end with {string}')(
        { page, apiContext: new ApiContext(), env: makeEnv() },
        '.json',
      ),
    ).rejects.toThrow();
    await expect(
      step('the downloaded file name should contain {string}')(
        { page, apiContext: new ApiContext(), env: makeEnv() },
        '.json',
      ),
    ).resolves.toBeUndefined();
  });

  it('asserts the CSV header row and the row count in both directions', async () => {
    const page = fakePage();
    page.setDownload(
      fakeDownload({
        file: tmpFile('usage.csv', 'date,tokens,cost\n2024-01-01,10,0.1\n2024-01-02,20,0.2\n'),
      }),
    );
    await step('I click the element with test id {string} and capture the download')(
      { page, heal, config, apiContext: new ApiContext(), env: makeEnv() },
      'x',
    );
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await expect(
      step('the downloaded text first line should be {string}')(fx, 'date,tokens,cost'),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded text first line should be {string}')(fx, 'date,tokens'),
    ).rejects.toThrow();
    await expect(
      step('the downloaded text should have at most {int} data rows')(fx, 2),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded text should have at most {int} data rows')(fx, 1),
    ).rejects.toThrow();
    await expect(
      step('the downloaded text should have at least {int} data rows')(fx, 2),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded text should have at least {int} data rows')(fx, 3),
    ).rejects.toThrow();
    await expect(
      step('the downloaded text should contain {string}')(fx, '2024-01-02'),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded text should contain {string}')(fx, '2025-01-01'),
    ).rejects.toThrow();
  });

  it('refuses an empty export instead of passing every assertion over it', async () => {
    const page = fakePage();
    page.setDownload(fakeDownload({ file: tmpFile('empty.csv', '') }));
    await step('I click the element with test id {string} and capture the download')(
      { page, heal, config, apiContext: new ApiContext(), env: makeEnv() },
      'x',
    );
    await expectSdodsError(
      step('the downloaded text should have at most {int} data rows')(
        { page, apiContext: new ApiContext(), env: makeEnv() },
        5,
      ),
    );
  });

  it('reports why a download never landed', async () => {
    const page = fakePage();
    page.setDownload(fakeDownload({ file: undefined, failure: 'net::ERR_ABORTED' }));
    await step('I click the element with test id {string} and capture the download')(
      { page, heal, config, apiContext: new ApiContext(), env: makeEnv() },
      'x',
    );
    await expectSdodsError(
      step('the downloaded text should contain {string}')(
        { page, apiContext: new ApiContext(), env: makeEnv() },
        'anything',
      ),
      'net::ERR_ABORTED',
    );
  });

  it('reads the exported JSON, arrays and keyed records alike', async () => {
    const page = fakePage();
    page.setDownload(
      fakeDownload({
        file: tmpFile(
          'wf.json',
          JSON.stringify({ name: 'flow', blocks: { a: {}, b: {} }, edges: [1, 2, 3] }),
        ),
      }),
    );
    await step('I click the element with test id {string} and capture the download')(
      { page, heal, config, apiContext: new ApiContext(), env: makeEnv() },
      'x',
    );
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await expect(
      step('the downloaded JSON path {string} should equal {string}')(fx, 'name', 'flow'),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded JSON path {string} should equal {string}')(fx, 'name', 'other'),
    ).rejects.toThrow();
    await expect(
      step('the downloaded JSON path {string} should have {int} items')(fx, 'blocks', 2),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded JSON path {string} should have {int} items')(fx, 'edges', 3),
    ).resolves.toBeUndefined();
    await expect(
      step('the downloaded JSON path {string} should have {int} items')(fx, 'edges', 2),
    ).rejects.toThrow();
    await expectSdodsError(
      step('the downloaded JSON path {string} should have {int} items')(fx, 'name', 1),
    );
  });

  it('refuses a non-JSON export rather than reporting an absent path', async () => {
    const page = fakePage();
    page.setDownload(fakeDownload({ file: tmpFile('a.csv', 'a,b\n1,2\n') }));
    await step('I click the element with test id {string} and capture the download')(
      { page, heal, config, apiContext: new ApiContext(), env: makeEnv() },
      'x',
    );
    await expectSdodsError(
      step('the downloaded JSON path {string} should equal {string}')(
        { page, apiContext: new ApiContext(), env: makeEnv() },
        'a',
        '1',
      ),
    );
  });

  it('refuses an assertion made before any download was captured', async () => {
    await expectSdodsError(
      step('the downloaded file name should end with {string}')(
        { page: fakePage(), apiContext: new ApiContext(), env: makeEnv() },
        '.csv',
      ),
    );
  });
});

/* ── server-sent events ───────────────────────────────────────────────── */

describe('parseEventStream', () => {
  it('reads the event field, joins multi-line data and ignores comments', () => {
    const { events, endedWithDelimiter } = parseEventStream(
      ': keepalive\n\nevent: start\ndata: {"id":1}\n\ndata: line one\ndata: line two\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('start');
    expect(events[1]!.data).toBe('line one\nline two');
    expect(endedWithDelimiter).toBe(true);
  });

  it('falls back to the JSON type, then to a bracketed sentinel', () => {
    const { events } = parseEventStream('data: {"type":"chunk"}\n\ndata: [DONE]\n\n');
    expect(events.map((e) => e.type)).toEqual(['chunk', '[DONE]']);
  });

  it('handles CRLF and reports a body cut mid-frame', () => {
    const cut = parseEventStream('data: {"type":"chunk"}\r\n\r\ndata: {"type":"chun');
    expect(cut.events.map((e) => e.type)).toEqual(['chunk', undefined]);
    expect(cut.endedWithDelimiter).toBe(false);
  });
});

describe('event stream steps', () => {
  let apiContext: ApiContext;
  beforeEach(() => {
    apiContext = new ApiContext();
  });

  const goodStream = 'event: start\ndata: {}\n\nevent: done\ndata: {}\n\n';

  async function read(res: FakeResponse, path = '/chat', body?: string) {
    const request = fakeRequest(res);
    const fx = { request, apiContext, env: makeEnv(), config, $testInfo: undefined };
    if (body === undefined)
      await step('I read the event stream from a {method} request to {string}')(fx, 'POST', path);
    else
      await step('I read the event stream from a {method} request to {string} with body:')(
        fx,
        'POST',
        path,
        body,
      );
    return request;
  }

  it('requests text/event-stream and interpolates path and body', async () => {
    apiContext.vars.set('id', 'c1');
    const request = await read(
      { headers: { 'content-type': 'text/event-stream' }, body: goodStream },
      '/chat/{{id}}',
      '{"q":"{{id}}"}',
    );
    expect(request.calls[0].url).toBe('http://api.test/v1/chat/c1');
    expect(request.calls[0].opts.headers.accept).toBe('text/event-stream');
    expect(String(request.calls[0].opts.data)).toBe('{"q":"c1"}');
  });

  it('asserts content type, first and last event in both directions', async () => {
    await read({
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: goodStream,
    });
    await expect(
      step('the stream content type should be {string}')(
        { apiContext, env: makeEnv() },
        'text/event-stream',
      ),
    ).resolves.toBeUndefined();
    await expect(
      step('the stream content type should be {string}')(
        { apiContext, env: makeEnv() },
        'application/json',
      ),
    ).rejects.toThrow();
    await expect(
      step('the first stream event type should be {string}')(
        { apiContext, env: makeEnv() },
        'start',
      ),
    ).resolves.toBeUndefined();
    await expect(
      step('the first stream event type should be {string}')(
        { apiContext, env: makeEnv() },
        'done',
      ),
    ).rejects.toThrow();
    await expect(
      step('the last stream event type should be {string}')({ apiContext, env: makeEnv() }, 'done'),
    ).resolves.toBeUndefined();
    await expect(
      step('the last stream event type should be {string}')(
        { apiContext, env: makeEnv() },
        'start',
      ),
    ).rejects.toThrow();
    await expect(
      step('the stream status should be {int}')({ apiContext }, 200),
    ).resolves.toBeUndefined();
    await expect(step('the stream status should be {int}')({ apiContext }, 500)).rejects.toThrow();
  });

  it('interpolates the expected event type', async () => {
    apiContext.vars.set('terminal', 'done');
    await read({ body: goodStream });
    await expect(
      step('the last stream event type should be {string}')(
        { apiContext, env: makeEnv() },
        '{{terminal}}',
      ),
    ).resolves.toBeUndefined();
  });

  it('a 200 that dies mid-stream is caught by clean termination, not by the status', async () => {
    await read({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: 'event: start\ndata: {}\n\nevent: chun',
    });
    await expect(
      step('the stream status should be {int}')({ apiContext }, 200),
    ).resolves.toBeUndefined();
    await expect(
      step('the stream should have terminated cleanly')({ apiContext }),
    ).rejects.toThrow();
  });

  it('an empty stream terminates neither cleanly nor with events', async () => {
    await read({ body: '' });
    await expect(
      step('the stream should have terminated cleanly')({ apiContext }),
    ).rejects.toThrow();
    await expect(
      step('the first stream event type should be {string}')(
        { apiContext, env: makeEnv() },
        'start',
      ),
    ).rejects.toThrow();
  });

  it('a body of nothing but a frame delimiter does not count as terminated', async () => {
    await read({ body: '\n\n' });
    await expect(
      step('the stream should have terminated cleanly')({ apiContext }),
    ).rejects.toThrow();
  });

  it('a transport failure surfaces as the reason, not as "no stream"', async () => {
    await read({ throws: 'socket hang up' });
    await expect(step('the stream should have terminated cleanly')({ apiContext })).rejects.toThrow(
      /socket hang up/,
    );
  });

  it('accepts a clean stream', async () => {
    await read({ body: goodStream });
    await expect(
      step('the stream should have terminated cleanly')({ apiContext }),
    ).resolves.toBeUndefined();
    await expect(
      step('the stream should have at least {int} events')({ apiContext }, 2),
    ).resolves.toBeUndefined();
    await expect(
      step('the stream should have at least {int} events')({ apiContext }, 3),
    ).rejects.toThrow();
  });

  it('refuses "at least 0 events", which nothing can fail', async () => {
    await read({ body: goodStream });
    await expectSdodsError(step('the stream should have at least {int} events')({ apiContext }, 0));
  });

  it('honours the stream timeout override', async () => {
    await step('I allow {int} seconds for the event stream')({ apiContext }, 90);
    const request = await read({ body: goodStream });
    expect(request.calls[0].opts.timeout).toBe(90_000);
  });

  it('refuses an assertion made before any stream was read', async () => {
    await expectSdodsError(step('the stream should have terminated cleanly')({ apiContext }));
  });
});

/* ── request accounting ───────────────────────────────────────────────── */

describe('globToRegExp', () => {
  it('follows Playwright route-glob semantics', () => {
    expect(globToRegExp('**/api/users').test('https://a.test/v1/api/users')).toBe(true);
    expect(globToRegExp('**/api/**').test('https://a.test/api/users/1')).toBe(true);
    expect(globToRegExp('https://a.test/api/*').test('https://a.test/api/users')).toBe(true);
    // a single star does not cross a path separator
    expect(globToRegExp('https://a.test/api/*').test('https://a.test/api/users/1')).toBe(false);
    expect(globToRegExp('https://a.test/?').test('https://a.test/x')).toBe(true);
    expect(globToRegExp('https://a.test/?').test('https://a.test/xy')).toBe(false);
    // anchored, and regex metacharacters in the glob are literals
    expect(globToRegExp('**/a.b').test('https://x/aXb')).toBe(false);
    expect(globToRegExp('**/users').test('https://x/users/1')).toBe(false);
  });
});

describe('request accounting', () => {
  it('counts only requests issued after the counter started', async () => {
    const page = fakePage();
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await step('I record outgoing browser requests')(fx);
    page.emitRequest('GET', 'https://app.test/api/list');
    await step('I start counting requests to {string}')(fx, '**/api/**');
    page.emitRequest('GET', 'https://app.test/api/list');
    page.emitRequest('GET', 'https://app.test/static/logo.png');
    await expect(
      step('{int} requests should have been counted for {string}')(fx, 1, '**/api/**'),
    ).resolves.toBeUndefined();
    await expect(
      step('{int} requests should have been counted for {string}')(fx, 2, '**/api/**'),
    ).rejects.toThrow();
    await expect(
      step('at most {int} requests should have been counted for {string}')(fx, 1, '**/api/**'),
    ).resolves.toBeUndefined();
    await expect(
      step('at most {int} requests should have been counted for {string}')(fx, 0, '**/api/**'),
    ).rejects.toThrow();
    await expect(
      step('at least {int} requests should have been counted for {string}')(fx, 1, '**/api/**'),
    ).resolves.toBeUndefined();
    await expect(
      step('at least {int} requests should have been counted for {string}')(fx, 2, '**/api/**'),
    ).rejects.toThrow();
  });

  it('proves a client did not call an endpoint, and fails when it did', async () => {
    const page = fakePage();
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await step('I start counting requests to {string}')(fx, '**/api/deploy');
    await expect(
      step('no requests should have been counted for {string}')(fx, '**/api/deploy'),
    ).resolves.toBeUndefined();
    page.emitRequest('POST', 'https://app.test/api/deploy');
    await expect(
      step('no requests should have been counted for {string}')(fx, '**/api/deploy'),
    ).rejects.toThrow();
  });

  it('spans the whole recording for a leak assertion', async () => {
    const page = fakePage();
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await step('I record outgoing browser requests')(fx);
    page.emitRequest('GET', 'https://app.test/');
    await expect(
      step('no request matching {string} should have been made')(fx, '**analytics**'),
    ).resolves.toBeUndefined();
    await expect(
      step('a request matching {string} should have been made')(fx, '**analytics**'),
    ).rejects.toThrow();
    page.emitRequest('POST', 'https://third-party.test/analytics/collect');
    await expect(
      step('no request matching {string} should have been made')(fx, '**analytics**'),
    ).rejects.toThrow();
    await expect(
      step('a request matching {string} should have been made')(fx, '**analytics**'),
    ).resolves.toBeUndefined();
  });

  it('interpolates the glob', async () => {
    const page = fakePage();
    const apiContext = new ApiContext();
    apiContext.vars.set('wid', 'w7');
    const fx = { page, apiContext, env: makeEnv() };
    await step('I start counting requests to {string}')(fx, '**/api/{{wid}}/**');
    page.emitRequest('GET', 'https://app.test/api/w7/runs');
    page.emitRequest('GET', 'https://app.test/api/w8/runs');
    await expect(
      step('{int} requests should have been counted for {string}')(fx, 1, '**/api/{{wid}}/**'),
    ).resolves.toBeUndefined();
  });

  it('refuses an unresolved glob, which would match nothing and pass for ever', async () => {
    const page = fakePage();
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await expectSdodsError(
      step('I start counting requests to {string}')(fx, '**/api/{{wid}}/**'),
      'CONFIG_UNRESOLVED_VAR',
    );
    await expectSdodsError(
      step('no request matching {string} should have been made')(fx, '**/{{host}}/**'),
      'CONFIG_UNRESOLVED_VAR',
    );
  });

  it('refuses a bare fragment, which is not a glob and would match nothing', async () => {
    const page = fakePage();
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await expectSdodsError(
      step('no request matching {string} should have been made')(fx, 'analytics'),
    );
    await expectSdodsError(step('I start counting requests to {string}')(fx, 'analytics'));
  });

  it('refuses an assertion with no recorder and no counter', async () => {
    await expectSdodsError(
      step('no request matching {string} should have been made')(
        { page: fakePage(), apiContext: new ApiContext(), env: makeEnv() },
        '**/x',
      ),
    );
    const page = fakePage();
    const fx = { page, apiContext: new ApiContext(), env: makeEnv() };
    await step('I record outgoing browser requests')(fx);
    await expectSdodsError(
      step('{int} requests should have been counted for {string}')(fx, 0, '**/never-started'),
    );
  });
});

/* ── cheap negatives and the credential scan ──────────────────────────── */

describe('response negatives', () => {
  it('asserts a header is absent, in both directions', async () => {
    const apiContext = new ApiContext();
    recordResponse(apiContext, { headers: { 'x-powered-by': 'Next.js' } });
    const fx = { apiContext, env: makeEnv() };
    await expect(
      step('the response should have no {string} header')(fx, 'X-Debug'),
    ).resolves.toBeUndefined();
    await expect(
      step('the response should have no {string} header')(fx, 'X-Powered-By'),
    ).rejects.toThrow();
    await expectSdodsError(
      step('the response should have no {string} header')(fx, 'X-{{gone}}'),
      'CONFIG_UNRESOLVED_VAR',
    );
  });

  it('asserts a JSON path is absent, in both directions', async () => {
    const apiContext = new ApiContext();
    recordResponse(apiContext, { body: { user: { id: 1, passwordHash: 'x' } } });
    const fx = { apiContext, env: makeEnv() };
    await expect(
      step('the response JSON path {string} should not exist')(fx, 'user.email'),
    ).resolves.toBeUndefined();
    await expect(
      step('the response JSON path {string} should not exist')(fx, 'user.passwordHash'),
    ).rejects.toThrow();
    await expectSdodsError(
      step('the response JSON path {string} should not exist')(fx, 'user.{{field}}'),
      'CONFIG_UNRESOLVED_VAR',
    );
  });

  it('asserts a list of forbidden strings and refuses an empty list or an empty body', async () => {
    const apiContext = new ApiContext();
    recordResponse(apiContext, { body: { plan: 'pro', tenant: 'acme' } });
    const env = makeEnv({ vars: { rival: 'globex' } });
    const fx = { apiContext, env };
    await expect(
      step('the response should not contain any of {string}')(fx, 'globex, initech'),
    ).resolves.toBeUndefined();
    await expect(
      step('the response should not contain any of {string}')(fx, 'initech, acme'),
    ).rejects.toThrow();
    await expect(
      step('the response should not contain any of {string}')(fx, '{{rival}}'),
    ).resolves.toBeUndefined();
    await expectSdodsError(step('the response should not contain any of {string}')(fx, '  ,  '));

    const empty = new ApiContext();
    recordResponse(empty, { status: 204, body: null });
    await expectSdodsError(
      step('the response should not contain any of {string}')({ apiContext: empty, env }, 'secret'),
    );
  });
});

describe('credential scan', () => {
  it('flags credential shapes and leaves redacted or ordinary text alone', () => {
    expect(
      credentialFindings('{"token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghij"}'),
    ).toContain('JSON Web Token');
    expect(credentialFindings('-----BEGIN RSA PRIVATE KEY-----')).toContain('PEM private key');
    expect(credentialFindings('AKIAIOSFODNN7EXAMPLE')).toContain('AWS access key id');
    expect(credentialFindings('key=AIzaSyA0123456789B0123456789C0123456789')).toContain(
      'Google API key',
    );
    expect(credentialFindings('{"client_secret":"s3cr3t-value-long"}')).toContain(
      'secret-named field with a value',
    );
    // the redacted forms every well-behaved API already emits must NOT flag
    expect(credentialFindings('{"password":"***"}')).toEqual([]);
    expect(credentialFindings('{"api_key":"[REDACTED]"}')).toEqual([]);
    expect(credentialFindings('{"message":"Please check your password and try again."}')).toEqual(
      [],
    );
  });

  it('fails on a leaked token and passes on a clean body', async () => {
    const leaky = new ApiContext();
    recordResponse(leaky, {
      body: { session: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghij' },
    });
    await expect(
      step('nothing in the response body should look like a credential')({ apiContext: leaky }),
    ).rejects.toThrow();

    const clean = new ApiContext();
    recordResponse(clean, { body: { id: 1, name: 'Ada' } });
    await expect(
      step('nothing in the response body should look like a credential')({ apiContext: clean }),
    ).resolves.toBeUndefined();
  });

  it('refuses to scan an empty body, which could only ever pass', async () => {
    const apiContext = new ApiContext();
    recordResponse(apiContext, { status: 204, body: null });
    await expectSdodsError(
      step('nothing in the response body should look like a credential')({ apiContext }),
    );
  });

  it('scans the raw body too', async () => {
    const apiContext = new ApiContext();
    await step('I send a {method} request to {string} without following redirects')(
      {
        request: fakeRequest({ body: '{"key":"AIzaSyA0123456789B0123456789C0123456789"}' }),
        apiContext,
        env: makeEnv(),
        config,
      },
      'GET',
      '/config',
    );
    await expect(
      step('nothing in the raw response body should look like a credential')({ apiContext }),
    ).rejects.toThrow();
  });
});
