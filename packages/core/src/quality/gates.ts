import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GateResult, GateRow, ProcessGates } from '@sdods/contracts';
import type { A11yScenarioReport } from './a11y-scenario.js';
import type { PerfScenarioReport } from './perf-scenario.js';

export type { GateResult, GateRow };

/**
 * Process gates: `gates:` on a process in `sdods.project.yaml`.
 *
 * Until this existed the web UI saved `minPassRate`, `maxFlaky`, `a11y` and `perfBudgets`, the
 * release process declared all four, and nothing anywhere evaluated them. A gate that is read by
 * nothing is worse than no gate: it is the reason a release goes out believing it was checked.
 *
 * Evaluated by `sdods run --process <name>` from the run it just finished:
 *   · `minPassRate` — (passed + flaky) / (total − skipped), as a percentage, the same arithmetic as
 *     the run dashboard. A scenario that passed only on retry counts as passed here and as flaky
 *     below. A run that executed nothing has no pass rate, and fails the gate.
 *   · `maxFlaky` — scenarios that failed and then passed on a retry.
 *   · `a11y` — every `@a11y` audit in the run found nothing at or above `a11y.failOn`, AND at least
 *     one audit ran. Violations already fail their scenarios; what this gate adds is the proof that
 *     the audits happened at all, because a process declaring `a11y: true` over a selection with no
 *     `@a11y` scenario would otherwise pass having checked nothing.
 *   · `perfBudgets` — the same for `@perf`: no breach in any judged scenario, and at least one
 *     scenario was judged.
 *
 * The a11y and perf evidence is read from the scenario reports the tag hooks write into the run
 * directory, taking the last attempt of each scenario on each runner project.
 */

export interface GateTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface GateEvidence {
  a11y: A11yScenarioReport[];
  perf: PerfScenarioReport[];
}

/** True when the process declares at least one gate worth evaluating. */
export function hasGates(gates: Partial<ProcessGates> | undefined): boolean {
  return Boolean(
    gates &&
    (gates.minPassRate !== undefined ||
      gates.maxFlaky !== undefined ||
      gates.a11y === true ||
      gates.perfBudgets === true),
  );
}

/** Pure: the verdict for one process's gates over a run's totals and evidence. */
export function evaluateGates(input: {
  process: string;
  gates: Partial<ProcessGates> | undefined;
  totals: GateTotals | undefined;
  evidence: GateEvidence;
}): GateResult {
  const { gates = {}, totals, evidence } = input;
  const rows: GateRow[] = [];

  if (gates.minPassRate !== undefined) {
    const executed = totals ? totals.total - totals.skipped : 0;
    if (!totals || executed <= 0) {
      rows.push({
        gate: 'minPassRate',
        threshold: `≥ ${gates.minPassRate}%`,
        actual: 'n/a',
        passed: false,
        detail: totals
          ? 'no scenario executed, so there is no pass rate to meet the gate'
          : 'the run produced no results to compute a pass rate from',
      });
    } else {
      const rate = ((totals.passed + totals.flaky) / executed) * 100;
      rows.push({
        gate: 'minPassRate',
        threshold: `≥ ${gates.minPassRate}%`,
        actual: `${formatPct(rate)}% (${totals.passed + totals.flaky}/${executed})`,
        passed: rate >= gates.minPassRate,
      });
    }
  }

  if (gates.maxFlaky !== undefined) {
    rows.push({
      gate: 'maxFlaky',
      threshold: `≤ ${gates.maxFlaky}`,
      actual: totals ? String(totals.flaky) : 'n/a',
      passed: Boolean(totals) && (totals?.flaky ?? 0) <= gates.maxFlaky,
      detail: totals ? undefined : 'the run produced no results to count flaky scenarios from',
    });
  }

  if (gates.a11y) {
    const audited = evidence.a11y.filter((r) => r.status !== 'skipped');
    const blocking = audited.reduce((n, r) => n + r.blocking, 0);
    const failing = audited.filter((r) => r.blocking > 0);
    rows.push({
      gate: 'a11y',
      threshold: 'no blocking violation',
      actual: `${blocking} blocking in ${audited.length} audit(s)`,
      passed: audited.length > 0 && blocking === 0,
      detail:
        audited.length === 0
          ? 'no @a11y audit ran in this run, so the gate has nothing to prove'
          : failing.length
            ? failing
                .slice(0, 5)
                .map((r) => `${r.url} [${r.runnerProject}]: ${r.blockingRules.join(', ')}`)
                .join('; ')
            : undefined,
    });
  }

  if (gates.perfBudgets) {
    const judged = evidence.perf.filter((r) => r.status === 'judged' && r.judged > 0);
    const breaches = judged.flatMap((r) =>
      r.breaches.map((b) => ({ ...b, runnerProject: r.runnerProject })),
    );
    rows.push({
      gate: 'perfBudgets',
      threshold: 'no budget breach',
      actual: `${breaches.length} breach(es) in ${judged.length} scenario(s)`,
      passed: judged.length > 0 && breaches.length === 0,
      detail:
        judged.length === 0
          ? 'no @perf scenario was judged against a budget in this run, so the gate has nothing to prove'
          : breaches.length
            ? breaches
                .slice(0, 5)
                .map(
                  (b) =>
                    `${b.budget} ${b.measuredMs ?? 'unmeasured'}/${b.limitMs} ms at ${b.where}`,
                )
                .join('; ')
            : undefined,
    });
  }

  return { process: input.process, passed: rows.every((r) => r.passed), rows };
}

function formatPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Reads the `@a11y` and `@perf` scenario reports out of a run directory
 * (`<runDir>/<slug>/<fingerprint>/r<retry>/{a11y,perf}/scenario--<runner project>.json`), keeping
 * only the highest retry of each scenario on each runner project: an attempt that was retried is not
 * the scenario's verdict.
 */
export function collectGateEvidence(runDir: string): GateEvidence {
  const latest = new Map<
    string,
    { retry: number; a11y?: A11yScenarioReport; perf?: PerfScenarioReport }
  >();
  const keep = (report: A11yScenarioReport | PerfScenarioReport) => {
    const key = `${report.kind}|${report.fingerprint}|${report.runnerProject}`;
    const prev = latest.get(key);
    if (prev && prev.retry > report.retry) return;
    latest.set(
      key,
      report.kind === 'a11y-scenario'
        ? { retry: report.retry, a11y: report }
        : { retry: report.retry, perf: report },
    );
  };
  for (const file of scenarioReportFiles(runDir)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { kind?: string };
      if (parsed.kind === 'a11y-scenario' || parsed.kind === 'perf-scenario')
        keep(parsed as A11yScenarioReport | PerfScenarioReport);
    } catch {
      /* a half-written report is not evidence */
    }
  }
  const values = [...latest.values()];
  return {
    a11y: values.flatMap((v) => (v.a11y ? [v.a11y] : [])),
    perf: values.flatMap((v) => (v.perf ? [v.perf] : [])),
  };
}

function scenarioReportFiles(runDir: string): string[] {
  const out: string[] = [];
  const dirs = (p: string) =>
    existsSync(p) ? readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()) : [];
  for (const slug of dirs(runDir)) {
    // Fingerprints are 16 hex characters; this keeps the walk out of the report directories.
    for (const fp of dirs(join(runDir, slug)).filter((n) => /^[0-9a-f]{16}$/.test(n))) {
      for (const attempt of dirs(join(runDir, slug, fp))) {
        if (!/^r\d+$/.test(attempt)) continue;
        for (const kind of ['a11y', 'perf']) {
          const dir = join(runDir, slug, fp, attempt, kind);
          if (!existsSync(dir)) continue;
          for (const name of readdirSync(dir))
            if (name.startsWith('scenario--') && name.endsWith('.json')) out.push(join(dir, name));
        }
      }
    }
  }
  return out;
}
