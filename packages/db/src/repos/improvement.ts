import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { HealEvent } from '@sdods/contracts/types';
import { enc, nowIso, readBool, readJson, readTs } from '../col.js';
import type { Driver } from '../driver.js';
import { newId } from '../ids.js';
import type { Database } from '../schema.js';

export async function insertHealEvent(
  db: Kysely<Database>,
  driver: Driver,
  input: {
    projectId: string;
    runId: string;
    scenarioId?: string | null;
    attemptId?: string | null;
    stepId?: string | null;
    event: HealEvent;
    source?: 'runtime' | 'agent';
  },
): Promise<string> {
  const id = newId();
  const e = input.event;
  await db
    .insertInto('heal_events')
    .values({
      id,
      project_id: input.projectId,
      run_id: input.runId,
      scenario_id: input.scenarioId ?? null,
      attempt_id: input.attemptId ?? null,
      step_id: input.stepId ?? null,
      page_url: e.pageUrl ?? null,
      original_selector: e.originalSelector,
      context_json: enc.json(e.context ?? {}),
      strategy_used: e.strategyUsed ?? null,
      healed_selector: e.healedSelector ?? null,
      candidates_json: enc.json(e.candidates ?? []),
      succeeded: enc.bool(driver, e.succeeded) as number,
      duration_ms: e.durationMs ?? null,
      source: input.source ?? 'runtime',
      accepted: null,
      accepted_by: null,
      created_at: e.at ?? nowIso(),
    })
    .execute();
  return id;
}

export interface LocatorDelta {
  selector: string;
  pageHint?: string | null;
  fails?: number;
  heals?: number;
  uses?: number;
  lastStrategy?: string | null;
  suggestedSelector?: string | null;
  at?: string;
}

/** Increment counters for one selector (upsert on project_id + selector). */
export async function bumpLocatorStats(
  db: Kysely<Database>,
  projectId: string,
  d: LocatorDelta,
): Promise<void> {
  const at = d.at ?? nowIso();
  const existing = await db
    .selectFrom('locator_stats')
    .select(['id'])
    .where('project_id', '=', projectId)
    .where('selector', '=', d.selector)
    .executeTakeFirst();
  const fails = d.fails ?? 0;
  const heals = d.heals ?? 0;
  const uses = d.uses ?? 0;
  if (existing) {
    await db
      .updateTable('locator_stats')
      .set((eb) => ({
        fail_count: eb('fail_count', '+', fails),
        heal_count: eb('heal_count', '+', heals),
        use_count: eb('use_count', '+', uses),
        ...(fails > 0 ? { last_failed_at: at } : {}),
        ...(heals > 0 ? { last_healed_at: at } : {}),
        ...(d.lastStrategy ? { last_strategy: d.lastStrategy } : {}),
        ...(d.suggestedSelector ? { suggested_selector: d.suggestedSelector } : {}),
        ...(d.pageHint ? { page_hint: d.pageHint } : {}),
        updated_at: at,
      }))
      .where('id', '=', existing.id)
      .execute();
    return;
  }
  await db
    .insertInto('locator_stats')
    .values({
      id: newId(),
      project_id: projectId,
      selector: d.selector,
      page_hint: d.pageHint ?? null,
      fail_count: fails,
      heal_count: heals,
      use_count: uses,
      last_failed_at: fails > 0 ? at : null,
      last_healed_at: heals > 0 ? at : null,
      last_strategy: d.lastStrategy ?? null,
      suggested_selector: d.suggestedSelector ?? null,
      updated_at: at,
    })
    .execute();
}

export async function listLocatorStats(db: Kysely<Database>, projectId: string, limit = 50) {
  const rows = await db
    .selectFrom('locator_stats')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('fail_count', 'desc')
    .orderBy('heal_count', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    selector: r.selector,
    pageHint: r.page_hint,
    failCount: r.fail_count,
    healCount: r.heal_count,
    useCount: r.use_count,
    lastFailedAt: readTs(r.last_failed_at),
    lastHealedAt: readTs(r.last_healed_at),
    lastStrategy: r.last_strategy,
    suggestedSelector: r.suggested_selector,
  }));
}

export async function listHealEvents(
  db: Kysely<Database>,
  opts: { projectId?: string; runId?: string; limit?: number },
) {
  let q = db
    .selectFrom('heal_events')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 100);
  if (opts.projectId) q = q.where('project_id', '=', opts.projectId);
  if (opts.runId) q = q.where('run_id', '=', opts.runId);
  const rows = await q.execute();
  return rows.map((h) => ({
    id: h.id,
    runId: h.run_id,
    scenarioId: h.scenario_id,
    pageUrl: h.page_url,
    originalSelector: h.original_selector,
    context: readJson<Record<string, unknown>>(h.context_json) ?? {},
    strategyUsed: h.strategy_used,
    healedSelector: h.healed_selector,
    candidates: readJson<unknown[]>(h.candidates_json) ?? [],
    succeeded: readBool(h.succeeded),
    durationMs: h.duration_ms,
    createdAt: readTs(h.created_at),
  }));
}

/**
 * Recompute flaky stats for one (project, fingerprint, runner_project) over the last `window` runs.
 */
export async function recomputeFlakyStats(
  db: Kysely<Database>,
  driver: Driver,
  input: { projectId: string; fingerprint: string; runnerProject: string; window?: number },
): Promise<void> {
  const window = input.window ?? 20;
  const rows = await db
    .selectFrom('scenarios')
    .innerJoin('runs', 'runs.id', 'scenarios.run_id')
    .select([
      'scenarios.status as status',
      'scenarios.flaky as flaky',
      'scenarios.run_id as run_id',
      'scenarios.feature_uri as feature_uri',
      'scenarios.scenario_name as scenario_name',
      'scenarios.finished_at as finished_at',
      'runs.started_at as run_started_at',
      'runs.created_at as run_created_at',
    ])
    .where('scenarios.project_id', '=', input.projectId)
    .where('scenarios.fingerprint', '=', input.fingerprint)
    .where('scenarios.runner_project', '=', input.runnerProject)
    .orderBy(sql`coalesce(runs.started_at, runs.created_at)`, 'desc')
    .limit(window)
    .execute();
  if (rows.length === 0) return;
  const runsCount = rows.length;
  const passCount = rows.filter((r) => r.status === 'passed' && !readBool(r.flaky)).length;
  const failCount = rows.filter((r) => r.status === 'failed' || r.status === 'timedOut').length;
  const flakyCount = rows.filter((r) => readBool(r.flaky)).length;
  const flakyRate = (flakyCount + failCount) / runsCount;
  let failStreak = 0;
  for (const r of rows) {
    if (r.status === 'failed' || r.status === 'timedOut') failStreak++;
    else break;
  }
  const last = rows[0]!;
  const lastFailed = rows.find((r) => r.status === 'failed' || r.status === 'timedOut');
  const existing = await db
    .selectFrom('flaky_stats')
    .select(['id'])
    .where('project_id', '=', input.projectId)
    .where('fingerprint', '=', input.fingerprint)
    .where('runner_project', '=', input.runnerProject)
    .executeTakeFirst();
  const values = {
    feature_uri: last.feature_uri,
    scenario_name: last.scenario_name,
    window_size: window,
    runs_count: runsCount,
    pass_count: passCount,
    fail_count: failCount,
    flaky_count: flakyCount,
    flaky_rate: Number(flakyRate.toFixed(4)),
    fail_streak: failStreak,
    last_status: last.status,
    last_run_id: last.run_id,
    last_failed_at: lastFailed ? readTs(lastFailed.finished_at) : null,
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('flaky_stats').set(values).where('id', '=', existing.id).execute();
  } else {
    await db
      .insertInto('flaky_stats')
      .values({
        id: newId(),
        project_id: input.projectId,
        fingerprint: input.fingerprint,
        runner_project: input.runnerProject,
        quarantined: enc.bool(driver, false) as number,
        ...values,
      })
      .execute();
  }
}

export async function listFlakyStats(db: Kysely<Database>, projectId: string, limit = 50) {
  const rows = await db
    .selectFrom('flaky_stats')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('flaky_rate', 'desc')
    .orderBy('fail_streak', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    fingerprint: r.fingerprint,
    runnerProject: r.runner_project,
    featureUri: r.feature_uri,
    scenarioName: r.scenario_name,
    windowSize: r.window_size,
    runsCount: r.runs_count,
    passCount: r.pass_count,
    failCount: r.fail_count,
    flakyCount: r.flaky_count,
    flakyRate: Number(r.flaky_rate),
    failStreak: r.fail_streak,
    lastStatus: r.last_status,
    lastRunId: r.last_run_id,
    lastFailedAt: readTs(r.last_failed_at),
    quarantined: readBool(r.quarantined),
  }));
}

export async function setQuarantine(
  db: Kysely<Database>,
  driver: Driver,
  id: string,
  quarantined: boolean,
) {
  await db
    .updateTable('flaky_stats')
    .set({ quarantined: enc.bool(driver, quarantined) as number, updated_at: nowIso() })
    .where('id', '=', id)
    .execute();
}
