import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenarioFiles } from '@sdods/contracts';
import { collectGateEvidence, evaluateGates, hasGates } from '../src/quality/gates.js';
import type { A11yScenarioReport } from '../src/quality/a11y-scenario.js';
import type { PerfScenarioReport } from '../src/quality/perf-scenario.js';

/**
 * Process gates existed in the schema and the web UI for a long time with nothing evaluating them.
 * These tests pin both halves of the fix: a breach fails, and a gate with nothing to judge fails
 * too, because "a11y: true" over a run with no audit is the vacuous green the gates exist to stop.
 */

const totals = (
  over: Partial<Record<'total' | 'passed' | 'failed' | 'skipped' | 'flaky', number>> = {},
) => ({
  total: 10,
  passed: 10,
  failed: 0,
  skipped: 0,
  flaky: 0,
  ...over,
});

const a11y = (over: Partial<A11yScenarioReport> = {}): A11yScenarioReport => ({
  kind: 'a11y-scenario',
  runnerProject: 'shop--ui--chromium',
  fingerprint: '0123456789abcdef',
  retry: 0,
  url: 'https://shop/',
  status: 'audited',
  failOn: 'serious',
  include: [],
  exclude: [],
  violations: 0,
  blocking: 0,
  blockingRules: [],
  ...over,
});

const perf = (over: Partial<PerfScenarioReport> = {}): PerfScenarioReport => ({
  kind: 'perf-scenario',
  runnerProject: 'shop--ui--chromium',
  fingerprint: 'fedcba9876543210',
  retry: 0,
  env: 'staging',
  status: 'judged',
  budgets: { pageLoadMs: 1000 },
  navigations: [],
  unreported: 0,
  api: { liveCalls: 0, replayedFromHar: 0, samples: 0, p95Ms: null },
  judged: 1,
  breaches: [],
  ...over,
});

const none = { a11y: [], perf: [] };

describe('evaluateGates', () => {
  it('passes a run that meets every declared gate', () => {
    const result = evaluateGates({
      process: 'release-gate',
      gates: { minPassRate: 100, maxFlaky: 0, a11y: true, perfBudgets: true },
      totals: totals(),
      evidence: { a11y: [a11y()], perf: [perf()] },
    });
    expect(result.passed).toBe(true);
    expect(result.rows.map((r) => r.gate)).toEqual([
      'minPassRate',
      'maxFlaky',
      'a11y',
      'perfBudgets',
    ]);
  });

  it('computes the pass rate over executed scenarios, counting a flaky pass as a pass', () => {
    const rate = (t: ReturnType<typeof totals>, min: number) =>
      evaluateGates({ process: 'p', gates: { minPassRate: min }, totals: t, evidence: none })
        .rows[0]!;
    // 8 passed + 1 flaky of 10 executed (2 skipped are not executed) = 9/10
    const row = rate(totals({ total: 12, passed: 8, flaky: 1, failed: 1, skipped: 2 }), 90);
    expect(row.passed).toBe(true);
    expect(row.actual).toBe('90% (9/10)');
    // 99.5% is not 100%: no rounding up past a gate
    expect(rate(totals({ total: 200, passed: 199, failed: 1 }), 100).passed).toBe(false);
  });

  it('fails minPassRate when nothing executed, instead of dividing by zero into a pass', () => {
    const row = evaluateGates({
      process: 'p',
      gates: { minPassRate: 0 },
      totals: totals({ total: 3, passed: 0, skipped: 3 }),
      evidence: none,
    }).rows[0]!;
    expect(row.passed).toBe(false);
    expect(row.detail).toContain('no scenario executed');
  });

  it('fails maxFlaky over the limit, and when there are no results to count', () => {
    expect(
      evaluateGates({
        process: 'p',
        gates: { maxFlaky: 0 },
        totals: totals({ flaky: 1 }),
        evidence: none,
      }).passed,
    ).toBe(false);
    expect(
      evaluateGates({ process: 'p', gates: { maxFlaky: 5 }, totals: undefined, evidence: none })
        .passed,
    ).toBe(false);
  });

  it('fails the a11y gate on a blocking violation, and when no audit ran at all', () => {
    const blocked = evaluateGates({
      process: 'p',
      gates: { a11y: true },
      totals: totals(),
      evidence: { a11y: [a11y({ blocking: 2, blockingRules: ['image-alt'] })], perf: [] },
    });
    expect(blocked.passed).toBe(false);
    expect(blocked.rows[0]!.detail).toContain('image-alt');

    const silent = evaluateGates({
      process: 'p',
      gates: { a11y: true },
      totals: totals(),
      evidence: { a11y: [a11y({ status: 'skipped' })], perf: [] },
    });
    expect(silent.passed).toBe(false);
    expect(silent.rows[0]!.detail).toContain('nothing to prove');
  });

  it('counts an audit covered by an explicit step as an audit', () => {
    expect(
      evaluateGates({
        process: 'p',
        gates: { a11y: true },
        totals: totals(),
        evidence: { a11y: [a11y({ status: 'covered-by-step' })], perf: [] },
      }).passed,
    ).toBe(true);
  });

  it('fails the perfBudgets gate on a breach, and when no scenario was judged', () => {
    const breach = {
      budget: 'pageLoadMs',
      limitMs: 1000,
      measuredMs: 1800,
      where: 'https://shop/',
      message: 'slow',
    };
    expect(
      evaluateGates({
        process: 'p',
        gates: { perfBudgets: true },
        totals: totals(),
        evidence: { a11y: [], perf: [perf({ breaches: [breach] })] },
      }).passed,
    ).toBe(false);
    expect(
      evaluateGates({
        process: 'p',
        gates: { perfBudgets: true },
        totals: totals(),
        evidence: { a11y: [], perf: [perf({ judged: 0 })] },
      }).passed,
    ).toBe(false);
  });

  it('evaluates only the gates a process declares', () => {
    expect(hasGates({ perfBudgets: false, a11y: false })).toBe(false);
    expect(hasGates({ minPassRate: 100, perfBudgets: false, a11y: false })).toBe(true);
    expect(
      evaluateGates({ process: 'p', gates: { minPassRate: 50 }, totals: totals(), evidence: none })
        .rows,
    ).toHaveLength(1);
  });
});

describe('collectGateEvidence', () => {
  it('reads the scenario reports from a run directory, keeping the last attempt per runner project', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sdods-gates-'));
    const put = (retry: number, report: A11yScenarioReport | PerfScenarioReport, rel: string) => {
      const file = join(runDir, 'shop', report.fingerprint, `r${retry}`, rel);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify(report));
    };
    put(0, a11y({ retry: 0, blocking: 1 }), scenarioFiles.a11yScenarioJson('shop--ui--chromium'));
    put(1, a11y({ retry: 1, blocking: 0 }), scenarioFiles.a11yScenarioJson('shop--ui--chromium'));
    // same scenario, other browser: its own verdict, not overwritten by chromium's
    put(
      0,
      a11y({ runnerProject: 'shop--ui--firefox', blocking: 3 }),
      scenarioFiles.a11yScenarioJson('shop--ui--firefox'),
    );
    put(0, perf(), scenarioFiles.perfScenarioJson('shop--ui--chromium'));
    // noise the walk must ignore
    mkdirSync(join(runDir, 'html-report', 'data'), { recursive: true });

    const evidence = collectGateEvidence(runDir);
    expect(evidence.a11y.map((r) => `${r.runnerProject}:r${r.retry}:${r.blocking}`).sort()).toEqual(
      ['shop--ui--chromium:r1:0', 'shop--ui--firefox:r0:3'],
    );
    expect(evidence.perf).toHaveLength(1);
  });

  it('returns no evidence for a run directory that does not exist', () => {
    expect(collectGateEvidence(join(tmpdir(), 'sdods-no-such-run'))).toEqual({
      a11y: [],
      perf: [],
    });
  });
});
