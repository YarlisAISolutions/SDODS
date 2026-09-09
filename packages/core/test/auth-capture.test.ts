import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Browser } from '@playwright/test';
import type { ResolvedConfig } from '../src/config/resolve.js';
import { captureAuth, listAuthStates, poolUsers, tokenFileFor } from '../src/auth/capture.js';
import { defineAuth } from '../src/auth/index.js';

function scaffold(poolSize?: number): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), 'sdods-auth-'));
  mkdirSync(join(root, 'data', 'common'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'common', 'users.csv'),
    'id,username,password,role\n1,standard_user,secret,standard\n2,problem_user,secret,problem\n3,standard_two,secret,standard\n4,admin,secret,admin\n',
  );
  return {
    project: {
      root,
      slug: 'shop',
      auth: {
        strategy: 'form',
        storageState: true,
        maxAgeMinutes: 60,
        form: {
          loginPath: '/',
          usernameSelector: '#u',
          passwordSelector: '#p',
          submitSelector: '#s',
        },
      },
      data: {
        sources: { users: { type: 'csv', path: 'data/common/users.csv' } },
        userPool: { dataset: 'users', roleColumn: 'role', leaseStore: 'file', leaseTtlMs: 1000 },
      },
    },
    env: {
      name: 'staging',
      ui: { baseUrl: 'https://shop.example.com' },
      users: { poolSize },
      vars: {},
    },
    runtime: { repoRoot: root, artifactsDir: join(root, '.sdods', 'runs') },
  } as unknown as ResolvedConfig;
}

const fakeBrowser = { close: async () => undefined } as unknown as Browser;

describe('poolUsers', () => {
  it('filters by role with per-role indexes and honours poolSize', async () => {
    const all = await poolUsers(scaffold());
    expect(all.map((u) => `${u.role}-${u.index}`)).toEqual([
      'standard-0',
      'problem-0',
      'standard-1',
      'admin-0',
    ]);
    const standard = await poolUsers(scaffold(), 'standard');
    expect(standard.map((u) => u.username)).toEqual(['standard_user', 'standard_two']);
    expect(await poolUsers(scaffold(2), 'standard')).toHaveLength(1);
    await expect(poolUsers(scaffold(), 'ghost')).rejects.toThrow(/No users with role "ghost"/);
  });
});

describe('captureAuth', () => {
  it('saves storage state per user via a custom strategy, without a real browser', async () => {
    const config = scaffold();
    const seen: string[] = [];
    const strategy = defineAuth({
      strategy: 'custom',
      login: async ({ user }) => {
        seen.push(user.username);
        return { cookies: [{ name: 'sid', value: `${user.username}-cookie` }], origins: [] };
      },
      token: async ({ user }) => `tok-${user.username}`,
    });
    const results = await captureAuth({
      config,
      role: 'standard',
      all: true,
      strategy,
      launch: async () => fakeBrowser,
    });
    expect(seen).toEqual(['standard_user', 'standard_two']);
    expect(results.map((r) => r.index)).toEqual([0, 1]);
    expect(results[0]!.file).toBe(join(config.project.root, '.auth', 'staging', 'standard-0.json'));
    expect(JSON.parse(readFileSync(results[1]!.file!, 'utf8')).cookies[0].value).toBe(
      'standard_two-cookie',
    );
    expect(
      existsSync(
        tokenFileFor(config, { id: '1', username: 'x', password: '', role: 'standard', index: 0 }),
      ),
    ).toBe(true);
    expect(JSON.parse(readFileSync(results[0]!.tokenFile!, 'utf8')).token).toBe(
      'tok-standard_user',
    );

    const listed = listAuthStates(config);
    expect(listed.map((s) => `${s.role}-${s.fresh}`)).toEqual(['standard-true', 'standard-true']);
    expect(listed[0]!.tokenFile).toBeDefined();
  });

  it('skips when the strategy is none and reports missing indexes', async () => {
    const config = scaffold();
    const none = await captureAuth({
      config,
      role: 'admin',
      strategy: defineAuth({ strategy: 'none' }),
      launch: async () => fakeBrowser,
    });
    expect(none[0]).toMatchObject({ skipped: 'auth.strategy is none', strategy: 'none' });
    await expect(
      captureAuth({ config, role: 'admin', index: 3, strategy: defineAuth({ strategy: 'none' }) }),
    ).rejects.toThrow(/index 3 does not exist/);
  });

  it('runs codegen --save-storage for interactive/SSO captures and records the sidecar', async () => {
    const config = scaffold();
    let calledWith: string[] = [];
    const results = await captureAuth({
      config,
      role: 'problem',
      strategy: defineAuth({ strategy: 'sso' }),
      runInteractive: async (args) => {
        calledWith = args;
        const file = args[args.indexOf('--save-storage') + 1]!;
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
        return 0;
      },
    });
    expect(calledWith.slice(0, 3)).toEqual(['playwright', 'codegen', '--save-storage']);
    expect(calledWith.at(-1)).toBe('https://shop.example.com/');
    expect(results[0]!.file).toMatch(/problem-0\.json$/);
    expect(listAuthStates(config)[0]).toMatchObject({ role: 'problem', fresh: true });
  });
});

describe('captureAuth: the token is a separate artefact from the login state', () => {
  // The bug this pins: `if (cache.isFresh(user)) continue` skipped the WHOLE user,
  // token included. A role could therefore hold a fresh browser session and no
  // token file at all, and every `@user:<role>` API scenario would fall through to
  // a live mint -- one identity-provider sign-in per scenario. That is the shape of
  // mybotbox-qa#57, where it produced 1,010 QUOTA_EXCEEDED records in one run.
  const strategyWith = (mints: string[]) =>
    defineAuth({
      strategy: 'custom',
      // Non-empty on purpose: `AuthStateCache.isFresh` treats an empty state as
      // not fresh, so an empty one would never exercise the skip path at all.
      login: async () => ({
        cookies: [{ name: 'session', value: 'x', domain: 'shop.example.com', path: '/' }],
        origins: [],
      }),
      token: async ({ user }) => {
        mints.push(user.username);
        return `tok-${user.username}-${mints.length}`;
      },
    });

  it('mints a token for a user whose login state is already fresh', async () => {
    const config = scaffold();
    const mints: string[] = [];
    const strategy = strategyWith(mints);

    const first = await captureAuth({
      config,
      role: 'admin',
      strategy,
      launch: async () => fakeBrowser,
    });
    expect(first[0].skipped).toBeUndefined();
    expect(first[0].tokenFile).toBeDefined();
    expect(mints).toHaveLength(1);

    // Second capture: the storage state is fresh (maxAgeMinutes 60), so the login
    // is skipped -- but the token file must still be there afterwards.
    const tokenFile = tokenFileFor(config, { username: 'admin', role: 'admin', index: 0 } as never);
    const second = await captureAuth({
      config,
      role: 'admin',
      strategy,
      launch: async () => fakeBrowser,
    });
    expect(second[0].skipped).toMatch(/fresh state exists/);
    expect(second[0].tokenFile).toBe(tokenFile);
    expect(existsSync(tokenFile)).toBe(true);
  });

  it('re-mints when the token file is gone even though the login state is fresh', async () => {
    const config = scaffold();
    const mints: string[] = [];
    const strategy = strategyWith(mints);
    await captureAuth({ config, role: 'admin', strategy, launch: async () => fakeBrowser });
    const tokenFile = tokenFileFor(config, { username: 'admin', role: 'admin', index: 0 } as never);
    rmSync(tokenFile);

    await captureAuth({ config, role: 'admin', strategy, launch: async () => fakeBrowser });
    expect(mints).toHaveLength(2);
    expect(JSON.parse(readFileSync(tokenFile, 'utf8')).token).toBe('tok-admin-2');
  });

  it('does not re-mint when a token file is already there', async () => {
    const config = scaffold();
    const mints: string[] = [];
    const strategy = strategyWith(mints);
    await captureAuth({ config, role: 'admin', strategy, launch: async () => fakeBrowser });
    await captureAuth({ config, role: 'admin', strategy, launch: async () => fakeBrowser });
    await captureAuth({ config, role: 'admin', strategy, launch: async () => fakeBrowser });
    // One mint, not three. A token is a credential on the application under test;
    // minting one per capture leaks keys into the AUT for no gain.
    expect(mints).toHaveLength(1);
  });

  it('--force re-mints', async () => {
    const config = scaffold();
    const mints: string[] = [];
    const strategy = strategyWith(mints);
    await captureAuth({ config, role: 'admin', strategy, launch: async () => fakeBrowser });
    await captureAuth({
      config,
      role: 'admin',
      strategy,
      force: true,
      launch: async () => fakeBrowser,
    });
    expect(mints).toHaveLength(2);
  });
});
