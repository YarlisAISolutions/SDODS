import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
/** In CI the demo runs offline from the committed HAR fixtures (projects/demo-shop/har). */
const harFlags = process.env.CI ? ['--har-replay', '--strict'] : [];
const explain = (r: { exitCode?: number; stdout: string; stderr: string }) =>
  r.exitCode === 0
    ? ''
    : `exit ${r.exitCode}\n--- stdout ---\n${r.stdout.slice(-3000)}\n--- stderr ---\n${r.stderr.slice(-3000)}`;

const cli = (...args: string[]) =>
  execa('node', ['--import', 'tsx', 'packages/cli/src/bin.ts', ...args], {
    cwd: root,
    reject: false,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

describe('sdods CLI (end to end against projects/demo-shop)', () => {
  it('project list --json describes the demo project', async () => {
    const r = await cli('--json', 'project', 'list');
    expect(r.exitCode).toBe(0);
    const rows = JSON.parse(r.stdout) as Array<{ slug: string; layers: string; browsers: string }>;
    const demo = rows.find((x) => x.slug === 'demo-shop');
    expect(demo).toBeDefined();
    expect(demo!.layers).toContain('api');
    expect(demo!.browsers).toContain('chromium');
  });

  it('lint passes for the demo project and reports JSON', async () => {
    const r = await cli('--json', 'lint', '-p', 'demo-shop');
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; errors: unknown[]; filesChecked: number };
    expect(out.ok).toBe(true);
    expect(out.errors).toHaveLength(0);
    expect(out.filesChecked).toBeGreaterThan(5);
  });

  it('lint fails on a scenario without a layer tag', async () => {
    const r = await cli(
      '--json',
      'lint',
      '-p',
      'demo-shop',
      '--file',
      join(root, 'tests', 'cli', 'fixtures', 'bad-tags.feature'),
    );
    expect(r.exitCode).toBe(3);
    const out = JSON.parse(r.stdout) as { errors: Array<{ rule: string }> };
    expect(out.errors.map((e) => e.rule)).toContain('tags/layer');
  });

  it('run --list prints only the api project for -l api', async () => {
    const r = await cli('run', '-p', 'demo-shop', '-e', 'staging', '-l', 'api', '--list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('demo-shop--api');
    expect(r.stdout).not.toContain('demo-shop--ui');
    expect(r.stdout).toContain('posts.feature.spec.js');
  });

  it('run -l api --json produces a summary and run artifacts', async () => {
    const r = await cli(
      '--json',
      'run',
      '-p',
      'demo-shop',
      '-e',
      'staging',
      '-l',
      'api',
      '-t',
      '@smoke',
      ...harFlags,
    );
    expect(r.exitCode, explain(r)).toBe(0);
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as {
      runId: string;
      runDir: string;
      summary: { totals: { passed: number; failed: number } };
      manifest: { process?: string };
      notify?: { ran: boolean; reason?: string };
    };
    // demo-shop keeps its integrations disabled, so the run reports why it did not notify (#81)
    expect(out.notify).toEqual({ ran: false, reason: 'no integration enabled' });
    expect(out.summary.totals.failed).toBe(0);
    expect(out.summary.totals.passed).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(out.runDir, 'run.json'))).toBe(true);
    expect(existsSync(join(out.runDir, 'messages.ndjson'))).toBe(true);
    expect(existsSync(join(out.runDir, 'dashboard', 'index.html'))).toBe(true);
    const ndjson = readFileSync(join(out.runDir, 'messages.ndjson'), 'utf8');
    expect((ndjson.match(/"testCase"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('run --process resolves the recipe and records it in run.json', async () => {
    const r = await cli(
      '--json',
      'run',
      '-p',
      'demo-shop',
      '-e',
      'staging',
      '--process',
      'api-contract',
      ...harFlags,
    );
    expect(r.exitCode, explain(r)).toBe(0);
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as {
      manifest: { process?: string; tagsExpr?: string };
    };
    expect(out.manifest.process).toBe('api-contract');
    expect(out.manifest.tagsExpr).toBe('@contract or @smoke');
  }, 120_000);

  /**
   * A selection that matches nothing used to exit 0, which reads exactly like a green run: a typo in
   * `--tags` or `--feature` kept CI passing while running no tests at all.
   */
  it('fails a run whose selection matches no scenario, unless --allow-empty', async () => {
    const base = ['run', '-p', 'demo-shop', '-e', 'staging', '-l', 'api', '--no-ingest'];
    const empty = await cli(...base, '-t', '@no-such-tag', ...harFlags);
    expect(empty.exitCode, explain(empty)).toBe(2);
    expect(empty.stdout + empty.stderr).toMatch(/No scenarios matched/);
    const allowed = await cli(...base, '-t', '@no-such-tag', '--allow-empty', ...harFlags);
    expect(allowed.exitCode, explain(allowed)).toBe(0);
  }, 120_000);

  it('rejects a malformed tag expression before generating specs', async () => {
    const r = await cli(
      'run',
      '-p',
      'demo-shop',
      '-e',
      'staging',
      '-l',
      'api',
      '-t',
      '@smoke and (',
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/tag expression/i);
    expect(r.stderr + r.stdout).not.toMatch(/^\s+at .+:\d+:\d+/m);
  });

  it('rejects a --feature that does not exist', async () => {
    const r = await cli(
      'run',
      '-p',
      'demo-shop',
      '-e',
      'staging',
      '--feature',
      'nope/missing.feature',
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/missing\.feature/);
  });

  it('features list evaluates boolean tag expressions', async () => {
    const r = await cli(
      '--json',
      'features',
      'list',
      '-p',
      'demo-shop',
      '--scenarios',
      '--tags',
      '@ui and @smoke',
    );
    expect(r.exitCode, explain(r)).toBe(0);
    const rows = JSON.parse(r.stdout) as Array<{ tags: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.tags).toMatch(/@smoke/);
    const bad = await cli('features', 'list', '-p', 'demo-shop', '--tags', '@smoke and (');
    expect(bad.exitCode).toBe(2);
  });

  it('rejects an unknown layer with a config error', async () => {
    const r = await cli('run', '-p', 'demo-shop', '-l', 'mobile');
    expect(r.exitCode).toBe(2);
  });

  it('features list shows modules', async () => {
    const r = await cli('--json', 'features', 'list', '-p', 'demo-shop');
    expect(r.exitCode).toBe(0);
    const rows = JSON.parse(r.stdout) as Array<{ feature: string; module: string }>;
    expect(rows.find((x) => x.feature === 'features/api/posts.feature')?.module).toBe('posts-api');
    expect(rows.find((x) => x.feature === 'features/auth/login.feature')?.module).toBe('auth');
  });

  it('refuses -b edge with an install hint when Edge is absent', async () => {
    // Without this preflight the first sign of a missing channel browser is Playwright's own
    // launch error inside worker output, which names a channel the user never typed. Skipped where
    // Edge IS installed, so the suite is honest on a machine that can really run it.
    const { browserStatuses } = await import('../../packages/cli/src/commands/browsers.js');
    const [edge] = await browserStatuses(['edge']);
    if (edge?.installed) return;
    const r = await cli(
      'run',
      '-p',
      'demo-shop',
      '-e',
      'staging',
      '-l',
      'ui',
      '-b',
      'edge',
      '-t',
      '@smoke',
    );
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/edge is not installed/);
    expect(`${r.stdout}${r.stderr}`).toMatch(/sdods browsers install -b edge/);
  });
});

/**
 * #153: one `member` account and four `@user:member` scenarios at --workers 4 used to start, then
 * fail three workers' scenarios 30s in with USER_POOL_EXHAUSTED. It now stops before any spec is
 * generated, names the role and the counts, and exits 2.
 */
describe('sdods run refuses a user pool too small for its workers (#153)', () => {
  const workspace = (poolExtra: readonly string[] = []) => {
    const ws = mkdtempSync(join(tmpdir(), 'sdods-pool-run-'));
    const proj = join(ws, 'projects', 'shop');
    mkdirSync(join(proj, 'envs'), { recursive: true });
    mkdirSync(join(proj, 'features', 'members'), { recursive: true });
    mkdirSync(join(proj, 'data'), { recursive: true });
    writeFileSync(
      join(ws, 'sdods.workspace.yaml'),
      'organization:\n  slug: t\n  name: T\nworkspaces:\n  - slug: default\n    name: D\n    organization: t\ndefaultWorkspace: default\n',
    );
    writeFileSync(
      join(proj, 'sdods.project.yaml'),
      [
        'slug: shop',
        'name: Shop',
        'organization: t',
        'workspace: default',
        'layers: [api]',
        'envs: { default: staging, available: [staging] }',
        'data:',
        '  sources:',
        '    users: { type: csv, path: data/users.csv }',
        '  userPool:',
        '    dataset: users',
        ...poolExtra.map((l) => `    ${l}`),
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(proj, 'envs', 'staging.yaml'),
      'ui: { baseUrl: "https://example.test" }\napi: { baseUrl: "https://api.example.test" }\n',
    );
    writeFileSync(join(proj, 'data', 'users.csv'), 'id,username,password,role\n1,m1,x,member\n');
    writeFileSync(
      join(proj, 'features', 'members', 'members.feature'),
      `@api @regression @user:member\nFeature: Members\n\n${['one', 'two', 'three', 'four']
        .map((n) => `  Scenario: ${n}\n    Given I load dataset "users" row 0\n`)
        .join('\n')}`,
    );
    return ws;
  };
  const runIn = (ws: string, ...args: string[]) =>
    execa('node', ['--import', 'tsx', 'packages/cli/src/bin.ts', '--cwd', ws, 'run', ...args], {
      cwd: root,
      reject: false,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

  it('exits 2 with USER_POOL_TOO_SMALL, naming the role, the accounts and the workers', async () => {
    const ws = workspace();
    try {
      const r = await runIn(ws, '-p', 'shop', '-e', 'staging', '-l', 'api', '--workers', '4');
      const text = `${r.stdout}${r.stderr}`;
      expect(r.exitCode, text).toBe(2);
      expect(text).toContain('USER_POOL_TOO_SMALL');
      expect(text).toContain('role "member" has 1 account(s) but 4 of its scenarios');
      expect(text).toContain('4 worker(s)');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 120_000);

  it('does not refuse what cannot starve: one worker, leaseScope: scenario, mode: shared', async () => {
    const cases: Array<[string[], string[]]> = [
      [[], ['--workers', '1']],
      [['leaseScope: scenario'], ['--workers', '4']],
      [['mode: shared'], ['--workers', '4']],
    ];
    for (const [extra, args] of cases) {
      const ws = workspace(extra);
      try {
        // The workspace has no runner config, so a run that gets past the pool check stops at
        // CONFIG_NOT_FOUND, which comes after it.
        const r = await runIn(ws, '-p', 'shop', '-e', 'staging', '-l', 'api', ...args);
        const text = `${r.stdout}${r.stderr}`;
        expect(text, text).not.toContain('USER_POOL_TOO_SMALL');
        expect(text, text).toContain('No runner config');
      } finally {
        rmSync(ws, { recursive: true, force: true });
      }
    }
  }, 180_000);

  it('rejects leaseStore: db as a config error that points at #153', async () => {
    const ws = workspace(['leaseStore: db']);
    try {
      const r = await runIn(ws, '-p', 'shop', '-e', 'staging', '-l', 'api');
      const text = `${r.stdout}${r.stderr}`;
      expect(r.exitCode, text).toBe(2);
      expect(text).toContain("leaseStore 'db' was never implemented; use 'file' (see #153)");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 120_000);
});
