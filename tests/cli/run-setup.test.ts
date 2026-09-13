import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `setup: { tags }` end to end through a real Playwright run (#83).
 *
 * A throwaway workspace with one API project: a `@setup` probe and an ordinary scenario. The probe
 * reads GATE_STATE, so one fixture covers both outcomes without a network. Before `setup:` existed
 * the key was silently dropped and the ordinary scenario ran (and passed) next to a failed probe.
 */
const repo = resolve(import.meta.dirname, '..', '..');
const root = join(repo, '.sdods', `test-run-setup-${process.pid}`);

const cli = (env: Record<string, string>, ...args: string[]) =>
  execa('node', ['--import', 'tsx', join(repo, 'packages/cli/src/bin.ts'), ...args], {
    cwd: root,
    reject: false,
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  });

const explain = (r: { exitCode?: number; stdout: string; stderr: string }) =>
  `exit ${r.exitCode}\n--- stdout ---\n${r.stdout.slice(-3000)}\n--- stderr ---\n${r.stderr.slice(-3000)}`;

function write(rel: string, content: string) {
  const file = join(root, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

beforeAll(() => {
  write(
    'sdods.workspace.yaml',
    'organization: { slug: t, name: T }\nworkspaces: [{ slug: default, name: Default }]\ndefaultWorkspace: default\n',
  );
  write('package.json', '{ "private": true, "type": "module" }\n');
  copyFileSync(join(repo, 'sdods.runner.config.ts'), join(root, 'sdods.runner.config.ts'));
  write(
    'projects/gate/sdods.project.yaml',
    [
      'slug: gate',
      'name: Gate',
      'layers: [api]',
      'envs: { default: local, available: [local] }',
      'tags: { extra: [setup] }',
      'setup: { tags: "@setup" }',
      '',
    ].join('\n'),
  );
  write(
    'projects/gate/envs/local.yaml',
    'ui: { baseUrl: http://127.0.0.1:9 }\napi: { baseUrl: http://127.0.0.1:9 }\n',
  );
  write(
    'projects/gate/steps/fixtures.ts',
    "import { test as base, createBdd } from '@sdods/core/fixtures';\nexport const test = base;\nexport const { Given, When, Then } = createBdd(test);\n",
  );
  write(
    'projects/gate/steps/gate.ts',
    [
      "import { Given } from './fixtures.js';",
      "Given('the gate probe answers', async () => {",
      "  if (process.env.GATE_STATE === 'closed') throw new Error('gate probe failed');",
      '});',
      "Given('the real work runs', async () => {});",
      '',
    ].join('\n'),
  );
  write(
    'projects/gate/features/gate/probe.feature',
    'Feature: Probe\n\n  @api @smoke @setup\n  Scenario: gate probe\n    Given the gate probe answers\n',
  );
  write(
    'projects/gate/features/gate/work.feature',
    'Feature: Work\n\n  @api @smoke\n  Scenario: real work\n    Given the real work runs\n',
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

type Totals = { passed: number; failed: number; skipped: number; total: number };
const run = async (gate: 'open' | 'closed') => {
  const r = await cli({ GATE_STATE: gate }, '--json', 'run', '-p', 'gate', '--no-ingest');
  // The runner's own output (code frames included) precedes the JSON document on stdout.
  const body = r.stdout.slice(r.stdout.lastIndexOf('\n{\n') + 1);
  let totals: Totals | undefined;
  try {
    totals = (JSON.parse(body) as { summary?: { totals: Totals } }).summary?.totals;
  } catch {
    totals = undefined;
  }
  return { r, totals };
};

describe('sdods run with setup: { tags } (Playwright project dependencies)', () => {
  it('runs the setup scenario first and the rest once it passes', async () => {
    const { r, totals } = await run('open');
    expect(r.exitCode, explain(r)).toBe(0);
    expect(totals, explain(r)).toMatchObject({ passed: 2, failed: 0, skipped: 0 });
  }, 180_000);

  it('skips the rest when a setup scenario fails', async () => {
    const { r, totals } = await run('closed');
    expect(r.exitCode, explain(r)).not.toBe(0);
    // The probe fails and the ordinary scenario never starts. Playwright reports a test whose
    // dependency failed as "did not run": it has no result, so the SDODS totals hold the probe only.
    expect(totals, explain(r)).toMatchObject({ passed: 0, failed: 1 });
    expect(r.stdout, explain(r)).toMatch(/1 did not run/);
    expect(r.stdout).toMatch(/\[gate--api--setup\].*gate probe/);
    expect(r.stdout).not.toMatch(/✓.*\[gate--api\].*real work/);
  }, 180_000);
});
