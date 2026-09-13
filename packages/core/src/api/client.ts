import { writeFileSync } from 'node:fs';
import type { APIRequest, APIRequestContext, APIResponse, TestInfo } from '@playwright/test';
import { attachmentNames, scenarioFiles, type ApiSnapshot } from '@sdods/contracts';
import type { ApiAuthConfig } from '@sdods/contracts';
import type { ResolvedConfig } from '../config/resolve.js';
import { SdodsError } from '../errors.js';
import { Logger, redact } from '../logger.js';
import type { ApiContext } from '../fixtures/api-context.js';
import type { ScenarioMeta } from '../fixtures/scenario.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  form?: Record<string, string>;
  timeout?: number;
  retries?: number;
  /** Do not record/attach (used by cleanup calls). */
  silent?: boolean;
  /** Override the auth for this call. */
  auth?: ApiContext['auth'] | null;
}

export interface ApiClientDeps {
  request: APIRequestContext;
  /**
   * A request context with no cookie jar, used while `ctx.isolated` is set. The `api` fixture
   * creates it lazily (see {@link isolatedRequestFactory}) and disposes it at teardown.
   */
  isolatedRequest?: () => Promise<APIRequestContext>;
  config: ResolvedConfig;
  ctx: ApiContext;
  testInfo?: TestInfo;
  scenario?: ScenarioMeta;
  stepIndex?: () => number;
  /** Optional HAR hooks (installed by the har module in a later phase). */
  har?: {
    replay?: (req: ApiSnapshot['request']) => Promise<ApiSnapshot['response'] | undefined>;
    record?: (snap: ApiSnapshot) => Promise<void>;
    strict?: boolean;
  };
}

const REDACT_HEADERS = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

/**
 * HTTP client bound to a scenario. Every call becomes an ApiSnapshot in the ApiContext history,
 * is written under the scenario dir and attached to the test (request + response JSON).
 */
export class ApiClient {
  private readonly log = new Logger('api');
  readonly baseUrl: string;

  constructor(private readonly deps: ApiClientDeps) {
    this.baseUrl = deps.config.env.api.baseUrl.replace(/\/+$/, '');
  }

  get ctx() {
    return this.deps.ctx;
  }

  get(path: string, opts?: ApiRequestOptions) {
    return this.send('GET', path, opts);
  }
  post(path: string, opts?: ApiRequestOptions) {
    return this.send('POST', path, opts);
  }
  put(path: string, opts?: ApiRequestOptions) {
    return this.send('PUT', path, opts);
  }
  patch(path: string, opts?: ApiRequestOptions) {
    return this.send('PATCH', path, opts);
  }
  delete(path: string, opts?: ApiRequestOptions) {
    return this.send('DELETE', path, opts);
  }

  resolveUrl(path: string, query?: Record<string, string | number | boolean>): string {
    const url = /^https?:\/\//.test(path)
      ? new URL(path)
      : new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`);
    for (const [k, v] of this.deps.ctx.query) url.searchParams.set(k, v);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    return url.toString();
  }

  /**
   * The request context this scenario's calls go through.
   *
   * The shared `request` fixture is seeded from the test's context options, which on @ui/@hybrid
   * include the leased role's storageState — so every call also carries that session cookie, and
   * whatever cookies earlier responses set. `ctx.isolated` swaps in a context with an empty jar.
   */
  async requestContext(): Promise<APIRequestContext> {
    if (!this.deps.ctx.isolated) return this.deps.request;
    if (!this.deps.isolatedRequest) {
      throw new SdodsError(
        'NOT_SUPPORTED',
        'This API client was built without an isolated request context, so it cannot honour `I use an isolated API client`.',
        {
          hint: 'Use the `api` fixture from @sdods/core, or pass `isolatedRequest` when constructing ApiClient yourself.',
        },
      );
    }
    return this.deps.isolatedRequest();
  }

  private async buildHeaders(
    opts: ApiRequestOptions,
  ): Promise<{ headers: Record<string, string>; auth: ApiContext['auth'] }> {
    const env = this.deps.config.env.api;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...lower(env.headers),
      ...lower(Object.fromEntries(this.deps.ctx.headers)),
      ...lower(opts.headers ?? {}),
    };
    if (opts.body !== undefined && !headers['content-type'] && !opts.form)
      headers['content-type'] = 'application/json';
    const auth = await resolveAuth(opts.auth, this.deps.ctx.auth, env.auth);
    applyAuth(headers, auth);
    return { headers, auth };
  }

  async send(method: HttpMethod, path: string, opts: ApiRequestOptions = {}): Promise<ApiSnapshot> {
    const url = this.resolveUrl(path, opts.query);
    // Resolved before the attempt loop: a credential that cannot be obtained is a configuration
    // failure, not a transient one to retry, and the request must not go out without it.
    const { headers, auth } = await this.buildHeaders(opts);
    const timeout = opts.timeout ?? this.deps.config.project.timeouts.api;
    const maxAttempts = 1 + (opts.retries ?? (this.deps.config.runtime.ci ? 1 : 0));
    const startedAt = new Date().toISOString();
    const stepIndex = this.deps.stepIndex?.() ?? 0;

    const requestSnap: ApiSnapshot['request'] = {
      method,
      url,
      headers: redactHeaders(headers),
      body: opts.form ?? (Buffer.isBuffer(opts.body) ? opts.body.toString('utf8') : opts.body),
      query: opts.query
        ? Object.fromEntries(Object.entries(opts.query).map(([k, v]) => [k, String(v)]))
        : undefined,
      // Which credential class went out, never its value — so a report shows at a glance
      // whether a scenario sent a bearer, a key header, or nothing.
      auth: describeAuth(auth),
      ...(this.deps.ctx.isolated ? { isolated: true } : {}),
    };

    // HAR replay (API layer playback)
    if (this.deps.har?.replay) {
      const replayed = await this.deps.har.replay(requestSnap);
      if (replayed) {
        const snap: ApiSnapshot = {
          request: requestSnap,
          response: replayed,
          startedAt,
          replayedFromHar: true,
        };
        if (!opts.silent) this.recordAndAttach(snap, stepIndex);
        return snap;
      }
      if (this.deps.har.strict)
        throw new Error(`HAR strict mode: no recorded entry for ${method} ${url}`);
    }

    const request = await this.requestContext();
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = Date.now();
      try {
        this.log.step(
          `→ ${method} ${url}`,
          opts.body !== undefined ? { body: requestSnap.body } : undefined,
        );
        const res: APIResponse = await request.fetch(url, {
          method,
          headers,
          data: opts.form ? undefined : encodeBody(opts.body),
          form: opts.form,
          timeout,
          failOnStatusCode: false,
          maxRedirects: 10,
        });
        const responseTime = Date.now() - t0;
        const rawBody = await res.text();
        let body: unknown = rawBody;
        try {
          body = rawBody.length ? JSON.parse(rawBody) : null;
        } catch {
          /* keep raw text */
        }
        const snap: ApiSnapshot = {
          request: requestSnap,
          response: {
            status: res.status(),
            statusText: res.statusText(),
            headers: redactHeaders(res.headers()),
            body,
            rawBody:
              typeof body === 'string' ? undefined : rawBody.length > 200_000 ? undefined : rawBody,
            responseTime,
          },
          startedAt,
        };
        this.log.info(`← ${snap.response.status} ${snap.response.statusText} (${responseTime} ms)`);
        if (!opts.silent) this.recordAndAttach(snap, stepIndex);
        if (this.deps.har?.record) await this.deps.har.record(snap);
        return snap;
      } catch (e) {
        lastError = e;
        if (attempt < maxAttempts) {
          this.log.warn(
            `${method} ${url} failed (attempt ${attempt}/${maxAttempts}): ${(e as Error).message}; retrying…`,
          );
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private recordAndAttach(snap: ApiSnapshot, stepIndex: number) {
    const n = this.deps.ctx.record(snap, stepIndex);
    const { scenario, testInfo } = this.deps;
    if (!scenario || !testInfo) return;
    try {
      const reqFile = scenario.file(scenarioFiles.apiJson(stepIndex, n, 'request'));
      const resFile = scenario.file(scenarioFiles.apiJson(stepIndex, n, 'response'));
      writeFileSync(reqFile, JSON.stringify(redact(snap.request), null, 2));
      writeFileSync(resFile, JSON.stringify({ ...snap.response, rawBody: undefined }, null, 2));
      void testInfo.attach(attachmentNames.api(stepIndex, n, 'request'), {
        path: reqFile,
        contentType: 'application/json',
      });
      void testInfo.attach(attachmentNames.api(stepIndex, n, 'response'), {
        path: resFile,
        contentType: 'application/json',
      });
    } catch (e) {
      this.log.debug(`could not attach API snapshot: ${(e as Error).message}`);
    }
  }
}

function lower(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(h).map(([k, v]) => [k, REDACT_HEADERS.test(k) ? '***' : v]),
  );
}

/**
 * The bytes to send.
 *
 * A string goes out as a Buffer, never as Playwright's `data: string`: when the content-type is
 * exactly `application/json`, Playwright runs `JSON.stringify` over any string that does not parse,
 * so `{ this is not json` arrived as the valid JSON string `"{ this is not json"` and a server's
 * malformed-body branch could never be reached. Objects are serialised here, once.
 */
export function encodeBody(body: unknown): Buffer | undefined {
  if (body === undefined) return undefined;
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
}

/**
 * Which credential a request carries. `null` at either level means "send this unauthenticated";
 * only `undefined` falls through to the next layer, so a scenario can opt out of the environment
 * credential without the environment having to know.
 */
export async function resolveAuth(
  optsAuth: ApiContext['auth'] | undefined,
  ctxAuth: ApiContext['auth'],
  env: ApiAuthConfig,
): Promise<ApiContext['auth']> {
  if (optsAuth === null) return undefined;
  if (optsAuth) return optsAuth;
  if (ctxAuth === null) return undefined;
  return ctxAuth ?? envAuth(env);
}

export function applyAuth(headers: Record<string, string>, auth: ApiContext['auth']): void {
  if (!auth) return;
  if (auth.type === 'bearer') headers.authorization = `Bearer ${auth.token}`;
  else if (auth.type === 'basic')
    headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  else if (auth.type === 'header') headers[auth.name.toLowerCase()] = auth.value;
}

function describeAuth(auth: ApiContext['auth']): string {
  if (!auth) return 'none';
  return auth.type === 'header' ? `header:${auth.name.toLowerCase()}` : auth.type;
}

/**
 * The environment credential. Every type the schema accepts is either implemented or refused:
 * returning `undefined` for an unhandled type sent every request anonymous with no warning, and
 * an authorization scenario against an endpoint that answers anonymous reads passed while
 * proving nothing.
 */
export async function envAuth(auth: ApiAuthConfig): Promise<ApiContext['auth']> {
  switch (auth.type) {
    case 'none':
      return undefined;
    case 'bearer':
      return { type: 'bearer', token: auth.token };
    case 'basic':
      return { type: 'basic', username: auth.username, password: auth.password };
    case 'header':
      return { type: 'header', name: auth.name, value: auth.value };
    case 'oauth-client-credentials':
      return { type: 'bearer', token: await clientCredentialsToken(auth) };
    default:
      throw new SdodsError(
        'NOT_SUPPORTED',
        `env.api.auth type "${(auth as { type?: unknown }).type}" is not supported by the API client.`,
        {
          hint: 'Use one of none, bearer, basic, header or oauth-client-credentials, or set the credential per scenario with `I authenticate with bearer token from "<VAR>"`.',
          exitCode: 2,
        },
      );
  }
}

type ClientCredentialsAuth = Extract<ApiAuthConfig, { type: 'oauth-client-credentials' }>;

/** Tokens are refreshed this long before they expire, so a request never races the expiry. */
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const tokenCache = new Map<string, Promise<{ token: string; expiresAt: number }>>();

/**
 * OAuth 2.0 client-credentials grant (RFC 6749 §4.4), cached per worker process until shortly
 * before `expires_in`. A response without `expires_in` is cached for the life of the worker.
 * Concurrent callers share one in-flight request.
 */
export async function clientCredentialsToken(auth: ClientCredentialsAuth): Promise<string> {
  const key = [auth.tokenUrl, auth.clientId, auth.scope ?? '', auth.audience ?? ''].join('\n');
  const cached = tokenCache.get(key);
  if (cached) {
    const hit = await cached.catch(() => undefined);
    if (hit && hit.expiresAt > Date.now()) return hit.token;
    if (tokenCache.get(key) === cached) tokenCache.delete(key);
  }
  const pending = mintClientCredentialsToken(auth);
  tokenCache.set(key, pending);
  try {
    return (await pending).token;
  } catch (e) {
    if (tokenCache.get(key) === pending) tokenCache.delete(key);
    throw e;
  }
}

async function mintClientCredentialsToken(
  auth: ClientCredentialsAuth,
): Promise<{ token: string; expiresAt: number }> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
  });
  if (auth.scope) body.set('scope', auth.scope);
  if (auth.audience) body.set('audience', auth.audience);
  const hint = `Check tokenUrl, clientId and clientSecret in env.api.auth (secrets as \${VAR}).`;
  let res: Response;
  try {
    res = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    });
  } catch (cause) {
    throw new SdodsError(
      'AUTH_FAILED',
      `OAuth token request to ${auth.tokenUrl} failed: ${(cause as Error).message}`,
      { hint, cause },
    );
  }
  if (!res.ok) {
    throw new SdodsError(
      'AUTH_FAILED',
      `OAuth token request to ${auth.tokenUrl} was refused: ${res.status} ${res.statusText}`,
      { hint },
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new SdodsError(
      'AUTH_FAILED',
      `OAuth token response from ${auth.tokenUrl} has no access_token.`,
      { hint },
    );
  }
  const expiresIn = Number(json.expires_in);
  const expiresAt = Number.isFinite(expiresIn)
    ? Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_SKEW_MS
    : Number.POSITIVE_INFINITY;
  return { token: json.access_token, expiresAt };
}

/** Test/teardown hook: forget cached client-credentials tokens. */
export function clearClientCredentialsTokens(): void {
  tokenCache.clear();
}

/**
 * A lazily created request context with an EMPTY cookie jar, for `I use an isolated API client`.
 *
 * The options are explicit rather than omitted: inside the test runner Playwright fills in any
 * context option whose key is absent from the test's `use` (storageState — the role's session —
 * httpCredentials, extraHTTPHeaders), so an omitted storageState would quietly bring the jar back.
 * Transport settings (baseURL, proxy, ignoreHTTPSErrors, client certificates) still apply.
 */
export function isolatedRequestFactory(playwrightRequest: Pick<APIRequest, 'newContext'>): {
  get: () => Promise<APIRequestContext>;
  dispose: () => Promise<void>;
} {
  let pending: Promise<APIRequestContext> | undefined;
  return {
    get: () =>
      (pending ??= playwrightRequest.newContext({
        storageState: { cookies: [], origins: [] },
        httpCredentials: undefined,
        extraHTTPHeaders: undefined,
      })),
    dispose: async () => {
      if (!pending) return;
      const ctx = await pending.catch(() => undefined);
      pending = undefined;
      await ctx?.dispose();
    },
  };
}
