import { expect } from '@playwright/test';
import './params.js';
import { Given, Then, When } from '../fixtures/test.js';
import type { HttpMethod } from '../api/client.js';
import { coerce, getPath } from '../api/json-path.js';
import { renderJson, renderStrict } from '../api/template.js';
import { pollUntil } from '../api/poll.js';
import {
  loadJsonSchema,
  loadZodSchema,
  validateAgainstOpenApi,
  validateJsonSchema,
  validateZod,
} from '../api/validate.js';
import { SdodsError } from '../errors.js';

/* ── requests ─────────────────────────────────────────────────────────── */

When(
  'I send a {method} request to {string}',
  async ({ api, apiContext, env }, method: HttpMethod, path: string) => {
    await api.send(method, renderStrict(path, apiContext.vars.toObject(), env.vars));
  },
);

When(
  'I send a {method} request to {string} with body:',
  async ({ api, apiContext, env }, method: HttpMethod, path: string, body: string) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    await api.send(method, renderStrict(path, ...scopes), { body: renderJson(body, ...scopes) });
  },
);

/**
 * The doc string goes out byte-for-byte: not parsed, not re-serialised, and not template-rendered
 * (only the path is). This is how a malformed-input scenario sends `{ this is not json`; the
 * `with body:` step parses a `json` doc string and would throw before sending.
 * The content-type defaults to `application/json`; set another with `I set the request header`.
 */
When(
  'I send a {method} request to {string} with the raw body:',
  async ({ api, apiContext, env }, method: HttpMethod, path: string, body: string) => {
    await api.send(method, render(path, apiContext.vars.toObject(), env.vars), {
      body: Buffer.from(body, 'utf8'),
    });
  },
);

When(
  'I send a {method} request to {string} with form:',
  async ({ api, apiContext, env }, method: HttpMethod, path: string, table: any) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    const form: Record<string, string> = {};
    for (const [k, v] of table.raw() as string[][])
      form[k!] = renderStrict(String(v ?? ''), ...scopes);
    await api.send(method, renderStrict(path, ...scopes), { form });
  },
);

Given(
  'I set the request header {string} to {string}',
  async ({ apiContext, env }, name: string, value: string) => {
    apiContext.headers.set(name, renderStrict(value, apiContext.vars.toObject(), env.vars));
  },
);

Given(
  'I set the query parameter {string} to {string}',
  async ({ apiContext, env }, name: string, value: string) => {
    apiContext.query.set(name, renderStrict(value, apiContext.vars.toObject(), env.vars));
  },
);

Given('I clear the request headers and query parameters', async ({ apiContext }) => {
  apiContext.resetRequestState();
});

Given('I authenticate with bearer token from {string}', async ({ apiContext }, varName: string) => {
  const token = process.env[varName] ?? apiContext.vars.get<string>(varName);
  if (!token)
    throw new SdodsError(
      'AUTH_FAILED',
      `No token found in env var or scenario variable "${varName}".`,
    );
  apiContext.auth = { type: 'bearer', token };
});

Given(
  'I authenticate with basic credentials {string} and {string}',
  async ({ apiContext, env }, username: string, password: string) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    apiContext.auth = {
      type: 'basic',
      username: renderStrict(username, ...scopes),
      password: renderStrict(password, ...scopes),
    };
  },
);

Given('I use no authentication', async ({ apiContext }) => {
  // `null`, not `undefined`: undefined means "unset, fall back to env.api.auth",
  // which made this step a no-op on every environment that declares a
  // credential — exactly the environments where asserting an unauthenticated
  // refusal matters.
  apiContext.auth = null;
});

/**
 * Send the rest of the scenario's API calls through a request context with an empty cookie jar,
 * so they carry only the credentials the scenario set. Without it, @ui/@hybrid calls also carry the
 * leased role's session cookie, and "credential X alone is refused" can pass on the session.
 */
Given('I use an isolated API client', async ({ apiContext }) => {
  apiContext.isolated = true;
});

/* ── assertions ───────────────────────────────────────────────────────── */

Then('the response status should be {int}', async ({ apiContext }, status: number) => {
  expect(
    apiContext.last().response.status,
    `expected HTTP ${status}, got ${apiContext.last().response.status} ${apiContext.last().response.statusText}`,
  ).toBe(status);
});

Then('the response status should be one of {string}', async ({ apiContext }, list: string) => {
  const allowed = list
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  expect(allowed).toContain(apiContext.last().response.status);
});

Then('the response should contain {string}', async ({ apiContext, env }, text: string) => {
  const body = apiContext.last().response.body;
  const haystack = typeof body === 'string' ? body : JSON.stringify(body);
  expect(haystack).toContain(renderStrict(text, apiContext.vars.toObject(), env.vars));
});

Then(
  'the response JSON path {string} should equal {string}',
  async ({ apiContext, env }, jsonPath: string, expected: string) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    const path = renderStrict(jsonPath, ...scopes);
    const actual = getPath(apiContext.last().response.body, path);
    expect(actual, `JSON path ${path}`).toEqual(coerce(renderStrict(expected, ...scopes)));
  },
);

Then(
  'the response JSON path {string} should exist',
  async ({ apiContext, env }, jsonPath: string) => {
    const path = renderStrict(jsonPath, apiContext.vars.toObject(), env.vars);
    expect(getPath(apiContext.last().response.body, path), `JSON path ${path}`).toBeDefined();
  },
);

Then(
  'the response JSON path {string} should match {string}',
  async ({ apiContext, env }, jsonPath: string, pattern: string) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    const path = renderStrict(jsonPath, ...scopes);
    const actual = getPath(apiContext.last().response.body, path);
    expect(String(actual), `JSON path ${path}`).toMatch(
      new RegExp(renderStrict(pattern, ...scopes)),
    );
  },
);

Then(
  'the response JSON path {string} should have {int} items',
  async ({ apiContext, env }, jsonPath: string, count: number) => {
    const path = renderStrict(jsonPath, apiContext.vars.toObject(), env.vars);
    const actual = getPath(apiContext.last().response.body, path);
    expect(Array.isArray(actual) ? actual.length : -1, `JSON path ${path} length`).toBe(count);
  },
);

Then(
  'the response JSON path {string} should have at least {int} items',
  async ({ apiContext, env }, jsonPath: string, count: number) => {
    const path = renderStrict(jsonPath, apiContext.vars.toObject(), env.vars);
    const actual = getPath(apiContext.last().response.body, path);
    expect(
      Array.isArray(actual) ? actual.length : -1,
      `JSON path ${path} length`,
    ).toBeGreaterThanOrEqual(count);
  },
);

Then('the response body should be an array', async ({ apiContext }) => {
  expect(Array.isArray(apiContext.last().response.body)).toBe(true);
});

Then(
  'the response header {string} should contain {string}',
  async ({ apiContext, env }, name: string, value: string) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    const header = renderStrict(name, ...scopes).toLowerCase();
    expect(apiContext.last().response.headers[header] ?? '').toContain(
      renderStrict(value, ...scopes),
    );
  },
);

Then('the response time should be under {int} ms', async ({ apiContext }, maxMs: number) => {
  expect(apiContext.last().response.responseTime).toBeLessThan(maxMs);
});

Then(
  'the response should match the JSON schema {string}',
  async ({ apiContext, config, env }, schemaFile: string) => {
    const file = renderStrict(schemaFile, apiContext.vars.toObject(), env.vars);
    const result = validateJsonSchema(
      apiContext.last().response.body,
      loadJsonSchema(config, file),
    );
    expect(result.ok, `schema ${file} violations:\n${result.errors.join('\n')}`).toBe(true);
  },
);

Then(
  'the response should match the zod schema {string}',
  async ({ apiContext, config, env }, zodSpec: string) => {
    const spec = renderStrict(zodSpec, apiContext.vars.toObject(), env.vars);
    const result = validateZod(apiContext.last().response.body, await loadZodSchema(config, spec));
    expect(result.ok, `zod schema ${spec} violations:\n${result.errors.join('\n')}`).toBe(true);
  },
);

Then(
  'the response should match the OpenAPI schema for {method} {string}',
  async ({ apiContext, config, env }, method: HttpMethod, openApiPath: string) => {
    // Single-brace `{id}` path parameters are not placeholders, so they pass through untouched.
    const path = renderStrict(openApiPath, apiContext.vars.toObject(), env.vars);
    const last = apiContext.last();
    const result = await validateAgainstOpenApi(
      config,
      method,
      path,
      last.response.status,
      last.response.body,
    );
    expect(result.ok, `OpenAPI ${method} ${path} violations:\n${result.errors.join('\n')}`).toBe(
      true,
    );
  },
);

/* ── chaining & polling ───────────────────────────────────────────────── */

When(
  'I save the response JSON path {string} as {string}',
  async ({ apiContext, env }, jsonPath: string, name: string) => {
    // `name` is the variable being written, an identifier rather than a template.
    const path = renderStrict(jsonPath, apiContext.vars.toObject(), env.vars);
    const value = getPath(apiContext.last().response.body, path);
    if (value === undefined)
      throw new SdodsError(
        'RUN_FAILED',
        `JSON path ${path} is undefined in the last response; cannot save as {{${name}}}.`,
      );
    apiContext.vars.set(name, value);
  },
);

Given(
  'I set the variable {string} to {string}',
  async ({ apiContext, env }, name: string, value: string) => {
    apiContext.vars.set(name, coerce(renderStrict(value, apiContext.vars.toObject(), env.vars)));
  },
);

When(
  'I poll {method} {string} until JSON path {string} equals {string} within {int} seconds',
  async (
    { api, apiContext, env },
    method: HttpMethod,
    path: string,
    jsonPath: string,
    expected: string,
    seconds: number,
  ) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    // Rendered before polling, so an unset variable fails at once rather than inside every attempt.
    const want = coerce(renderStrict(expected, ...scopes));
    const url = renderStrict(path, ...scopes);
    const at = renderStrict(jsonPath, ...scopes);
    await pollUntil(
      () => api.send(method, url),
      (snap) => JSON.stringify(getPath(snap.response.body, at)) === JSON.stringify(want),
      {
        timeoutMs: seconds * 1000,
        intervalMs: 1000,
        description: `${method} ${path} → ${jsonPath} == ${expected}`,
      },
    );
  },
);

When(
  'I poll {method} {string} until the status is {int} within {int} seconds',
  async (
    { api, apiContext, env },
    method: HttpMethod,
    path: string,
    status: number,
    seconds: number,
  ) => {
    await pollUntil(
      () => api.send(method, renderStrict(path, apiContext.vars.toObject(), env.vars)),
      (snap) => snap.response.status === status,
      {
        timeoutMs: seconds * 1000,
        intervalMs: 1000,
        description: `${method} ${path} → HTTP ${status}`,
      },
    );
  },
);
