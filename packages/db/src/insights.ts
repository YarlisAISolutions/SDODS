import { sql, type Kysely } from 'kysely';
import { readBool } from './col.js';
import type { Database } from './schema.js';

export interface InsightsOptions {
  projectSlug: string;
  /** number of most recent runs to consider (default 30) */
  window?: number;
  /** thresholds */
  flakyThreshold?: number;
  fragilityThreshold?: number;
  minRuns?: number;
}

export interface ScenarioInsight {
  fingerprint: string;
  runnerProject: string;
  featureUri: string;
  scenarioName: string;
  module: string | null;
  runs: number;
  passed: number;
  failed: number;
  flaky: number;
  /** (passed_on_retry + outcome flips) / runs */
  flakinessScore: number;
  p95DurationMs: number | null;
  medianDurationMs: number | null;
  instability: number | null;
  quarantineCandidate: boolean;
}

export interface LocatorInsight {
  selector: string;
  pageHint: string | null;
  fails: number;
  heals: number;
  uses: number;
  fragility: number;
  hot: boolean;
  suggestedSelector: string | null;
}

export interface EnvInsight {
  env: string;
  runs: number;
  envAttributedFailures: number;
  stability: number;
}

export interface Insights {
  projectSlug: string;
  window: number;
  runsConsidered: number;
  passRate: number;
  scenarios: ScenarioInsight[];
  locators: LocatorInsight[];
  envs: EnvInsight[];
  suiteHealth: number;
  suiteHealthTrend: number[];
  computedAt: string;
}

const ENV_ERROR =
  /(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|net::ERR_|502|503|504|Timeout .* exceeded|navigation timeout)/i;

/**
 * Deterministic metrics over the last `window` runs of a project. Pure reads; results are
 * returned (and written by the CLI into `flaky_stats` / `locator_stats` when asked).
 */
export async function computeInsights(
  db: Kysely<Database>,
  opts: InsightsOptions,
): Promise<Insights> {
  const window = opts.window ?? 30;
  const flakyThreshold = opts.flakyThreshold ?? 0.2;
  const fragilityThreshold = opts.fragilityThreshold ?? 0.1;
  const minRuns = opts.minRuns ?? 10;

  const project = await db
    .selectFrom('projects')
    .select(['id'])
    .where('slug', '=', opts.projectSlug)
    .executeTakeFirst();
  if (!project) throw new Error(`Unknown project ${opts.projectSlug}`);

  const runs = await db
    .selectFrom('runs')
    .select(['id', 'env_name', 'status', 'totals_json', 'created_at', 'started_at'])
    .where('project_id', '=', project.id)
    .where('status', 'in', ['passed', 'failed'])
    .orderBy(sql`coalesce(started_at, created_at)`, 'desc')
    .limit(window)
    .execute();
  const runIds = runs.map((r) => r.id);
  const runOrder = new Map(runIds.map((id, i) => [id, i]));

  const scenarios = runIds.length
    ? await db
        .selectFrom('scenarios')
        .select([
          'run_id',
          'fingerprint',
          'runner_project',
          'feature_uri',
          'scenario_name',
          'module',
          'status',
          'flaky',
          'duration_ms',
          'error_message',
        ])
        .where('run_id', 'in', runIds)
        .execute()
    : [];

  // ── scenario flakiness ────────────────────────────────────────────────
  const groups = new Map<string, typeof scenarios>();
  for (const s of scenarios) {
    const key = `${s.fingerprint}|${s.runner_project}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  const scenarioInsights: ScenarioInsight[] = [];
  for (const list of groups.values()) {
    const ordered = [...list]
      .sort((a, b) => (runOrder.get(a.run_id) ?? 0) - (runOrder.get(b.run_id) ?? 0))
      .reverse(); // oldest → newest
    const runsN = ordered.length;
    const passed = ordered.filter((s) => s.status === 'passed' && !readBool(s.flaky)).length;
    const failed = ordered.filter((s) => s.status === 'failed' || s.status === 'timedOut').length;
    const flakyRetries = ordered.filter((s) => readBool(s.flaky)).length;
    let flips = 0;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]!.status === 'passed';
      const cur = ordered[i]!.status === 'passed';
      if (prev !== cur) flips++;
    }
    const flakinessScore = runsN ? round((flakyRetries + flips) / runsN) : 0;
    const durations = ordered
      .map((s) => s.duration_ms)
      .filter((d): d is number => typeof d === 'number' && d > 0)
      .sort((a, b) => a - b);
    const median = durations.length ? durations[Math.floor(durations.length / 2)]! : null;
    const p95 = durations.length
      ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]!
      : null;
    const last = ordered[ordered.length - 1]!;
    scenarioInsights.push({
      fingerprint: last.fingerprint,
      runnerProject: last.runner_project,
      featureUri: last.feature_uri,
      scenarioName: last.scenario_name,
      module: last.module ?? null,
      runs: runsN,
      passed,
      failed,
      flaky: flakyRetries,
      flakinessScore,
      p95DurationMs: p95,
      medianDurationMs: median,
      instability: median && p95 ? round(p95 / median) : null,
      quarantineCandidate: runsN >= minRuns && flakinessScore >= flakyThreshold,
    });
  }
  scenarioInsights.sort((a, b) => b.flakinessScore - a.flakinessScore || b.failed - a.failed);

  // ── locator fragility ─────────────────────────────────────────────────
  const locatorRows = await db
    .selectFrom('locator_stats')
    .selectAll()
    .where('project_id', '=', project.id)
    .execute();
  const locators: LocatorInsight[] = locatorRows
    .map((l) => {
      const uses = Math.max(l.use_count, l.fail_count + l.heal_count, 1);
      const fragility = round((l.fail_count + 0.5 * l.heal_count) / uses);
      return {
        selector: l.selector,
        pageHint: l.page_hint,
        fails: l.fail_count,
        heals: l.heal_count,
        uses: l.use_count,
        fragility,
        hot: fragility >= fragilityThreshold && l.heal_count >= 3,
        suggestedSelector: l.suggested_selector,
      };
    })
    .sort((a, b) => b.fragility - a.fragility);

  // ── env stability ─────────────────────────────────────────────────────
  const envMap = new Map<string, { runs: number; envFails: number }>();
  for (const r of runs) {
    const e = envMap.get(r.env_name) ?? { runs: 0, envFails: 0 };
    e.runs++;
    const failedHere = scenarios.filter(
      (s) => s.run_id === r.id && (s.status === 'failed' || s.status === 'timedOut'),
    );
    const envLike = failedHere.filter((s) => s.error_message && ENV_ERROR.test(s.error_message));
    const distinct = new Set(envLike.map((s) => s.fingerprint)).size;
    if (distinct >= 3) e.envFails++;
    envMap.set(r.env_name, e);
  }
  const envs: EnvInsight[] = [...envMap.entries()].map(([env, e]) => ({
    env,
    runs: e.runs,
    envAttributedFailures: e.envFails,
    stability: e.runs ? round(1 - e.envFails / e.runs) : 1,
  }));

  // ── suite health ──────────────────────────────────────────────────────
  const perRunPass = runs.map((r) => {
    const list = scenarios.filter((s) => s.run_id === r.id);
    if (!list.length) return null;
    return list.filter((s) => s.status === 'passed').length / list.length;
  });
  const validPass = perRunPass.filter((p): p is number => p !== null);
  const passRate = validPass.length
    ? round(validPass.reduce((a, b) => a + b, 0) / validPass.length)
    : 0;
  const meanFlaky = scenarioInsights.length
    ? scenarioInsights.reduce((a, s) => a + s.flakinessScore, 0) / scenarioInsights.length
    : 0;
  const meanFragility = locators.length
    ? locators.reduce((a, l) => a + l.fragility, 0) / locators.length
    : 0;
  const durationCompliance = 1; // duration budgets are evaluated by the runtime; placeholder keeps the formula stable
  const suiteHealth = round(
    0.5 * passRate +
      0.2 * (1 - meanFlaky) +
      0.2 * (1 - Math.min(1, meanFragility)) +
      0.1 * durationCompliance,
  );
  const trend: number[] = [];
  const chronological = [...validPass].reverse();
  for (let i = 0; i < chronological.length; i++) {
    const slice = chronological.slice(Math.max(0, i - 6), i + 1);
    trend.push(round(slice.reduce((a, b) => a + b, 0) / slice.length));
  }

  return {
    projectSlug: opts.projectSlug,
    window,
    runsConsidered: runs.length,
    passRate,
    scenarios: scenarioInsights,
    locators,
    envs,
    suiteHealth,
    suiteHealthTrend: trend,
    computedAt: new Date().toISOString(),
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
