import { expect } from '@playwright/test';
import './params.js';
import { Given, Then, When } from '../fixtures/test.js';
import type { APIRequestContext, Download, Page, TestInfo } from '@playwright/test';
import type { EnvConfig } from '@sdods/contracts';
import type { ResolvedConfig } from '../config/resolve.js';
import type { ApiContext } from '../fixtures/api-context.js';
import {
  applyAuth,
  encodeBody,
  resolveAuth,
  type ApiClient,
  type HttpMethod,
} from '../api/client.js';
import { coerce, getPath } from '../api/json-path.js';
import { render } from '../api/template.js';
import type { AriaRole } from '../heal/types.js';
import { SdodsError } from '../errors.js';

/**
 * Network steps: the HTTP behaviour the built-in `api`/`ui` libraries cannot reach.
 *
 * Four independent gaps, each generic to any web application:
 *
 *  1. REDIRECTS. `ApiClient.send()` always sends `maxRedirects: 10` and then redacts
 *     `set-cookie` / `authorization` before the snapshot reaches `apiContext`. Every 3xx is
 *     therefore invisible at the api layer: an auth gate, a locale gate and a maintenance gate
 *     all read as the 200 they eventually land on. The `raw …` family below issues the request
 *     itself, through the same Playwright `request` fixture and the same header/auth/query
 *     assembly, but keeps the 3xx and the real `Set-Cookie`.
 *  2. DOWNLOADS. Nothing could capture a download, so an export feature could only ever be
 *     proven not to throw.
 *  3. STREAMING. A streamed endpoint returns HTTP 200 on its first byte and can still die
 *     mid-flight, so a status assertion proves nothing. The observable is the stream's LAST
 *     event and a clean frame boundary at the end of the body.
 *  4. REQUEST COUNTING. The library could mock and abort a route but never assert that a route
 *     was NOT called — the assertion behind "the client does not poll", "no third party was
 *     contacted" and "client-side validation refused before sending".
 *
 * Vacuity is the standing hazard in all four. Every negative assertion here refuses an argument
 * that still contains an unrendered `{{var}}`, because `render()` leaves a miss as the literal
 * `{{name}}`, and a URL glob carrying an unresolved id then matches nothing at all —
 * "no requests were made" would then pass green for ever.
 */

/* ── shared ───────────────────────────────────────────────────────────── */

type Scopes = Array<Record<string, unknown> | undefined>;

const scopesOf = (apiContext: ApiContext, env: EnvConfig): Scopes => [
  apiContext.vars.toObject(),
  env.vars,
];

/**
 * Render, then refuse a surviving `{{var}}`. Used for every argument whose non-resolution would
 * produce a PASS rather than a failure: negative assertions, URL globs and request paths.
 */
function renderStrict(value: string, what: string, ...scopes: Scopes): string {
  const out = render(value, ...scopes);
  if (out.includes('{{')) {
    throw new SdodsError('CONFIG_UNRESOLVED_VAR', `${what} did not resolve: "${out}".`, {
      hint: 'No scenario variable or env var of that name exists yet. Save it first (for example with "I save the response JSON path ... as ..."), or fix the spelling — an unresolved placeholder here would make the assertion pass without testing anything.',
    });
  }
  return out;
}

/** Comma-separated Gherkin list → trimmed, rendered, non-empty items. */
function renderList(raw: string, what: string, ...scopes: Scopes): string[] {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => renderStrict(s, what, ...scopes));
  if (items.length === 0)
    throw new SdodsError('RUN_FAILED', `${what} is empty.`, {
      hint: 'List at least one comma-separated value; an empty list would make this assertion pass over nothing.',
    });
  return items;
}

/** A response body as searchable text. `null`/absent stays EMPTY, so an empty-body guard bites. */
function bodyText(body: unknown): string {
  if (body === null || body === undefined) return '';
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/** Best-effort evidence for an @api scenario, which takes no screenshots. Never fails a step. */
async function attachEvidence(
  testInfo: Pick<TestInfo, 'attach'> | undefined,
  name: string,
  payload: unknown,
): Promise<void> {
  try {
    await testInfo?.attach(name, {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
  } catch {
    /* evidence is best-effort; losing it must not turn a green step red */
  }
}

/* ── raw (redirect-preserving, unredacted) requests ───────────────────── */

export interface RawSnapshot {
  method: string;
  url: string;
  requestBody?: string;
  status: number;
  statusText: string;
  /** Lower-cased, comma-joined by Playwright for repeats — use `setCookies` for Set-Cookie. */
  headers: Record<string, string>;
  /** Every individual Set-Cookie line, which `headers()` would have collapsed into one string. */
  setCookies: string[];
  body: string;
}

const RAW = new WeakMap<object, RawSnapshot>();
const RAW_BODIES = new WeakMap<object, Map<string, string>>();

function rawOf(apiContext: ApiContext): RawSnapshot {
  const snap = RAW.get(apiContext);
  if (!snap)
    throw new SdodsError('RUN_FAILED', 'No raw request has been sent in this scenario yet.', {
      hint: 'Send one first with `When I send a GET request to "/path" without following redirects`. The built-in `I send a ... request` steps follow redirects and redact Set-Cookie, so their response is not visible to the raw assertions.',
    });
  return snap;
}

function savedBodies(apiContext: ApiContext): Map<string, string> {
  let bag = RAW_BODIES.get(apiContext);
  if (!bag) {
    bag = new Map();
    RAW_BODIES.set(apiContext, bag);
  }
  return bag;
}

/**
 * Mirrors `ApiClient.buildHeaders` — env headers, then the scenario's pending headers, then auth,
 * resolved by the same function the client uses (so `I use no authentication` and every
 * `env.api.auth` type behave identically here). A raw request that dropped auth would report the
 * anonymous redirect instead of the authenticated one, which is the same class of defect as a step
 * that does not interpolate.
 * `accept: application/json` is the default; override it with
 * `Given I set the request header "accept" to "text/html"` when the gate under test negotiates
 * on content type.
 */
async function rawHeaders(
  apiContext: ApiContext,
  env: EnvConfig,
  hasBody: boolean,
  isForm: boolean,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  for (const [k, v] of Object.entries(env.api.headers ?? {})) headers[k.toLowerCase()] = v;
  for (const [k, v] of apiContext.headers) headers[k.toLowerCase()] = v;
  if (hasBody && !isForm && !headers['content-type']) headers['content-type'] = 'application/json';
  applyAuth(headers, await resolveAuth(undefined, apiContext.auth, env.api.auth));
  return headers;
}

interface RawDeps {
  request: APIRequestContext;
  /** The scenario's ApiClient; supplies the isolated request context when one is in use. */
  api?: Pick<ApiClient, 'requestContext'>;
  apiContext: ApiContext;
  env: EnvConfig;
  config: ResolvedConfig;
  testInfo?: Pick<TestInfo, 'attach'>;
}

/** The shared `request` fixture, or the isolated context after `I use an isolated API client`. */
async function rawRequest(deps: RawDeps): Promise<APIRequestContext> {
  if (!deps.apiContext.isolated) return deps.request;
  if (!deps.api) {
    throw new SdodsError('NOT_SUPPORTED', 'No isolated request context is available here.', {
      hint: 'Raw requests reach the isolated client through the `api` fixture; pass it in the step fixtures.',
    });
  }
  return deps.api.requestContext();
}

/** Mirrors `ApiClient.resolveUrl`, so `Given I set the query parameter …` applies here too. */
function rawUrl(apiContext: ApiContext, env: EnvConfig, pathOrUrl: string): string {
  const base = env.api.baseUrl.replace(/\/+$/, '');
  const url = /^https?:\/\//.test(pathOrUrl)
    ? new URL(pathOrUrl)
    : new URL(`${base}/${pathOrUrl.replace(/^\/+/, '')}`);
  for (const [k, v] of apiContext.query) url.searchParams.set(k, v);
  return url.toString();
}

export interface SendRawOptions {
  body?: string;
  form?: Record<string, string>;
}

/**
 * One request with `maxRedirects: 0`. The whole point is to keep the 3xx instead of chasing it,
 * and to keep `Set-Cookie` unredacted — the two things the recorded ApiSnapshot cannot carry.
 */
export async function sendRaw(
  deps: RawDeps,
  method: string,
  pathOrUrl: string,
  opts: SendRawOptions = {},
): Promise<RawSnapshot> {
  const url = rawUrl(deps.apiContext, deps.env, pathOrUrl);
  const headers = await rawHeaders(
    deps.apiContext,
    deps.env,
    opts.body !== undefined || opts.form !== undefined,
    opts.form !== undefined,
  );
  const request = await rawRequest(deps);
  const res = await request.fetch(url, {
    method,
    headers,
    // A Buffer, so Playwright does not JSON-encode a body that does not parse.
    data: opts.form ? undefined : encodeBody(opts.body),
    form: opts.form,
    maxRedirects: 0,
    failOnStatusCode: false,
    timeout: deps.config.project.timeouts.api,
  });
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers())) raw[k.toLowerCase()] = v;
  const snap: RawSnapshot = {
    method,
    url,
    requestBody: opts.body,
    status: res.status(),
    statusText: res.statusText(),
    headers: raw,
    setCookies: res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value),
    body: await res.text(),
  };
  RAW.set(deps.apiContext, snap);
  // Keeping Set-Cookie readable by the ASSERTIONS is the point of this family; keeping it
  // readable in the attached artefact is not. The report copy is redacted to exactly what
  // ApiClient redacts, and the cookie NAMES carry everything a reader of the report needs.
  await attachEvidence(deps.testInfo, `sdods/raw-${method.toLowerCase()}-${snap.status}`, {
    request: { method, url, headers: redactForReport(headers), body: opts.body, form: opts.form },
    response: {
      status: snap.status,
      statusText: snap.statusText,
      headers: redactForReport(snap.headers),
      setCookieNames: snap.setCookies.map((c) => c.split('=')[0]),
      body: snap.body.slice(0, 4000),
    },
  });
  return snap;
}

/** The header set ApiClient redacts, applied to the reported copy only. */
const SECRET_HEADERS = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

export function redactForReport(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, SECRET_HEADERS.test(k) ? '***' : v]),
  );
}

When(
  'I send a {method} request to {string} without following redirects',
  async (
    { request, api, apiContext, env, config, $testInfo },
    method: HttpMethod,
    path: string,
  ) => {
    // PROVES the edge itself answered. The built-in step would follow the 3xx and report the
    // page it landed on, so an auth/locale/maintenance gate is unobservable through it.
    await sendRaw(
      { request, api, apiContext, env, config, testInfo: $testInfo },
      method,
      renderStrict(path, 'the request path', ...scopesOf(apiContext, env)),
    );
  },
);

When(
  'I send a {method} request to {string} without following redirects with body:',
  async (
    { request, api, apiContext, env, config, $testInfo },
    method: HttpMethod,
    path: string,
    body: string,
  ) => {
    // Body stays TEXT, never re-serialised JSON: the byte-identical comparison below is only an
    // oracle for enumeration safety if nothing normalises whitespace or key order on the way in.
    const scopes = scopesOf(apiContext, env);
    await sendRaw(
      { request, api, apiContext, env, config, testInfo: $testInfo },
      method,
      renderStrict(path, 'the request path', ...scopes),
      { body: render(body, ...scopes) },
    );
  },
);

When(
  'I send a {method} request to {string} without following redirects with form:',
  async (
    { request, api, apiContext, env, config, $testInfo },
    method: HttpMethod,
    path: string,
    table: { raw(): string[][] },
  ) => {
    // PROVES a form POST's gate. Most real redirect gates — sign-in, consent, locale switch —
    // are urlencoded form posts, so a JSON-only raw request cannot reach the common case.
    const scopes = scopesOf(apiContext, env);
    const form: Record<string, string> = {};
    for (const row of table.raw())
      form[String(row[0] ?? '')] = render(String(row[1] ?? ''), ...scopes);
    await sendRaw(
      { request, api, apiContext, env, config, testInfo: $testInfo },
      method,
      renderStrict(path, 'the request path', ...scopes),
      { form },
    );
  },
);

Then('the raw response status should be {int}', async ({ apiContext }, status: number) => {
  // PROVES the gate fired at this hop. A 307 that a following client turns into a 200 is the
  // single most common invisible-pass in an API suite.
  const snap = rawOf(apiContext);
  expect(snap.status, `${snap.method} ${snap.url}`).toBe(status);
});

Then('the raw response status should be one of {string}', async ({ apiContext }, list: string) => {
  const allowed = list
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (allowed.length === 0 || allowed.some(Number.isNaN))
    throw new SdodsError('RUN_FAILED', `"${list}" is not a list of status codes.`, {
      hint: 'Write them comma- or space-separated, for example "301, 302, 307".',
    });
  const snap = rawOf(apiContext);
  expect(allowed, `${snap.method} ${snap.url} returned ${snap.status}`).toContain(snap.status);
});

Then(
  'the raw response Location should be {string}',
  async ({ apiContext, env }, expected: string) => {
    // Exact, not substring: the surviving return-to/callback parameter IS the assertion, and a
    // `contains` check would pass on a truncated one that silently drops where the user came from.
    const snap = rawOf(apiContext);
    expect(snap.headers.location ?? '(no Location header)', `Location of ${snap.url}`).toBe(
      render(expected, ...scopesOf(apiContext, env)),
    );
  },
);

Then(
  'the raw response Location should contain {string}',
  async ({ apiContext, env }, expected: string) => {
    const snap = rawOf(apiContext);
    expect(snap.headers.location ?? '(no Location header)', `Location of ${snap.url}`).toContain(
      render(expected, ...scopesOf(apiContext, env)),
    );
  },
);

Then(
  'the raw response header {string} should contain {string}',
  async ({ apiContext, env }, name: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    const wanted = render(name, ...scopes);
    const snap = rawOf(apiContext);
    expect(
      snap.headers[wanted.toLowerCase()] ?? `(no ${wanted} header)`,
      `${wanted} of ${snap.url}`,
    ).toContain(render(value, ...scopes));
  },
);

Then(
  'the raw response should have no {string} header',
  async ({ apiContext, env }, name: string) => {
    // The deny direction, and NOT the same as "does not contain": an `Allow` header present but
    // empty, or a `Set-Cookie` present but rejected, are both absences a contains-check would miss.
    const wanted = renderStrict(name, 'the header name', ...scopesOf(apiContext, env));
    const snap = rawOf(apiContext);
    expect(
      snap.headers[wanted.toLowerCase()],
      `unexpected ${wanted} header on ${snap.url}`,
    ).toBeUndefined();
  },
);

Then('the raw response body should contain {string}', async ({ apiContext, env }, text: string) => {
  expect(rawOf(apiContext).body).toContain(render(text, ...scopesOf(apiContext, env)));
});

Then(
  'the raw response should set the {string} cookie',
  async ({ apiContext, env }, name: string) => {
    // PROVES the credential was actually issued. Unreachable through the built-in header step,
    // which sees `set-cookie: ***` because the ApiSnapshot redacts it.
    const wanted = renderStrict(name, 'the cookie name', ...scopesOf(apiContext, env));
    const snap = rawOf(apiContext);
    expect(
      snap.setCookies.some((c) => c.startsWith(`${wanted}=`)),
      `Set-Cookie for "${wanted}" (got ${JSON.stringify(snap.setCookies.map((c) => c.split('=')[0]))})`,
    ).toBe(true);
  },
);

Then(
  'the raw response should not set the {string} cookie',
  async ({ apiContext, env }, name: string) => {
    // PROVES a refusal left no credential behind. A `Max-Age=0` line is a deletion, not a grant,
    // so it must not count as one — otherwise a correct sign-out would read as a session leak.
    const wanted = renderStrict(name, 'the cookie name', ...scopesOf(apiContext, env));
    const snap = rawOf(apiContext);
    expect(
      snap.setCookies.filter((c) => c.startsWith(`${wanted}=`) && !isCleared(c)),
      `no Set-Cookie granting "${wanted}"`,
    ).toEqual([]);
  },
);

Then(
  'the raw response cookie {string} should carry {string}',
  async ({ apiContext, env }, name: string, attribute: string) => {
    // HttpOnly / Secure / SameSite=Lax / Path=/ — the session contract every downstream gate
    // reads. Matched case-insensitively because servers disagree on the casing of attributes.
    const scopes = scopesOf(apiContext, env);
    const wanted = renderStrict(name, 'the cookie name', ...scopes);
    const attr = render(attribute, ...scopes);
    const cookie = rawOf(apiContext).setCookies.find((c) => c.startsWith(`${wanted}=`));
    expect(cookie, `Set-Cookie for "${wanted}"`).toBeTruthy();
    expect(String(cookie).toLowerCase(), `attributes of the "${wanted}" cookie`).toContain(
      attr.toLowerCase(),
    );
  },
);

Then(
  'the raw response cookie {string} should be cleared',
  async ({ apiContext, env }, name: string) => {
    // PROVES sign-out server-side: a deletion is a Set-Cookie with an immediate expiry, which is
    // what "the browser no longer holds the credential" actually means over the wire.
    const wanted = renderStrict(name, 'the cookie name', ...scopesOf(apiContext, env));
    const cookie = rawOf(apiContext).setCookies.find((c) => c.startsWith(`${wanted}=`));
    expect(cookie, `Set-Cookie clearing "${wanted}"`).toBeTruthy();
    expect(isCleared(String(cookie)), `expiry of the "${wanted}" cookie`).toBe(true);
  },
);

function isCleared(cookie: string): boolean {
  return /Max-Age=0|Expires=Thu,\s*01[ -]Jan[ -]1970/i.test(cookie);
}

When('I save the raw response body as {string}', async ({ apiContext }, name: string) => {
  savedBodies(apiContext).set(name, rawOf(apiContext).body);
});

Then(
  'the raw response body should be identical to {string}',
  async ({ apiContext }, name: string) => {
    // Byte-identical, not "both say no such account". An enumeration-safe endpoint that varies
    // its wording, whitespace or field order between the two cases is still an oracle.
    const saved = savedBodies(apiContext).get(name);
    if (saved === undefined)
      throw new SdodsError('RUN_FAILED', `No raw body was saved under "${name}".`, {
        hint: 'Send the first request and store it with `When I save the raw response body as "<name>"` before comparing the second one against it.',
      });
    expect(rawOf(apiContext).body, `raw body vs. the one saved as "${name}"`).toBe(saved);
  },
);

/* ── downloads ────────────────────────────────────────────────────────── */

const DOWNLOADS = new WeakMap<Page, Download>();
const DOWNLOAD_TEXT = new WeakMap<Page, string>();

function downloadOf(page: Page): Download {
  const download = DOWNLOADS.get(page);
  if (!download)
    throw new SdodsError('RUN_FAILED', 'No download has been captured in this scenario yet.', {
      hint: 'Capture one first with `When I click the "Export" button and capture the download`. A download must be captured at the moment the click happens — it cannot be read afterwards.',
    });
  return download;
}

async function downloadedText(page: Page): Promise<string> {
  const cached = DOWNLOAD_TEXT.get(page);
  if (cached !== undefined) return cached;
  const download = downloadOf(page);
  const file = await download.path();
  if (!file) {
    const failure = await download.failure();
    throw new SdodsError(
      'RUN_FAILED',
      `The download never completed${failure ? `: ${failure}` : ''}.`,
      {
        hint: 'Playwright discards a download unless the browser context was created with `acceptDownloads: true` (the default), and reports null here when the transfer failed. Check the reason above before blaming the step.',
      },
    );
  }
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(file, 'utf8');
  if (text.length === 0)
    throw new SdodsError(
      'RUN_FAILED',
      `The downloaded file "${download.suggestedFilename()}" is empty.`,
      {
        hint: 'An empty export is a product failure, and every assertion below would pass vacuously over it, so this refuses rather than reporting green.',
      },
    );
  DOWNLOAD_TEXT.set(page, text);
  return text;
}

async function captureDownload(
  page: Page,
  timeout: number,
  click: () => Promise<void>,
): Promise<void> {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout }), click()]);
  DOWNLOADS.set(page, download);
  DOWNLOAD_TEXT.delete(page);
}

When(
  'I click the {string} {role} and capture the download',
  async ({ page, heal, config, apiContext, env }, name: string, role: string) => {
    // PROVES an export produced a file at all. Without this the whole export feature can only be
    // asserted as "the click did not throw", which is true of a button wired to nothing.
    const n = render(name, ...scopesOf(apiContext, env));
    const loc = await heal.resolve(
      page.getByRole(role as AriaRole, { name: n }),
      { role: role as AriaRole, name: n, text: n, description: `${role} "${n}"` },
      'click',
    );
    await captureDownload(page, config.project.timeouts.navigation, () => loc.click());
  },
);

When(
  'I click the element with test id {string} and capture the download',
  async ({ page, heal, config }, id: string) => {
    const loc = await heal.resolve(
      page.getByTestId(id),
      { testId: id, description: `test id "${id}"` },
      'click',
    );
    await captureDownload(page, config.project.timeouts.navigation, () => loc.click());
  },
);

Then(
  'the downloaded file name should end with {string}',
  async ({ page, apiContext, env }, suffix: string) => {
    // `endsWith`, not `contains`: a ".json" that appears mid-name (report.json.txt) is the exact
    // mis-typed export this assertion exists to catch.
    const wanted = render(suffix, ...scopesOf(apiContext, env));
    const actual = downloadOf(page).suggestedFilename();
    expect(
      actual.endsWith(wanted),
      `download filename "${actual}" should end with "${wanted}"`,
    ).toBe(true);
  },
);

Then(
  'the downloaded file name should contain {string}',
  async ({ page, apiContext, env }, part: string) => {
    expect(downloadOf(page).suggestedFilename(), 'download filename').toContain(
      render(part, ...scopesOf(apiContext, env)),
    );
  },
);

Then(
  'the downloaded text first line should be {string}',
  async ({ page, apiContext, env }, expected: string) => {
    // PROVES the header row of a CSV export matches the columns the UI promised. Exact, because a
    // reordered or renamed column silently breaks every consumer of the file.
    const text = await downloadedText(page);
    expect(text.split(/\r?\n/)[0] ?? '', 'first line of the downloaded file').toBe(
      render(expected, ...scopesOf(apiContext, env)),
    );
  },
);

Then(
  'the downloaded text should contain {string}',
  async ({ page, apiContext, env }, text: string) => {
    expect(await downloadedText(page), 'downloaded file').toContain(
      render(text, ...scopesOf(apiContext, env)),
    );
  },
);

Then('the downloaded text should have at least {int} data rows', async ({ page }, min: number) => {
  expect(
    dataRows(await downloadedText(page)),
    'data rows in the downloaded file',
  ).toBeGreaterThanOrEqual(min);
});

Then('the downloaded text should have at most {int} data rows', async ({ page }, max: number) => {
  // PROVES an export cap. Safe from vacuity because `downloadedText` refuses an empty file, so
  // "at most N" can never be satisfied by nothing having been exported.
  expect(
    dataRows(await downloadedText(page)),
    'data rows in the downloaded file',
  ).toBeLessThanOrEqual(max);
});

/** Non-blank lines after the header row. */
function dataRows(text: string): number {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  return Math.max(0, lines.length - 1);
}

async function downloadedJson(page: Page): Promise<unknown> {
  const text = await downloadedText(page);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SdodsError('RUN_FAILED', `The downloaded file is not JSON: ${(e as Error).message}`, {
      hint: `First 200 characters: ${text.slice(0, 200)}`,
    });
  }
}

Then(
  'the downloaded JSON path {string} should equal {string}',
  async ({ page, apiContext, env }, path: string, expected: string) => {
    // PROVES the export/import round trip, not just that a file arrived: a scenario that can
    // export but never read what it exported proves only that a click did not throw.
    const actual = getPath(await downloadedJson(page), path);
    expect(actual, `downloaded JSON path ${path}`).toEqual(
      coerce(render(expected, ...scopesOf(apiContext, env))),
    );
  },
);

Then(
  'the downloaded JSON path {string} should have {int} items',
  async ({ page }, path: string, count: number) => {
    // Arrays and keyed records both count, because exports model collections either way; anything
    // else fails loudly rather than counting as zero.
    const value = getPath(await downloadedJson(page), path);
    if (Array.isArray(value)) {
      expect(value, `downloaded JSON path ${path} length`).toHaveLength(count);
      return;
    }
    if (value !== null && typeof value === 'object') {
      expect(Object.keys(value), `downloaded JSON path ${path} key count`).toHaveLength(count);
      return;
    }
    throw new SdodsError('RUN_FAILED', `Downloaded JSON path ${path} is not a collection.`, {
      hint: `It is ${value === undefined ? 'absent' : typeof value}. Point the path at an array or an object whose keys are the items.`,
    });
  },
);

/* ── server-sent events ───────────────────────────────────────────────── */

export interface StreamEvent {
  /** The SSE `event:` field, else the parsed JSON payload's `type`, else the raw sentinel. */
  type: string | undefined;
  data: string;
  json?: unknown;
}

export interface StreamCapture {
  status: number;
  contentType: string;
  events: StreamEvent[];
  /** The body ended on a frame boundary — a stream cut mid-frame does not. */
  endedWithDelimiter: boolean;
  /** Transport failure (reset, timeout). Present means the stream did not finish. */
  error?: string;
}

const STREAMS = new WeakMap<object, StreamCapture>();
const STREAM_TIMEOUT = new WeakMap<object, number>();

/**
 * Parse an SSE body into frames. Frames are separated by a blank line; `data:` lines within one
 * frame join with a newline; a frame carrying only a comment (`: keepalive`) is not an event.
 */
export function parseEventStream(
  text: string,
): Pick<StreamCapture, 'events' | 'endedWithDelimiter'> {
  const events: StreamEvent[] = [];
  for (const frame of text.split(/\r?\n\r?\n/)) {
    if (frame.trim() === '') continue;
    let name: string | undefined;
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (name === undefined && data.length === 0) continue;
    const payload = data.join('\n');
    let json: unknown;
    try {
      json = payload.length ? JSON.parse(payload) : undefined;
    } catch {
      /* a non-JSON frame is still an event; its type is then the `event:` field alone */
    }
    const fromJson =
      json !== null && typeof json === 'object' && 'type' in (json as Record<string, unknown>)
        ? String((json as Record<string, unknown>).type)
        : undefined;
    const sentinel = /^\[[A-Z_]+\]$/.test(payload) ? payload : undefined;
    events.push({ type: name ?? fromJson ?? sentinel, data: payload, json });
  }
  return { events, endedWithDelimiter: /\r?\n\r?\n\s*$/.test(text) };
}

function streamOf(apiContext: ApiContext): StreamCapture {
  const capture = STREAMS.get(apiContext);
  if (!capture)
    throw new SdodsError('RUN_FAILED', 'No event stream has been read in this scenario yet.', {
      hint: 'Read one first with `When I read the event stream from a POST request to "/chat" with body:`. The built-in `I send a ... request` steps buffer and JSON-parse the body, which a text/event-stream response is not.',
    });
  return capture;
}

async function readStream(
  deps: RawDeps,
  method: string,
  pathOrUrl: string,
  body?: string,
): Promise<StreamCapture> {
  const headers = await rawHeaders(deps.apiContext, deps.env, body !== undefined, false);
  headers.accept = 'text/event-stream';
  const url = rawUrl(deps.apiContext, deps.env, pathOrUrl);
  const timeout = STREAM_TIMEOUT.get(deps.apiContext) ?? deps.config.project.timeouts.api;
  const request = await rawRequest(deps);
  let capture: StreamCapture;
  try {
    const res = await request.fetch(url, {
      method,
      headers,
      data: encodeBody(body),
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout,
    });
    const text = await res.text();
    capture = {
      status: res.status(),
      contentType: res.headers()['content-type'] ?? '',
      ...parseEventStream(text),
    };
  } catch (e) {
    // A stream that dies mid-flight surfaces here, not as a status — record the reason so the
    // clean-termination step fails with it rather than with "no stream captured".
    capture = {
      status: 0,
      contentType: '',
      events: [],
      endedWithDelimiter: false,
      error: (e as Error).message,
    };
  }
  STREAMS.set(deps.apiContext, capture);
  await attachEvidence(deps.testInfo, `sdods/stream-${method.toLowerCase()}-${capture.status}`, {
    url,
    status: capture.status,
    contentType: capture.contentType,
    eventCount: capture.events.length,
    eventTypes: capture.events.map((e) => e.type),
    endedWithDelimiter: capture.endedWithDelimiter,
    error: capture.error,
  });
  return capture;
}

Given('I allow {int} seconds for the event stream', async ({ apiContext }, seconds: number) => {
  // A long turn outlives `timeouts.api`, and that timeout would surface as a red step that looks
  // exactly like a product bug — the worst kind of false failure.
  STREAM_TIMEOUT.set(apiContext, seconds * 1000);
});

When(
  'I read the event stream from a {method} request to {string}',
  async (
    { request, api, apiContext, env, config, $testInfo },
    method: HttpMethod,
    path: string,
  ) => {
    await readStream(
      { request, api, apiContext, env, config, testInfo: $testInfo },
      method,
      renderStrict(path, 'the request path', ...scopesOf(apiContext, env)),
    );
  },
);

When(
  'I read the event stream from a {method} request to {string} with body:',
  async (
    { request, api, apiContext, env, config, $testInfo },
    method: HttpMethod,
    path: string,
    body: string,
  ) => {
    const scopes = scopesOf(apiContext, env);
    await readStream(
      { request, api, apiContext, env, config, testInfo: $testInfo },
      method,
      renderStrict(path, 'the request path', ...scopes),
      render(body, ...scopes),
    );
  },
);

Then('the stream status should be {int}', async ({ apiContext }, status: number) => {
  const capture = streamOf(apiContext);
  expect(capture.status, capture.error ? `stream failed: ${capture.error}` : 'stream status').toBe(
    status,
  );
});

Then(
  'the stream content type should be {string}',
  async ({ apiContext, env }, expected: string) => {
    // PROVES the endpoint actually streamed. An endpoint that quietly fell back to a buffered
    // JSON response still returns 200, and every event assertion below would then fail
    // confusingly.
    expect(streamOf(apiContext).contentType, 'stream content type').toContain(
      render(expected, ...scopesOf(apiContext, env)),
    );
  },
);

Then('the stream should have at least {int} events', async ({ apiContext }, min: number) => {
  if (min < 1)
    throw new SdodsError('RUN_FAILED', 'Assert at least one event, not zero.', {
      hint: '"at least 0 events" is satisfied by a stream that carried nothing; use `the stream should have terminated cleanly` if you mean the stream finished.',
    });
  expect(
    streamOf(apiContext).events.length,
    'events parsed from the stream',
  ).toBeGreaterThanOrEqual(min);
});

Then(
  'the first stream event type should be {string}',
  async ({ apiContext, env }, expected: string) => {
    const { events } = streamOf(apiContext);
    expect(events.length, 'the stream carried no events at all').toBeGreaterThan(0);
    expect(events[0]?.type, 'first stream event type').toBe(
      render(expected, ...scopesOf(apiContext, env)),
    );
  },
);

Then(
  'the last stream event type should be {string}',
  async ({ apiContext, env }, expected: string) => {
    // PROVES the turn finished. A streaming endpoint returns 200 on its first byte, so the status
    // says nothing about whether the model/producer ever reached its terminal event.
    const { events } = streamOf(apiContext);
    expect(events.length, 'the stream carried no events at all').toBeGreaterThan(0);
    expect(
      events[events.length - 1]?.type,
      'last stream event type — a 200 that never reaches this is a stream that died mid-flight',
    ).toBe(render(expected, ...scopesOf(apiContext, env)));
  },
);

Then('the stream should have terminated cleanly', async ({ apiContext }) => {
  // Three clauses, and all three are load-bearing: no transport error, at least one frame parsed
  // (else a body of just "\n\n" would qualify), and a final frame boundary (a stream cut in the
  // middle of a frame leaves no terminating blank line).
  const capture = streamOf(apiContext);
  expect(capture.error, 'the stream failed at the transport level').toBeUndefined();
  expect(capture.events.length, 'the stream carried no events at all').toBeGreaterThan(0);
  expect(
    capture.endedWithDelimiter,
    'the body does not end on a frame boundary, so the stream was cut mid-event',
  ).toBe(true);
});

/* ── browser request accounting ───────────────────────────────────────── */

interface RequestLog {
  entries: Array<{ method: string; url: string }>;
  counters: Map<string, number>;
}

const REQUESTS = new WeakMap<Page, RequestLog>();

/**
 * Playwright `page.route` glob semantics, restricted to the three operators that matter:
 * `**` matches anything including `/`, `*` matches anything except `/`, `?` matches one
 * non-`/` character. Anchored, like Playwright's own matcher. Kept deliberately compatible so a
 * counting step and a `I mock {string} …` step can be given the same string.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * Refuses a pattern that cannot match a URL. A bare fragment such as "analytics" matches nothing
 * under glob rules, so "no requests were made" would pass for ever — the exact vacuous green this
 * whole section exists to prevent.
 */
function urlGlob(raw: string, scopes: Scopes): RegExp {
  const pattern = renderStrict(raw, 'the URL pattern', ...scopes);
  if (!/[*?]/.test(pattern) && !/^(https?:\/\/|\/)/.test(pattern))
    throw new SdodsError('RUN_FAILED', `"${pattern}" cannot match a request URL.`, {
      hint: 'These steps use Playwright route globs, matched against the whole URL. Write "**analytics**" for a fragment, "**/api/users" for a path, or a full URL.',
    });
  return globToRegExp(pattern);
}

function logOf(page: Page, why: string): RequestLog {
  const log = REQUESTS.get(page);
  if (!log)
    throw new SdodsError('RUN_FAILED', `${why} before any request recording was started.`, {
      hint: 'Add `Given I record outgoing browser requests` (or `When I start counting requests to "<glob>"`) BEFORE the action under test — a listener installed afterwards cannot see requests that already went out.',
    });
  return log;
}

/**
 * Listens on `page.on('request')`, not `page.route`. Route handlers run in reverse registration
 * order, so a mock registered after a counting route would fulfil the request and the counter
 * would never fire — the count would read 0 and "the client does not poll" would pass vacuously.
 * The request event fires whether the request is routed, fulfilled, aborted or served from the
 * network, which is what "did the client issue it" actually means.
 */
function ensureLog(page: Page): RequestLog {
  const existing = REQUESTS.get(page);
  if (existing) return existing;
  const log: RequestLog = { entries: [], counters: new Map() };
  REQUESTS.set(page, log);
  page.on('request', (req) => log.entries.push({ method: req.method(), url: req.url() }));
  return log;
}

Given('I record outgoing browser requests', async ({ page }) => {
  ensureLog(page);
});

When('I start counting requests to {string}', async ({ page, apiContext, env }, glob: string) => {
  // The counter is an OFFSET into the log, so "start counting" means "ignore what came before".
  // Start it before navigating if the initial page load's requests are part of the count.
  urlGlob(glob, scopesOf(apiContext, env));
  const log = ensureLog(page);
  log.counters.set(render(glob, ...scopesOf(apiContext, env)), log.entries.length);
});

function counted(page: Page, glob: string, scopes: Scopes, why: string): number {
  const rendered = renderStrict(glob, 'the URL pattern', ...scopes);
  const log = logOf(page, why);
  const from = log.counters.get(rendered);
  if (from === undefined)
    throw new SdodsError('RUN_FAILED', `No counter was started for "${rendered}".`, {
      hint: 'Add `When I start counting requests to "<the same glob>"` before the action. The glob strings must match exactly — the counter is keyed on the string you wrote.',
    });
  const re = urlGlob(glob, scopes);
  return log.entries.slice(from).filter((e) => re.test(e.url)).length;
}

Then(
  '{int} requests should have been counted for {string}',
  async ({ page, apiContext, env }, expected: number, glob: string) => {
    // PROVES an exact call budget — one fetch per keystroke-debounce window, one per mount.
    expect(
      counted(page, glob, scopesOf(apiContext, env), 'a request count was asserted'),
      `requests matching ${glob}`,
    ).toBe(expected);
  },
);

Then(
  'at most {int} requests should have been counted for {string}',
  async ({ page, apiContext, env }, max: number, glob: string) => {
    // PROVES the client does not poll. Bounded rather than exact, because a legitimate retry
    // should not turn this red — but zero would, and that is the point of the counter start.
    expect(
      counted(page, glob, scopesOf(apiContext, env), 'a request count was asserted'),
      `requests matching ${glob}`,
    ).toBeLessThanOrEqual(max);
  },
);

Then(
  'at least {int} requests should have been counted for {string}',
  async ({ page, apiContext, env }, min: number, glob: string) => {
    expect(
      counted(page, glob, scopesOf(apiContext, env), 'a request count was asserted'),
      `requests matching ${glob}`,
    ).toBeGreaterThanOrEqual(min);
  },
);

Then(
  'no requests should have been counted for {string}',
  async ({ page, apiContext, env }, glob: string) => {
    // PROVES a client-side guard refused before sending. Mocking the route instead would make the
    // scenario pass whether or not the call went out, which is the assertion inverted.
    expect(
      counted(page, glob, scopesOf(apiContext, env), 'a request count was asserted'),
      `requests matching ${glob}`,
    ).toBe(0);
  },
);

Then(
  'no request matching {string} should have been made',
  async ({ page, apiContext, env }, glob: string) => {
    // PROVES nothing leaked to a third party. Spans the whole recording, not a counter window, so
    // it also covers requests issued during the initial page load.
    const scopes = scopesOf(apiContext, env);
    const re = urlGlob(glob, scopes);
    const log = logOf(page, 'an outgoing-request assertion ran');
    const hits = log.entries.filter((e) => re.test(e.url)).map((e) => `${e.method} ${e.url}`);
    expect(hits, `unexpected request(s) matching ${glob}`).toEqual([]);
  },
);

Then(
  'a request matching {string} should have been made',
  async ({ page, apiContext, env }, glob: string) => {
    const scopes = scopesOf(apiContext, env);
    const re = urlGlob(glob, scopes);
    const log = logOf(page, 'an outgoing-request assertion ran');
    expect(
      log.entries.filter((e) => re.test(e.url)).length,
      `no request matched ${glob}; recorded: ${
        log.entries
          .slice(-5)
          .map((e) => e.url)
          .join(', ') || '(none)'
      }`,
    ).toBeGreaterThan(0);
  },
);

/* ── cheap negatives ──────────────────────────────────────────────────── */

Then('the response should have no {string} header', async ({ apiContext, env }, name: string) => {
  // Absence, which is NOT "does not contain": a header present with an empty or unexpected value
  // satisfies a contains-check written as a negative, and this is the assertion behind
  // "no cache header was set" and "the debug header never reaches production".
  const wanted = renderStrict(name, 'the header name', ...scopesOf(apiContext, env));
  expect(
    apiContext.last().response.headers[wanted.toLowerCase()],
    `unexpected ${wanted} header`,
  ).toBeUndefined();
});

Then(
  'the response JSON path {string} should not exist',
  async ({ apiContext, env }, path: string) => {
    // PROVES a field was withheld — the password hash, the internal id, the other tenant's row.
    // Strict rendering matters most here: an unresolved path would be absent by construction.
    const wanted = renderStrict(path, 'the JSON path', ...scopesOf(apiContext, env));
    expect(getPath(apiContext.last().response.body, wanted), `JSON path ${wanted}`).toBeUndefined();
  },
);

Then(
  'the response should not contain any of {string}',
  async ({ apiContext, env }, list: string) => {
    // Comma-separated; an empty list is refused, because "contains none of nothing" is the
    // vacuous pass this step would otherwise be used to hide behind.
    const wanted = renderList(list, 'the forbidden-strings list', ...scopesOf(apiContext, env));
    const haystack = bodyText(apiContext.last().response.body);
    if (haystack.trim().length === 0)
      throw new SdodsError('RUN_FAILED', 'The response body is empty.', {
        hint: 'Searching an empty body for forbidden strings can only ever pass; assert the status, or point this at the response that actually carries content.',
      });
    const found = wanted.filter((w) => haystack.includes(w));
    expect(found, 'forbidden strings present in the response body').toEqual([]);
  },
);

/**
 * Shapes that are credentials wherever they appear. Deliberately narrow: each pattern is long
 * and structured enough that a match is evidence, not a guess.
 */
const CREDENTIAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'JSON Web Token', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: 'PEM private key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[0-9A-Za-z]{30,}/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}/ },
  {
    name: 'secret-named field with a value',
    re: /"(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|session[_-]?token)"\s*:\s*"(?!\*+"|\[REDACTED\]")[^"]{8,}"/i,
  },
];

/** Every credential shape found in `text`, named. Exported so the patterns are testable. */
export function credentialFindings(text: string): string[] {
  return CREDENTIAL_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

function assertNoCredentials(text: string, where: string): void {
  if (text.trim().length === 0)
    throw new SdodsError('RUN_FAILED', `The ${where} is empty.`, {
      hint: 'A credential scan over an empty body proves nothing about the endpoint, so this refuses rather than reporting green. Assert the status or the absence of a cookie instead.',
    });
  expect(credentialFindings(text), `credential-shaped values in the ${where}`).toEqual([]);
}

Then('nothing in the response body should look like a credential', async ({ apiContext }) => {
  // PROVES an over-serialised model did not leak a token into a response nobody reads closely.
  // Body only: the ApiSnapshot already redacts `authorization`/`set-cookie`, so scanning its
  // headers would assert over asterisks.
  assertNoCredentials(bodyText(apiContext.last().response.body), 'response body');
});

Then('nothing in the raw response body should look like a credential', async ({ apiContext }) => {
  // The raw variant, for a response whose headers were deliberately kept unredacted. Still body
  // only: a `Set-Cookie` on a successful sign-in IS a credential by design, and flagging it would
  // make this fail on every correct login.
  assertNoCredentials(rawOf(apiContext).body, 'raw response body');
});
