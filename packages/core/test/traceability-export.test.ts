import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  buildTraceabilityReport,
  latestRunFor,
  loadRequirements,
  readRunResults,
} from '../src/analyze/traceability.js';
import { renderTraceability } from '../src/analyze/traceability-render.js';
import {
  PROJECT_YAML,
  STANDARD_ATTEMPTS,
  writeRun,
  writeTraceRepo,
} from './helpers/traceability-fixture.js';

const NOW = new Date('2026-09-02T08:00:00.000Z');

function fixture(projectYaml?: string) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-trace-'));
  const repo = writeTraceRepo(root, projectYaml);
  const runs = join(root, '.sdods', 'runs');
  return { ...repo, runs };
}

async function standardReport() {
  const f = fixture();
  const dir = writeRun(f.runs, {
    runId: 'run-1',
    startedAt: '2026-09-01T09:59:00.000Z',
    attempts: STANDARD_ATTEMPTS,
  });
  return buildTraceabilityReport({ project: f.project, run: { runId: 'run-1', dir }, now: NOW });
}

describe('traceability export', () => {
  it('matches the golden JSON', async () => {
    const report = await standardReport();
    await expect(renderTraceability(report, 'json')).toMatchFileSnapshot(
      './__golden__/traceability.json',
    );
  });

  it('matches the golden Markdown', async () => {
    const report = await standardReport();
    await expect(renderTraceability(report, 'md')).toMatchFileSnapshot(
      './__golden__/traceability.md',
    );
  });

  it('computes requirement status from every covering scenario', async () => {
    const report = await standardReport();
    const status = Object.fromEntries(report.requirements.map((r) => [r.id, r.status]));
    expect(status).toEqual({
      'AUTH-1': 'failed', // Feature-level tag: Valid login passed, Locked user failed on firefox
      'AUTH-2': 'failed',
      'ORD-1': 'passed',
      'ORD-2': 'not-run',
      'PAY-1': 'not-covered',
    });
    expect(report.summary).toEqual({
      requirements: 5,
      covered: 4,
      passed: 1,
      failed: 2,
      notRun: 1,
      notCovered: 1,
      undeclared: 0,
      scenarios: 5,
      tracedScenarios: 4,
      untracedScenarios: 1,
    });
    const locked = report.requirements
      .find((r) => r.id === 'AUTH-2')!
      .scenarios[0]!.results.map((r) => [r.runnerProject, r.status, r.attempts, r.flaky]);
    expect(locked).toEqual([
      ['shop--ui--chromium', 'passed', 2, true],
      ['shop--ui--firefox', 'failed', 1, false],
    ]);
    expect(report.requirements[0]!.url).toBe('https://jira.example.com/browse/AUTH-1');
  });

  it('never fills in the sign-off block, even with CI and git data on the run', async () => {
    const report = await standardReport();
    expect(report.run?.git?.sha).toBeTruthy();
    expect(report.run?.ci?.url).toBeTruthy();
    expect(report.signOff).toEqual({
      signedBy: null,
      role: null,
      date: null,
      decision: null,
      notes: null,
    });
    const csv = renderTraceability(report, 'csv');
    const signOff = csv.split('\n\n')[1]!;
    expect(parseCsv(signOff, { columns: true })).toEqual([
      { sign_off: 'signedBy', value: '' },
      { sign_off: 'role', value: '' },
      { sign_off: 'date', value: '' },
      { sign_off: 'decision', value: '' },
      { sign_off: 'notes', value: '' },
    ]);
    const html = renderTraceability(report, 'html');
    expect(html).toContain('<h2>Sign-off</h2>');
    expect(html.match(/<td class="blank"><\/td>/g)).toHaveLength(5);
  });

  it('writes one CSV row per requirement × scenario × result', async () => {
    const report = await standardReport();
    const table = renderTraceability(report, 'csv').split('\n\n')[0]!;
    const rows = parseCsv(table, { columns: true }) as Array<Record<string, string>>;
    // AUTH-1: 2 scenarios × 2 browsers; AUTH-2: 2; ORD-1: 2 example rows; ORD-2: no result; PAY-1: none
    expect(rows.map((r) => r.requirement_id)).toEqual([
      'AUTH-1',
      'AUTH-1',
      'AUTH-1',
      'AUTH-1',
      'AUTH-2',
      'AUTH-2',
      'ORD-1',
      'ORD-1',
      'ORD-2',
      'PAY-1',
    ]);
    expect(rows[5]).toMatchObject({
      scenario: 'Locked user',
      browser: 'firefox',
      result_status: 'failed',
      git_sha: '0123456789abcdef0123456789abcdef01234567',
    });
  });

  it('escapes scenario text in HTML', async () => {
    const f = fixture();
    const report = await buildTraceabilityReport({ project: f.project, now: NOW });
    report.requirements[0]!.title = '<script>alert(1)</script>';
    report.requirements[0]!.url = 'javascript:alert(1)';
    const html = renderTraceability(report, 'html');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('href="javascript:');
  });

  it('without a run, every scenario is not run and the matrix is still complete', async () => {
    const f = fixture();
    const report = await buildTraceabilityReport({ project: f.project, now: NOW });
    expect(report.run).toBeNull();
    expect(report.requirements.map((r) => r.status)).toEqual([
      'not-run',
      'not-run',
      'not-run',
      'not-run',
      'not-covered',
    ]);
    expect(report.notes[0]).toMatch(/No run selected/);
  });

  it('lists tagged ids missing from the requirements file as undeclared, never drops them', async () => {
    const f = fixture();
    writeFileSync(
      join(f.projectRoot, 'features', 'api', 'extra.feature'),
      `@api\nFeature: Extra\n\n  @smoke @req:LEGACY-9\n  Scenario: Old\n    Given x\n`,
    );
    const report = await buildTraceabilityReport({ project: f.project, now: NOW });
    const legacy = report.requirements.find((r) => r.id === 'LEGACY-9');
    expect(legacy).toMatchObject({ declared: false, status: 'not-run' });
    expect(report.summary.undeclared).toBe(1);
  });

  it('without a requirements file, not-covered is unknown rather than zero', async () => {
    const f = fixture(PROJECT_YAML.replace(/traceability:[\s\S]*$/, ''));
    const report = await buildTraceabilityReport({ project: f.project, now: NOW });
    expect(report.summary.notCovered).toBeNull();
    expect(report.requirements.map((r) => [r.id, r.declared])).toEqual([
      ['AUTH-1', null],
      ['AUTH-2', null],
      ['ORD-1', null],
      ['ORD-2', null],
    ]);
  });

  it('a passing after-hook does not turn skipped steps into a pass; a failing one fails', async () => {
    const f = fixture();
    const base = {
      feature: 'features/auth/login.feature',
      start: '2026-09-01T10:00:00.000Z',
      durationMs: 100,
    };
    const dir = writeRun(f.runs, {
      runId: 'run-hooks',
      startedAt: '2026-09-01T09:59:00.000Z',
      attempts: [
        // @skip:webkit-style: every Gherkin step skipped, the finalize hook still passes.
        {
          ...base,
          runnerProject: 'shop--ui--webkit',
          scenario: 'Valid login',
          status: 'SKIPPED',
          afterHook: 'PASSED',
        },
        {
          ...base,
          runnerProject: 'shop--ui--chromium',
          scenario: 'Locked user',
          status: 'PASSED',
          afterHook: 'FAILED',
        },
      ],
    });
    const report = await buildTraceabilityReport({
      project: f.project,
      run: { runId: 'run-hooks', dir },
      now: NOW,
    });
    const auth1 = report.requirements.find((r) => r.id === 'AUTH-1')!;
    expect(auth1.scenarios.map((s) => [s.name, s.status])).toEqual([
      ['Valid login', 'skipped'],
      ['Locked user', 'failed'],
    ]);
    expect(report.requirements.find((r) => r.id === 'AUTH-2')!.status).toBe('failed');
  });

  it('a requirement whose only scenario was skipped is not run, not passed', async () => {
    const f = fixture();
    const dir = writeRun(f.runs, {
      runId: 'run-skip',
      startedAt: '2026-09-01T09:59:00.000Z',
      attempts: [
        {
          runnerProject: 'shop--api',
          feature: 'features/api/orders.feature',
          scenario: 'Cancel order',
          status: 'SKIPPED',
          afterHook: 'PASSED',
          start: '2026-09-01T10:00:00.000Z',
          durationMs: 0,
        },
      ],
    });
    const report = await buildTraceabilityReport({
      project: f.project,
      run: { runId: 'run-skip', dir },
      now: NOW,
    });
    expect(report.requirements.find((r) => r.id === 'ORD-2')!.status).toBe('not-run');
  });

  it('falls back to per-scenario meta.json when a run has no messages, latest attempt wins', async () => {
    const f = fixture();
    const dir = writeRun(f.runs, { runId: 'run-meta', startedAt: '2026-09-01T09:00:00.000Z' });
    const meta = (retry: number, status: string) => {
      const d = join(dir, 'shop', 'abc123', `r${retry}`);
      mkdirSync(d, { recursive: true });
      writeFileSync(
        join(d, 'meta.json'),
        JSON.stringify({
          runnerProject: 'shop--api',
          featureUri: 'features/api/orders.feature',
          scenarioName: 'Cancel order',
          pickleLine: 16,
          exampleIndex: null,
          retry,
          status,
          durationMs: 10 + retry,
          startedAt: '2026-09-01T09:00:01.000Z',
        }),
      );
    };
    meta(0, 'failed');
    meta(1, 'passed');
    const results = await readRunResults(dir);
    expect(results.source).toBe('scenario-meta');
    const report = await buildTraceabilityReport({
      project: f.project,
      run: { runId: 'run-meta', dir },
      now: NOW,
    });
    const ord2 = report.requirements.find((r) => r.id === 'ORD-2')!;
    expect(ord2.status).toBe('passed');
    expect(ord2.scenarios[0]!.results[0]).toMatchObject({
      status: 'passed',
      attempts: 2,
      flaky: true,
      durationMs: 11,
    });
    expect(report.run?.resultsSource).toBe('scenario-meta');
  });

  it('latestRunFor picks the newest run of the project and environment', () => {
    const f = fixture();
    writeRun(f.runs, { runId: 'a', startedAt: '2026-09-01T10:00:00.000Z' });
    writeRun(f.runs, { runId: 'b', startedAt: '2026-09-03T10:00:00.000Z', env: 'prod' });
    writeRun(f.runs, { runId: 'c', startedAt: '2026-09-04T10:00:00.000Z', project: 'other' });
    writeRun(f.runs, { runId: 'd', startedAt: '2026-09-02T10:00:00.000Z' });
    expect(latestRunFor(f.runs, 'shop')?.runId).toBe('b');
    expect(latestRunFor(f.runs, 'shop', 'staging')?.runId).toBe('d');
    expect(latestRunFor(f.runs, 'shop', 'qa')).toBeNull();
    expect(latestRunFor(join(f.root, 'missing'), 'shop')).toBeNull();
  });

  it('loads requirements from a YAML map and a CSV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdods-reqs-'));
    writeFileSync(join(dir, 'r.yaml'), 'REQ-1: One\nREQ-2:\n  title: Two\n');
    writeFileSync(join(dir, 'r.csv'), '﻿id,title\nREQ-1,"One, with comma"\nREQ-1,dup\n');
    expect(loadRequirements(join(dir, 'r.yaml'))).toEqual([
      { id: 'REQ-1', title: 'One' },
      { id: 'REQ-2', title: 'Two' },
    ]);
    expect(loadRequirements(join(dir, 'r.csv'))).toEqual([
      { id: 'REQ-1', title: 'One, with comma' },
    ]);
    writeFileSync(join(dir, 'bad.csv'), 'key,title\nREQ-1,One\n');
    expect(() => loadRequirements(join(dir, 'bad.csv'))).toThrow(/no "id" column/);
  });
});
