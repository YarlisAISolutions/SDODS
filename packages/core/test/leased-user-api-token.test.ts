import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectAuthSchema } from '@sdods/contracts';
import { ApiContext } from '../src/fixtures/api-context.js';
import { isSdodsError } from '../src/errors.js';
import { getLogLevel, setLogJson, setLogLevel, type LogLevel } from '../src/logger.js';
import '../src/steps/data.steps.js';

/**
 * #87 — `I use a leased user with role {string} for API calls` attached a bearer token on every
 * call without the scenario saying so. For a `custom` strategy whose `token()` mints a personal API
 * key, a scenario that then signs in with a session sent BOTH credentials, and "an API key is
 * refused here" could pass on whichever credential the server checked first.
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

const FOR_API = 'I use a leased user with role {string} for API calls';
const AUTHENTICATE = "I authenticate the API with the leased user's token";

const user = {
  id: 'u1',
  username: 'member@example.com',
  password: 'pw',
  role: 'member',
  index: 0,
};

function fixtures(strategy: string, apiToken?: 'implicit' | 'explicit') {
  const root = mkdtempSync(join(tmpdir(), 'sdods-leased-'));
  const token = vi.fn(async () => 'minted-api-key');
  return {
    token,
    root,
    fx: {
      userPool: { lease: vi.fn(async () => user) },
      apiContext: new ApiContext(),
      auth: { strategy, login: async () => undefined, token },
      config: {
        project: { root, auth: { strategy, ...(apiToken ? { apiToken } : {}) } },
        env: { name: 'staging' },
      },
      $testInfo: { parallelIndex: 0 },
    },
  };
}

let out: string[];
let previousLevel: LogLevel;
beforeEach(() => {
  // The credential log line is part of the contract; pin the level so an ambient
  // SDODS_LOG_LEVEL/SDODS_LOG_JSON cannot hide it.
  previousLevel = getLogLevel();
  setLogLevel('info');
  setLogJson(false);
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    out.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel(previousLevel);
  setLogJson(process.env.SDODS_LOG_JSON === '1');
});

describe('#87 — the leased user token is attached only when asked for', () => {
  it('custom strategy: leasing for API calls sets the variables and attaches NO credential', async () => {
    const { fx, token } = fixtures('custom');
    await step(FOR_API)(fx, 'member');
    expect(fx.apiContext.vars.get('username')).toBe('member@example.com');
    expect(fx.apiContext.auth).toBeUndefined();
    // …and does not mint a key the scenario never asked for.
    expect(token).not.toHaveBeenCalled();
    expect(out.join('')).toContain('no credential attached');
  });

  it("custom strategy: `I authenticate the API with the leased user's token` attaches it", async () => {
    const { fx, token } = fixtures('custom');
    await step(FOR_API)(fx, 'member');
    await step(AUTHENTICATE)(fx);
    expect(fx.apiContext.auth).toEqual({ type: 'bearer', token: 'minted-api-key' });
    expect(token).toHaveBeenCalledTimes(1);
    const log = out.join('');
    expect(log).toContain('bearer');
    expect(log).toContain('member@example.com');
    expect(log).toContain('token()');
    expect(log).not.toContain('minted-api-key');
  });

  it('the explicit step prefers the token `sdods auth capture` cached, and says so', async () => {
    const { fx, token, root } = fixtures('custom');
    mkdirSync(join(root, '.auth', 'staging'), { recursive: true });
    writeFileSync(
      join(root, '.auth', 'staging', 'member-0.token.json'),
      JSON.stringify({ token: 'cached-key' }),
    );
    await step(FOR_API)(fx, 'member');
    await step(AUTHENTICATE)(fx);
    expect(fx.apiContext.auth).toEqual({ type: 'bearer', token: 'cached-key' });
    expect(token).not.toHaveBeenCalled();
    expect(out.join('')).toContain('member-0.token.json');
  });

  it('`auth.apiToken: implicit` keeps the old behaviour for a custom strategy', async () => {
    const { fx } = fixtures('custom', 'implicit');
    await step(FOR_API)(fx, 'member');
    expect(fx.apiContext.auth).toEqual({ type: 'bearer', token: 'minted-api-key' });
  });

  it('`token` strategy defaults to implicit: the token IS its only credential (#18)', async () => {
    const { fx } = fixtures('token');
    await step(FOR_API)(fx, 'member');
    expect(fx.apiContext.auth).toEqual({ type: 'bearer', token: 'minted-api-key' });
    expect(out.join('')).toContain('bearer');
  });

  it('`auth.apiToken: explicit` turns it off for a token strategy as well', async () => {
    const { fx, token } = fixtures('token', 'explicit');
    await step(FOR_API)(fx, 'member');
    expect(fx.apiContext.auth).toBeUndefined();
    expect(token).not.toHaveBeenCalled();
  });

  it('the explicit step refuses to run without a leased user', async () => {
    const { fx } = fixtures('custom');
    const err = await step(AUTHENTICATE)(fx).catch((e) => e);
    expect(isSdodsError(err) && err.code).toBe('AUTH_FAILED');
    expect(err.hint).toContain('leased user');
  });

  it('the explicit step refuses when the strategy yields no token', async () => {
    const { fx } = fixtures('custom');
    fx.auth.token.mockResolvedValue(undefined as any);
    await step(FOR_API)(fx, 'member');
    const err = await step(AUTHENTICATE)(fx).catch((e) => e);
    expect(isSdodsError(err) && err.code).toBe('AUTH_FAILED');
    expect(fx.apiContext.auth).toBeUndefined();
  });

  it('the project schema keeps `auth.apiToken`', () => {
    expect(ProjectAuthSchema.parse({ apiToken: 'explicit' }).apiToken).toBe('explicit');
    expect(ProjectAuthSchema.parse({}).apiToken).toBeUndefined();
    expect(() => ProjectAuthSchema.parse({ apiToken: 'sometimes' })).toThrow();
  });
});
