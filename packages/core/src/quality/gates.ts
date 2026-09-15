import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentNames } from '@sdods/contracts';
import type {
  GateResult,
  GateRow,
  ProcessConfig,
  ProcessGates,
  RunManifest,
} from '@sdods/contracts';
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
    const reports = evidence.a11y.filter((r) => r.status !== 'skipped');
    // Under `a11y.scope: every-page` one scenario report holds an audit per URL; each is counted.
    const audits = reports.reduce((n, r) => n + auditsIn(r), 0);
    const blocking = reports.reduce((n, r) => n + r.blocking, 0);
    const failing = reports.flatMap((r) =>
      (r.pages ?? [r])
        .filter((p) => p.blocking > 0)
        .map((p) => `${p.url} [${r.runnerProject}]: ${p.blockingRules.join(', ')}`),
    );
    rows.push({
      gate: 'a11y',
      threshold: 'no blocking violation',
      actual: `${blocking} blocking in ${audits} audit(s)`,
      passed: audits > 0 && blocking === 0,
      detail:
        audits === 0
          ? 'no @a11y audit ran in this run, so the gate has nothing to prove'
          : failing.length
            ? failing.slice(0, 5).join('; ')
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

/** Audits one scenario report stands for: one per URL under `every-page`, otherwise one. */
function auditsIn(report: A11yScenarioReport): number {
  if (!report.pages) return 1;
  return report.pages.filter((p) => p.status !== 'not-audited').length;
}

function formatPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Reads the `@a11y` and `@perf` scenario reports out of one or more run directories
 * (`<runDir>/<slug>/<fingerprint>/r<retry>/{a11y,perf}/scenario--<runner project>.json`), keeping
 * only the highest retry of each scenario on each runner project: an attempt that was retried is not
 * the scenario's verdict. Several directories are how the shards of one run are read together: each
 * shard wrote its own scenarios, and the same scenario never ran on two shards.
 */
export function collectGateEvidence(
  runDirs: string | readonly string[],
  /** Reports read from elsewhere (the attachments of a merged report), judged the same way. */
  extra: readonly (A11yScenarioReport | PerfScenarioReport)[] = [],
): GateEvidence {
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
  const dirs = [...new Set(typeof runDirs === 'string' ? [runDirs] : runDirs)];
  for (const file of dirs.flatMap(scenarioReportFiles)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { kind?: string };
      if (parsed.kind === 'a11y-scenario' || parsed.kind === 'perf-scenario')
        keep(parsed as A11yScenarioReport | PerfScenarioReport);
    } catch {
      /* a half-written report is not evidence */
    }
  }
  for (const report of extra) keep(report);
  const values = [...latest.values()];
  return {
    a11y: values.flatMap((v) => (v.a11y ? [v.a11y] : [])),
    perf: values.flatMap((v) => (v.perf ? [v.perf] : [])),
  };
}

/**
 * The `sdods/a11y-scenario` and `sdods/perf-scenario` reports attached to the tests of a runner JSON
 * report. After `playwright merge-reports` their paths point into the directory the blob reports
 * were unpacked into, which lives only as long as the merge, so read them before it is removed. A
 * missing or unreadable file is skipped; the run directories are the other source of the same
 * evidence.
 */
export function gateReportsFromRunnerJson(
  report: unknown,
): (A11yScenarioReport | PerfScenarioReport)[] {
  const names = new Set<string>([attachmentNames.a11yScenario, attachmentNames.perfScenario]);
  const out: (A11yScenarioReport | PerfScenarioReport)[] = [];
  type Suite = {
    suites?: Suite[];
    specs?: { tests?: { results?: { attachments?: { name: string; path?: string }[] }[] }[] }[];
  };
  const walk = (suite: Suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        for (const result of test.results ?? [])
          for (const a of result.attachments ?? []) {
            if (!names.has(a.name) || !a.path || !existsSync(a.path)) continue;
            try {
              const parsed = JSON.parse(readFileSync(a.path, 'utf8')) as { kind?: string };
              if (parsed.kind === 'a11y-scenario' || parsed.kind === 'perf-scenario')
                out.push(parsed as A11yScenarioReport | PerfScenarioReport);
            } catch {
              /* not evidence */
            }
          }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of (report as { suites?: Suite[] } | null)?.suites ?? []) walk(suite);
  return out;
}

/**
 * Gate totals from a runner JSON report's `stats` (what `playwright merge-reports --reporter json`
 * writes for the merged shards). The same counting as the run dashboard: one row per test, retries
 * folded into `flaky`.
 */
export function gateTotalsFromRunnerStats(
  stats: { expected?: number; unexpected?: number; flaky?: number; skipped?: number } | undefined,
): GateTotals | undefined {
  if (!stats) return undefined;
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  return { total: passed + failed + flaky + skipped, passed, failed, skipped, flaky };
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

/**
 * The gate judge ingest runs when a run directory carries no `gates.json`: the process the run's
 * manifest names, over the totals ingest just computed and the evidence in the run directory.
 * `undefined` when there is nothing it may judge: no process, a process without gates, a cancelled
 * run, or one shard of several (a shard is not the run; `sdods report merge --process` judges it).
 */
export function ingestGateJudge(input: {
  manifest: Partial<RunManifest> | null | undefined;
  runDir: string;
  processOf: (slug: string, name: string) => ProcessConfig;
}): ((totals: GateTotals) => GateResult | undefined) | undefined {
  const { manifest, runDir } = input;
  if (!manifest?.process || !manifest.projectSlug) return undefined;
  if ((manifest.shardTotal ?? 1) > 1 || manifest.exitCode === 130) return undefined;
  let proc: ProcessConfig;
  try {
    proc = input.processOf(manifest.projectSlug, manifest.process);
  } catch {
    return undefined; // a process this checkout no longer defines has no gates to judge
  }
  if (!hasGates(proc.gates)) return undefined;
  return (totals) =>
    evaluateGates({
      process: proc.name,
      gates: proc.gates,
      totals,
      evidence: collectGateEvidence(runDir),
    });
}
