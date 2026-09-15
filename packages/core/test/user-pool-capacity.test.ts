import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkPoolCapacity,
  poolAccountsFor,
  poolDemandByRole,
  poolTooSmallError,
} from '../src/data/pool-capacity.js';
import { CompositeDataProvider } from '../src/data/provider.js';
import {
  DEFAULT_LEASE_WAIT_MS,
  FileUserPool,
  effectiveWorkers,
  leaseWaitMs,
  scenarioLeaseClock,
} from '../src/data/user-pool.js';
import { resolveConfig } from '../src/config/resolve.js';
import { isSdodsError } from '../src/errors.js';

/**
 * #153: an exclusive lease lives as long as its Playwright worker, so a role with fewer accounts
 * than the workers reaching its scenarios starves every other worker — 55 passed / 335 failed at
 * --workers 4 with one `member` account. `sdods run` now refuses that up front, and
 * `leaseScope: scenario` makes one account serialise its scenarios instead.
 */

interface Opts {
  users?: string[][];
  pool?: string[];
  env?: string;
  features?: Record<string, string>;
  project?: string[];
}

function workspace(o: Opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-capacity-'));
  const projectRoot = join(root, 'projects', 'demo');
  mkdirSync(join(projectRoot, 'envs'), { recursive: true });
  mkdirSync(join(projectRoot, 'data', 'common'), { recursive: true });
  writeFileSync(
    join(root, 'sdods.workspace.yaml'),
    'organization:\n  slug: t\n  name: T\nworkspaces:\n  - slug: default\n    name: D\n    organization: t\ndefaultWorkspace: default\n',
  );
  writeFileSync(
    join(projectRoot, 'sdods.project.yaml'),
    [
      'slug: demo',
      'name: Demo',
      'organization: t',
      'workspace: default',
      'layers: [ui, api]',
      'browsers: [chromium, firefox]',
      'envs:',
      '  default: staging',
      '  available: [staging]',
      ...(o.project ?? []),
      'data:',
      '  sources:',
      '    users: { type: csv, path: data/common/users.csv }',
      '  userPool:',
      '    dataset: users',
      '    roleColumn: role',
      ...(o.pool ?? []).map((l) => `    ${l}`),
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(projectRoot, 'envs', 'staging.yaml'),
    o.env ??
      'name: staging\nui:\n  baseUrl: https://example.test\napi:\n  baseUrl: https://api.example.test\n  auth: { type: none }\n',
  );
  writeFileSync(
    join(projectRoot, 'data', 'common', 'users.csv'),
    ['id,username,password,role', ...(o.users ?? ONE_MEMBER).map((u) => u.join(','))].join('\n') +
      '\n',
  );
  for (const [name, text] of Object.entries(o.features ?? {})) {
    const file = join(projectRoot, 'features', name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return {
    root,
    config: resolveConfig({
      rootDir: root,
      projectRoot,
      env: 'staging',
      processEnv: {},
      cliOverrides: { runId: 'run-1', artifactsDir: join(root, '.sdods', 'runs') },
    }),
  };
}

const ONE_MEMBER = [
  ['1', 'member@example.test', 'x', 'member'],
  ['2', 'admin@example.test', 'x', 'admin'],
];

const FOUR_MEMBER_SCENARIOS = `@api @regression @user:member
Feature: Members

  Scenario: one
    Given a step

  Scenario: two
    Given a step

  Scenario: three
    Given a step

  Scenario: four
    Given a step
`;

const demandOf = (config: ReturnType<typeof workspace>['config'], extra = {}) =>
  poolDemandByRole(config.project, 'staging', {
    layers: ['api'],
    browsers: ['chromium'],
    fullyParallel: true,
    ...extra,
  });

describe('poolDemandByRole counts what could lease at once, and never more', () => {
  it('one unit per scenario per run target', () => {
    const { config } = workspace({
      features: {
        'm/members.feature': FOUR_MEMBER_SCENARIOS,
        'm/ui.feature': `@ui @smoke @user:admin\nFeature: UI\n\n  Scenario: a\n    Given a step\n`,
      },
    });
    expect([...demandOf(config)]).toEqual([['member', 4]]);
    // a ui scenario runs once per browser; api ignores browsers
    const both = demandOf(config, { layers: ['ui', 'api'], browsers: ['chromium', 'firefox'] });
    expect(both.get('admin')).toBe(2);
    expect(both.get('member')).toBe(4);
  });

  it('honours --tags, the setup tier and the runtime tag gate', () => {
    const { config } = workspace({
      features: {
        'm/members.feature': `@api @regression @user:member
Feature: Members

  @smoke
  Scenario: selected
    Given a step

  Scenario: not selected by tags
    Given a step

  @smoke @env:local
  Scenario: skipped on staging
    Given a step

  @smoke @quarantine
  Scenario: quarantined
    Given a step

  @smoke @setup
  Scenario: setup runs before, not beside
    Given a step
`,
      },
    });
    expect(demandOf(config, { tags: '@smoke', setupTags: '@setup' }).get('member')).toBe(1);
  });

  it('a serial file is one unit, and filters only ever lower the count', () => {
    const { config } = workspace({ features: { 'm/members.feature': FOUR_MEMBER_SCENARIOS } });
    expect(demandOf(config, { fullyParallel: false }).get('member')).toBe(1);
    expect(demandOf(config, { includeScenario: (n: string) => n === 'one' }).get('member')).toBe(1);
    expect(demandOf(config, { includeFeature: () => false }).size).toBe(0);
    expect(demandOf(config, { shardTotal: 3 }).get('member')).toBe(1);
    expect(demandOf(config, { repeatEach: 2 }).get('member')).toBe(8);
  });
});

describe('checkPoolCapacity', () => {
  const pool = (extra: Record<string, unknown> = {}) =>
    ({
      dataset: 'users',
      roleColumn: 'role',
      leaseStore: 'file',
      leaseTtlMs: 600_000,
      mode: 'exclusive',
      leaseScope: 'worker',
      ...extra,
    }) as const;
  const accounts = new Map([
    ['member', 1],
    ['admin', 2],
  ]);

  it('flags a role with fewer accounts than the workers that reach it', () => {
    expect(
      checkPoolCapacity({ pool: pool(), accounts, demand: new Map([['member', 4]]), workers: 4 }),
    ).toEqual([{ role: 'member', accounts: 1, concurrent: 4 }]);
  });

  it('does not flag what cannot contend', () => {
    const demand = new Map([
      ['member', 1], // one scenario: one worker at most
      ['admin', 10], // two accounts, two workers
      ['ghost', 3], // no account at all fails at any worker count, not a capacity problem
    ]);
    expect(checkPoolCapacity({ pool: pool(), accounts, demand, workers: 2 })).toEqual([]);
    const busy = new Map([['member', 4]]);
    expect(checkPoolCapacity({ pool: pool(), accounts, demand: busy, workers: 1 })).toEqual([]);
    expect(
      checkPoolCapacity({ pool: pool({ mode: 'shared' }), accounts, demand: busy, workers: 4 }),
    ).toEqual([]);
    expect(
      checkPoolCapacity({
        pool: pool({ leaseScope: 'scenario' }),
        accounts,
        demand: busy,
        workers: 4,
      }),
    ).toEqual([]);
    expect(
      checkPoolCapacity({ pool: pool(), accounts: undefined, demand: busy, workers: 4 }),
    ).toEqual([]);
  });

  it('counts accounts after env.users.poolSize, which slices before roles are split', () => {
    const { config } = workspace({
      users: [
        ['1', 'm1', 'x', 'member'],
        ['2', 'a1', 'x', 'admin'],
        ['3', 'm2', 'x', 'member'],
      ],
      env: 'name: staging\nui:\n  baseUrl: https://example.test\napi:\n  baseUrl: https://api.example.test\nusers:\n  poolSize: 2\n',
    });
    expect([...poolAccountsFor(config)!]).toEqual([
      ['member', 1],
      ['admin', 1],
    ]);
  });

  it('the error names the role, the counts and the ways out, and exits 2', () => {
    const { config } = workspace();
    const e = poolTooSmallError(config, [{ role: 'member', accounts: 1, concurrent: 4 }], 4);
    expect(e.code).toBe('USER_POOL_TOO_SMALL');
    expect(e.exitCode).toBe(2);
    expect(e.message).toContain('role "member" has 1 account(s) but 4 of its scenarios');
    expect(e.message).toContain('4 worker(s)');
    expect(e.hint).toContain('leaseScope: scenario');
    expect(e.hint).toContain('--allow-pool-contention');
  });
});

describe('workers and owners', () => {
  it('effective workers fall back to Playwright’s default, never to 1', () => {
    expect(effectiveWorkers(3)).toBe(3);
    expect(effectiveWorkers()).toBeGreaterThanOrEqual(1);
  });

  it('shard owners do not collide when --workers is left to the default', () => {
    const { config } = workspace();
    const shard2 = { ...config, runtime: { ...config.runtime, shard: { current: 2, total: 2 } } };
    const shard1 = { ...config, runtime: { ...config.runtime, shard: { current: 1, total: 2 } } };
    const n = effectiveWorkers();
    const shard1Owners = new Set(
      Array.from({ length: n }, (_, i) => FileUserPool.ownerFor(shard1, i)),
    );
    for (let i = 0; i < n; i++)
      expect(shard1Owners.has(FileUserPool.ownerFor(shard2, i))).toBe(false);
  });
});

describe('leaseStore', () => {
  it("rejects 'db' with a pointer to #153 instead of silently ignoring it", () => {
    let caught: unknown;
    try {
      workspace({ pool: ['leaseStore: db'] });
    } catch (e) {
      caught = e;
    }
    expect(isSdodsError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('CONFIG_INVALID');
    expect(String((caught as Error).message)).toContain(
      "leaseStore 'db' was never implemented; use 'file' (see #153)",
    );
  });
});

describe('leaseScope: scenario', () => {
  it('waits up to leaseTtlMs by default, and the wait extends the scenario timeout', () => {
    const base = { waitMs: undefined, leaseTtlMs: 90_000 };
    expect(leaseWaitMs({ ...base, leaseScope: 'worker' })).toBe(DEFAULT_LEASE_WAIT_MS);
    expect(leaseWaitMs({ ...base, leaseScope: 'scenario' })).toBe(90_000);
    expect(leaseWaitMs({ ...base, waitMs: 5, leaseScope: 'scenario' })).toBe(5);

    const { config } = workspace({ pool: ['leaseScope: scenario', 'leaseTtlMs: 90000'] });
    const timeouts: number[] = [];
    const info = { timeout: 60_000, setTimeout: (ms: number) => timeouts.push(ms) };
    scenarioLeaseClock(config.project.data.userPool, info).settle();
    expect(timeouts[0]).toBe(150_000);
    expect(timeouts[1]).toBeGreaterThanOrEqual(60_000);
    expect(timeouts[1]).toBeLessThan(61_000);

    const worker = workspace();
    const none: number[] = [];
    scenarioLeaseClock(worker.config.project.data.userPool, {
      timeout: 60_000,
      setTimeout: (ms) => none.push(ms),
    }).settle();
    expect(none).toEqual([]);
  });

  it('waiters are served in arrival order: the releasing worker does not win the account back', async () => {
    const { config, root } = workspace({ pool: ['leaseScope: scenario', 'waitMs: 5000'] });
    const pool = (owner: string) =>
      new FileUserPool(config, new CompositeDataProvider(config), { owner });
    const holder = pool('run-1:0');
    const waiter = pool('run-1:1');
    await holder.lease('member', 0);

    const order: string[] = [];
    const waiting = waiter.lease('member', 1).then(() => order.push('waiter'));
    // let the waiter take its place in line
    await new Promise((r) => setTimeout(r, 100));
    await holder.releaseAll();
    // the holder's next scenario asks immediately; the waiter got there first
    const again = holder.lease('member', 0).then(() => order.push('holder'));
    await waiting;
    await waiter.releaseAll();
    await again;
    await holder.releaseAll();
    expect(order).toEqual(['waiter', 'holder']);
    // tickets are cleaned up
    const queue = join(root, '.sdods', 'leases', 'demo', 'staging', '.queue', 'member');
    expect(readdirSync(queue)).toEqual([]);
  });
});
