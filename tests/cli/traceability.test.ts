import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execa } from 'execa';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  STANDARD_ATTEMPTS,
  writeRun,
  writeTraceRepo,
} from '../../packages/core/test/helpers/traceability-fixture.js';

const root = resolve(import.meta.dirname, '..', '..');
// The repository under test comes from --cwd; an inherited artifacts or projects dir would override it.
const { SDODS_ARTIFACTS_DIR: _a, SDODS_PROJECTS_DIR: _p, ...cleanEnv } = process.env;

/** `sdods report traceability` against a throwaway repository with two recorded runs. */
describe('sdods report traceability', () => {
  let repo: string;
  const cli = (...args: string[]) =>
    execa(
      'node',
      ['--import', 'tsx', join(root, 'packages/cli/src/bin.ts'), '--cwd', repo, ...args],
      {
        cwd: root,
        reject: false,
        extendEnv: false,
        env: { ...cleanEnv, FORCE_COLOR: '0' },
      },
    );

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdods-trace-cli-'));
    writeTraceRepo(repo);
    const runs = join(repo, '.sdods', 'runs');
    // The older run has every scenario of the standard set; the newer one only the passing login.
    writeRun(runs, {
      runId: 'run-old',
      startedAt: '2026-09-01T09:59:00.000Z',
      attempts: STANDARD_ATTEMPTS,
    });
    writeRun(runs, {
      runId: 'run-new',
      startedAt: '2026-09-05T09:59:00.000Z',
      attempts: STANDARD_ATTEMPTS.slice(0, 2),
    });
    writeRun(runs, { runId: 'run-prod', startedAt: '2026-09-06T09:59:00.000Z', env: 'prod' });
  });

  it('--json exports the latest run of the project and environment', async () => {
    const r = await cli('--json', 'report', 'traceability', '-p', 'shop', '-e', 'staging');
    expect(r.exitCode, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.kind).toBe('sdods-traceability');
    expect(report.run.id).toBe('run-new');
    expect(report.summary).toMatchObject({ requirements: 5, notCovered: 1 });
    expect(report.signOff).toEqual({
      signedBy: null,
      role: null,
      date: null,
      decision: null,
      notes: null,
    });
  });

  it('--run after the subcommand selects that run (not the latest)', async () => {
    const r = await cli('--json', 'report', 'traceability', '-p', 'shop', '--run', 'run-old');
    expect(r.exitCode, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.run.id).toBe('run-old');
    expect(report.summary).toMatchObject({ passed: 1, failed: 2, notRun: 1 });
  });

  it('-o writes the format its extension names', async () => {
    const out = join(repo, 'exports', 'trace.html');
    const r = await cli('report', 'traceability', '-p', 'shop', '--run', 'run-old', '-o', out);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain('Wrote html traceability export');
    expect(existsSync(out)).toBe(true);
    const html = readFileSync(out, 'utf8');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('AUTH-2');
    expect(html).toContain('<h2>Sign-off</h2>');
  });

  it('prints Markdown by default and CSV on request', async () => {
    const md = await cli('report', 'traceability', '-p', 'shop', '--run', 'run-old');
    expect(md.exitCode, md.stderr).toBe(0);
    expect(md.stdout).toContain('# Traceability: Shop (shop)');
    expect(md.stdout).toContain('## Sign-off');
    const csv = await cli('report', 'traceability', '-p', 'shop', '--last', '--format', 'csv');
    expect(csv.exitCode, csv.stderr).toBe(0);
    expect(csv.stdout.split('\n')[0]).toMatch(/^requirement_id,requirement_title,/);
  });

  it('fails with exit 2 for an unknown run, a run of another environment, --last with no run, or an unknown format', async () => {
    const missing = await cli('report', 'traceability', '-p', 'shop', '--run', 'nope');
    expect(missing.exitCode).toBe(2);
    const wrongEnv = await cli(
      'report',
      'traceability',
      '-p',
      'shop',
      '-e',
      'prod',
      '--run',
      'run-old',
    );
    expect(wrongEnv.exitCode).toBe(2);
    const none = await cli('report', 'traceability', '-p', 'shop', '-e', 'qa', '--last');
    expect(none.exitCode).toBe(2);
    expect(none.stdout + none.stderr).toContain('No runs of shop on qa');
    const format = await cli('report', 'traceability', '-p', 'shop', '--format', 'xml');
    expect(format.exitCode).toBe(2);
  });

  it('lint accepts the declared ids, including Feature-level ones', async () => {
    const r = await cli('--json', 'lint', '-p', 'shop');
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { errors: Array<{ rule: string }> };
    expect(out.errors).toEqual([]);
  });
});
