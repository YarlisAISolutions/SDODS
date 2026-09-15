import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * #153 through a REAL run: bddgen and Playwright with the repo's runner config and the SDODS
 * fixtures, four workers, four scenarios that lease a `member` and ONE member account.
 *
 * `leaseScope: worker` (the default) is the reported failure: the first worker keeps the account
 * for its whole life and every other worker fails with USER_POOL_EXHAUSTED. `leaseScope: scenario`
 * releases it as each scenario ends, so the same run passes with the scenarios queued behind the
 * one account — and the queue wait is added to the scenario timeout (`@timeout:15000`, less than
 * the last scenario in line waits) instead of failing it.
 *
 * API layer only, leasing through `I use a leased user with role "member" for API calls`, so no
 * browser is launched. (The `@user:` tag leases through the `user` fixture, which pulls in
 * `storageState` and with it a browser; both paths are released by the same fixture.)
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const require_ = createRequire(import.meta.url);
const pwCli = join(dirname(require_.resolve('@playwright/test/package.json')), 'cli.js');
const bddgen = join(dirname(require_.resolve('playwright-bdd/package.json')), 'dist/cli/index.js');
const runnerConfig = join(repoRoot, 'sdods.runner.config.ts');

mkdirSync(join(repoRoot, '.sdods'), { recursive: true });
const workspaces: string[] = [];
afterAll(() => {
  for (const ws of workspaces) rmSync(ws, { recursive: true, force: true });
});

const scenario = (name: string) => `  Scenario: ${name}
    Given I use a leased user with role "member" for API calls
    Then the probe holds the leased account
`;
const FEATURE = `@api @regression @timeout:15000
Feature: One member account

${['first', 'second', 'third', 'fourth'].map(scenario).join('\n')}`;

const PROBE_STEPS = `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBdd } from '@sdods/core/fixtures';
import { test } from './fixtures';

const { Then } = createBdd(test);

Then('the probe holds the leased account', async ({ apiContext }) => {
  const user = { username: apiContext.vars.toObject().username };
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 5000));
  const info = test.info();
  writeFileSync(
    join(process.env.PROBE_OUT!, info.title + '.json'),
    JSON.stringify({ user: user?.username, start, end: Date.now(), worker: info.parallelIndex, timeout: info.timeout }),
  );
});
`;

interface Outcome {
  statuses: Record<string, string>;
  report: string;
  probes: Array<{ user: string; start: number; end: number; worker: number; timeout: number }>;
  output: string;
}

function runWith(leaseScope: 'worker' | 'scenario'): Outcome {
  const ws = mkdtempSync(join(repoRoot, '.sdods', `test-lease-${leaseScope}-`));
  workspaces.push(ws);
  const proj = join(ws, 'projects', 'shop');
  const out = join(ws, 'probe');
  for (const d of ['envs', 'features', 'steps', 'data'])
    mkdirSync(join(proj, d), { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(ws, 'package.json'), '{ "private": true, "type": "module" }');
  writeFileSync(
    join(proj, 'sdods.project.yaml'),
    [
      'slug: shop',
      'name: Shop',
      'layers: [api]',
      'browsers: [chromium]',
      'envs: { default: local, available: [local] }',
      'data:',
      '  sources:',
      '    users: { type: csv, path: data/users.csv }',
      '  userPool:',
      '    dataset: users',
      // worker scope keeps the reported 1s-ish failure quick; scenario scope uses the defaults
      ...(leaseScope === 'worker' ? ['    waitMs: 1000'] : ['    leaseScope: scenario']),
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(proj, 'envs', 'local.yaml'),
    'ui: { baseUrl: "http://127.0.0.1:9" }\napi: { baseUrl: "http://127.0.0.1:9" }\n',
  );
  writeFileSync(join(proj, 'data', 'users.csv'), 'id,username,password,role\n1,member1,x,member\n');
  writeFileSync(join(proj, 'features', 'members.feature'), FEATURE);
  writeFileSync(
    join(proj, 'steps', 'fixtures.ts'),
    "export { test, createBdd } from '@sdods/core/fixtures';\n",
  );
  writeFileSync(join(proj, 'steps', 'probe.steps.ts'), PROBE_STEPS);

  const env = {
    ...process.env,
    CI: '',
    FORCE_COLOR: '0',
    SDODS_ROOT: ws,
    SDODS_PROJECT: 'shop',
    SDODS_ENV: 'local',
    SDODS_LAYERS: 'api',
    SDODS_BROWSERS: '',
    SDODS_RUN_ID: `lease-${leaseScope}`,
    SDODS_TAGS: '',
    PROBE_OUT: out,
  };
  const gen = spawnSync(process.execPath, [bddgen, '-c', runnerConfig], {
    cwd: ws,
    env,
    encoding: 'utf8',
  });
  expect(gen.status, gen.stdout + gen.stderr).toBe(0);
  const json = join(ws, 'results.json');
  const args = ['test', '-c', runnerConfig, '--reporter', 'json', '--workers', '4'];
  args.push('--retries', '0');
  const run = spawnSync(process.execPath, [pwCli, ...args], {
    cwd: ws,
    env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: json },
    encoding: 'utf8',
  });
  const output = (run.stdout + run.stderr).slice(-6000);
  expect(existsSync(json), output).toBe(true);
  const report = readFileSync(json, 'utf8');
  const statuses: Record<string, string> = {};
  const walk = (s: any) => {
    for (const spec of s.specs ?? [])
      for (const t of spec.tests) statuses[spec.title] = t.results.at(-1)?.status ?? 'none';
    for (const c of s.suites ?? []) walk(c);
  };
  for (const s of JSON.parse(report).suites) walk(s);
  const probes = readdirSync(out).map((f) => JSON.parse(readFileSync(join(out, f), 'utf8')));
  return { statuses, report, probes, output };
}

describe('#153 — leaseScope through a real four-worker run with one account', () => {
  it('leaseScope: worker starves the other workers (the reported failure)', () => {
    const r = runWith('worker');
    expect(Object.keys(r.statuses).sort(), r.output).toEqual([
      'first',
      'fourth',
      'second',
      'third',
    ]);
    const failed = Object.values(r.statuses).filter((s) => s !== 'passed');
    expect(failed.length, r.output).toBeGreaterThan(0);
    expect(r.report).toContain('USER_POOL_EXHAUSTED');
  }, 300_000);

  it('leaseScope: scenario releases between scenarios, so every one passes', () => {
    const r = runWith('scenario');
    expect(r.statuses, r.output).toEqual({
      first: 'passed',
      second: 'passed',
      third: 'passed',
      fourth: 'passed',
    });
    expect(r.report.match(/USER_POOL_EXHAUSTED/g) ?? []).toHaveLength(0);
    // Really parallel, really one account, and never held by two scenarios at once.
    expect(new Set(r.probes.map((p) => p.worker)).size).toBeGreaterThan(1);
    expect(new Set(r.probes.map((p) => p.user))).toEqual(new Set(['member1']));
    const spans = [...r.probes].sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
    // Someone queued, and the wait was added to the 15s @timeout rather than taken out of it: the
    // timeout is settled to 15000 + the time spent waiting for the account.
    expect(Math.max(...r.probes.map((p) => p.timeout))).toBeGreaterThan(15_000 + 500);
    expect(Math.min(...r.probes.map((p) => p.timeout))).toBeGreaterThanOrEqual(15_000);
  }, 300_000);
});
