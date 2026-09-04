import { writeFileSync } from 'node:fs';
import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test';
import { attachmentNames, scenarioFiles, type ApiSnapshot } from '@sdods/contracts';
import type { ApiAuthConfig } from '@sdods/contracts';
import type { ResolvedConfig } from '../config/resolve.js';
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

  private buildHeaders(opts: ApiRequestOptions): Record<string, string> {
    const env = this.deps.config.env.api;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...lower(env.headers),
      ...lower(Object.fromEntries(this.deps.ctx.headers)),
      ...lower(opts.headers ?? {}),
    };
    if (opts.body !== undefined && !headers['content-type'] && !opts.form)
      headers['content-type'] = 'application/json';
    const auth =
      opts.auth === null ? undefined : (opts.auth ?? this.deps.ctx.auth ?? envAuth(env.auth));
    if (auth) {
      if (auth.type === 'bearer') headers.authorization = `Bearer ${auth.token}`;
      else if (auth.type === 'basic')
        headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
      else if (auth.type === 'header') headers[auth.name.toLowerCase()] = auth.value;
    }
    return headers;
  }

  async send(method: HttpMethod, path: string, opts: ApiRequestOptions = {}): Promise<ApiSnapshot> {
    const url = this.resolveUrl(path, opts.query);
    const headers = this.buildHeaders(opts);
    const timeout = opts.timeout ?? this.deps.config.project.timeouts.api;
    const maxAttempts = 1 + (opts.retries ?? (this.deps.config.runtime.ci ? 1 : 0));
    const startedAt = new Date().toISOString();
    const stepIndex = this.deps.stepIndex?.() ?? 0;

    const requestSnap: ApiSnapshot['request'] = {
      method,
      url,
      headers: redactHeaders(headers),
      body: opts.form ?? opts.body,
      query: opts.query
        ? Object.fromEntries(Object.entries(opts.query).map(([k, v]) => [k, String(v)]))
        : undefined,
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

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = Date.now();
      try {
        this.log.step(
          `→ ${method} ${url}`,
          opts.body !== undefined ? { body: opts.body } : undefined,
        );
        const res: APIResponse = await this.deps.request.fetch(url, {
          method,
          headers,
          data: opts.form
            ? undefined
            : opts.body === undefined
              ? undefined
              : typeof opts.body === 'string'
                ? opts.body
                : JSON.stringify(opts.body),
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

function envAuth(auth: ApiAuthConfig): ApiContext['auth'] {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: auth.token };
    case 'basic':
      return { type: 'basic', username: auth.username, password: auth.password };
    case 'header':
      return { type: 'header', name: auth.name, value: auth.value };
    default:
      return undefined;
  }
}
