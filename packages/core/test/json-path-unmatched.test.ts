import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getPath } from '../src/api/json-path.js';
import { ApiContext } from '../src/fixtures/api-context.js';
import { isSdodsError } from '../src/errors.js';
import '../src/steps/api.steps.js';
import '../src/steps/net.steps.js';
import '../src/steps/hybrid.steps.js';

/**
 * #114 — `getPath` returned `[]` for a JSONPath (`$…`) that matched nothing, and `undefined` for a
 * dotted path that matched nothing. Every step treats "not undefined" as found, so on a `$` path
 * `should exist` passed on a missing key, `should not exist` could never pass, and `save` stored
 * `[]` (later rendered into URLs as `/api/knowledge/[]/documents`).
 *
 * These drive the real registered step functions.
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

async function expectSdodsError(promise: Promise<unknown>, text?: string) {
  let caught: unknown;
  await promise.catch((e) => {
    caught = e;
  });
  expect(caught, 'expected the step to throw').toBeDefined();
  expect(isSdodsError(caught), `expected an SdodsError, got: ${String(caught)}`).toBe(true);
  const err = caught as { code: string; hint?: string; message: string };
  expect(err.hint, 'SdodsError must carry a hint').toBeTruthy();
  if (text) expect(`${err.code} ${err.message}`).toContain(text);
}

function fixturesFor(body: unknown) {
  const apiContext = new ApiContext();
  apiContext.record(
    {
      request: { method: 'GET', url: 'http://api.test/v1/x', headers: {} },
      response: { status: 200, statusText: 'OK', headers: {}, body, responseTime: 1 },
      startedAt: '2024-01-01T00:00:00.000Z',
    } as any,
    0,
  );
  return { apiContext, env: { name: 'test', vars: {} } as any };
}

const EXIST = 'the response JSON path {string} should exist';
const NOT_EXIST = 'the response JSON path {string} should not exist';
const SAVE = 'I save the response JSON path {string} as {string}';
const HAVE_ITEMS = 'the response JSON path {string} should have {int} items';
const POLL =
  'I poll {method} {string} until JSON path {string} equals {string} within {int} seconds';
const UI_TEXT = 'the UI should show the text from JSON path {string}';

const UNAUTHORIZED = { error: 'Unauthorized' };

describe('getPath: no match is undefined for both path syntaxes', () => {
  const body = { data: { id: 7, empty: [], nothing: null, items: [{ id: 1 }, { id: 2 }] } };

  it('a missing key is undefined', () => {
    expect(getPath(UNAUTHORIZED, 'data.missing')).toBeUndefined();
    expect(getPath(UNAUTHORIZED, '$.data.missing')).toBeUndefined();
    expect(getPath(body, '$..nope')).toBeUndefined();
    expect(getPath(body, '$.data.items[?(@.id==99)]')).toBeUndefined();
  });

  it('a single match is the value itself', () => {
    expect(getPath(body, 'data.id')).toBe(7);
    expect(getPath(body, '$.data.id')).toBe(7);
    expect(getPath(body, '$.data.items[?(@.id==2)].id')).toBe(2);
  });

  it('a matched empty array is [] and a matched null is null, not "no match"', () => {
    expect(getPath(body, 'data.empty')).toEqual([]);
    expect(getPath(body, '$.data.empty')).toEqual([]);
    expect(getPath(body, 'data.nothing')).toBeNull();
    expect(getPath(body, '$.data.nothing')).toBeNull();
  });

  it('two or more matches are an array', () => {
    expect(getPath(body, '$.data.items[*].id')).toEqual([1, 2]);
    expect(getPath(body, '$..id')).toEqual([7, 1, 2]);
  });
});

describe('`should exist` / `should not exist`', () => {
  it('should exist fails on a missing key whatever the path syntax', async () => {
    const fx = fixturesFor(UNAUTHORIZED);
    await expect(step(EXIST)(fx, 'data.missing')).rejects.toThrow();
    await expect(step(EXIST)(fx, '$.data.missing')).rejects.toThrow();
  });

  it('should exist passes on a present key, including one whose value is null or []', async () => {
    const fx = fixturesFor({ data: { id: 1, nothing: null, empty: [] } });
    for (const path of ['data.id', '$.data.id', '$.data.nothing', '$.data.empty']) {
      await expect(step(EXIST)(fx, path), path).resolves.toBeUndefined();
    }
  });

  it('should not exist passes on a missing key for a $ path, and fails on a present one', async () => {
    const fx = fixturesFor(UNAUTHORIZED);
    await expect(step(NOT_EXIST)(fx, '$.data.missing')).resolves.toBeUndefined();
    await expect(step(NOT_EXIST)(fx, 'data.missing')).resolves.toBeUndefined();
    await expect(step(NOT_EXIST)(fx, '$.error')).rejects.toThrow();
  });
});

describe('`I save the response JSON path {string} as {string}`', () => {
  it('fails with a clear SdodsError when nothing matches, for both syntaxes', async () => {
    for (const path of ['$.data.id', 'data.id']) {
      const fx = fixturesFor(UNAUTHORIZED);
      await expectSdodsError(step(SAVE)(fx, path, 'kbId'), 'matched nothing');
      expect(fx.apiContext.vars.has('kbId'), `${path} must not store anything`).toBe(false);
    }
  });

  it('still saves a key that is present with the value null or []', async () => {
    const fx = fixturesFor({ data: { nothing: null, empty: [] } });
    await step(SAVE)(fx, '$.data.nothing', 'a');
    await step(SAVE)(fx, '$.data.empty', 'b');
    expect(fx.apiContext.vars.get('a')).toBeNull();
    expect(fx.apiContext.vars.get('b')).toEqual([]);
  });
});

describe('other steps that read a JSON path', () => {
  it('`should have {int} items` does not count a missing $ path as zero items', async () => {
    const fx = fixturesFor(UNAUTHORIZED);
    await expectSdodsError(step(HAVE_ITEMS)(fx, '$.data.items', 0), 'matched nothing');
    await expect(
      step(HAVE_ITEMS)(fixturesFor({ data: { items: [] } }), '$.data.items', 0),
    ).resolves.toBeUndefined();
  });

  it('polling for "[]" does not succeed on a body that lacks the key', async () => {
    const fx = {
      ...fixturesFor(UNAUTHORIZED),
      api: { send: async () => ({ response: { body: UNAUTHORIZED } }) },
    };
    await expect(step(POLL)(fx, 'GET', '/x', '$.data.ids', '[]', 1)).rejects.toThrow(
      /did not succeed/,
    );
  });

  it('`the UI should show the text from JSON path` fails when nothing matches', async () => {
    const page = {
      getByText: () => {
        throw new Error('must not look for text when the path matched nothing');
      },
    };
    await expectSdodsError(
      step(UI_TEXT)({ ...fixturesFor(UNAUTHORIZED), page }, '$.data.name'),
      'matched nothing',
    );
  });
});
