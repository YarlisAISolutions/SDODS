import { existsSync, readFileSync } from 'node:fs';
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
