import type { RunTotals } from '@automax/contracts/types';
import { enc, nowIso, readBool, readJson, readTs } from '../col.js';
import type { AutomaxDb } from '../create-db.js';
import { bumpLocatorStats, recomputeFlakyStats } from '../repos/improvement.js';
import { emptyTotals } from './types.js';

export interface LocatorCounter {
  fails: number;
  heals: number;
  uses: number;
  lastStrategy?: string | null;
  suggested?: string | null;
}

export interface FinalizeInput {
  adb: AutomaxDb;
  runId: string;
  projectId: string;
  locatorCounters: Map<string, LocatorCounter>;
  runStartedAt?: string | null;
  runFinishedAt?: string | null;
  ingestedFiles: string[];
  exitCode?: number | null;
}

/**
 * Derive scenario outcomes from attempts (count scenarios, not attempts), run totals/status,
 * flaky stats windows and locator stats. Safe to re-run.
 */
export async function finalizeRun(
  input: FinalizeInput,
): Promise<{ totals: RunTotals; status: string }> {
  const { adb, runId, projectId } = input;
  const { db, driver } = adb;
  const scenarios = await db
    .selectFrom('scenarios')
    .selectAll()
    .where('run_id', '=', runId)
    .execute();
  const attempts = await db
    .selectFrom('scenario_attempts')
    .selectAll()
    .where('run_id', '=', runId)
    .execute();
  const heals = await db
    .selectFrom('heal_events')
    .select(['scenario_id'])
    .where('run_id', '=', runId)
    .execute();
  const healedScenarios = new Set(heals.map((h) => h.scenario_id).filter(Boolean));

  const totals = emptyTotals();
  let minStart: number | null = null;
  let maxEnd: number | null = null;
  for (const s of scenarios) {
    const mine = attempts
      .filter((a) => a.scenario_id === s.id)
      .sort((a, b) => a.attempt - b.attempt);
    const last = mine[mine.length - 1];
    const finalStatus = last?.status ?? s.status ?? 'unknown';
    const earlierFailed = mine
      .slice(0, -1)
      .some((a) => a.status === 'failed' || a.status === 'timedOut');
    const flaky = mine.length > 1 && finalStatus === 'passed' && earlierFailed;
    const startedAt = mine[0] ? readTs(mine[0].started_at) : readTs(s.started_at);
    const finishedAt = last ? readTs(last.finished_at) : readTs(s.finished_at);
    await db
      .updateTable('scenarios')
      .set({
        status: finalStatus,
        attempts_count: mine.length,
        flaky: enc.bool(driver, flaky) as number,
        duration_ms: last?.duration_ms ?? s.duration_ms ?? null,
        error_message:
          finalStatus === 'passed' ? null : (last?.error_message ?? s.error_message ?? null),
        error_stack: finalStatus === 'passed' ? null : (last?.error_stack ?? s.error_stack ?? null),
        started_at: startedAt,
        finished_at: finishedAt,
        updated_at: nowIso(),
      })
      .where('id', '=', s.id)
      .execute();
    totals.total++;
    if (flaky) totals.flaky++;
    else if (finalStatus === 'passed') totals.passed++;
    else if (finalStatus === 'failed') totals.failed++;
    else if (finalStatus === 'timedOut') totals.timedOut++;
    else totals.skipped++;
    if (healedScenarios.has(s.id)) totals.healed++;
    if (startedAt)
      minStart =
        minStart === null ? Date.parse(startedAt) : Math.min(minStart, Date.parse(startedAt));
    if (finishedAt)
      maxEnd = maxEnd === null ? Date.parse(finishedAt) : Math.max(maxEnd, Date.parse(finishedAt));
  }
  const started = input.runStartedAt ? Date.parse(input.runStartedAt) : minStart;
  const finished = input.runFinishedAt ? Date.parse(input.runFinishedAt) : maxEnd;
  totals.durationMs =
    started !== null && finished !== null && started !== undefined && finished !== undefined
      ? Math.max(0, finished - started)
      : 0;
  const status =
    totals.failed + totals.timedOut > 0 ? 'failed' : totals.total > 0 ? 'passed' : 'error';

  const existing = await db
    .selectFrom('runs')
    .select(['totals_json'])
    .where('id', '=', runId)
    .executeTakeFirst();
  const prev = readJson<Record<string, unknown>>(existing?.totals_json) ?? {};
  const files = new Set([
    ...(Array.isArray(prev.ingested_files) ? (prev.ingested_files as string[]) : []),
    ...input.ingestedFiles,
  ]);
  await db
    .updateTable('runs')
    .set({
      status,
      totals_json: enc.json({
        ...prev,
        ...totals,
        ingested_files: [...files],
        ingestedAt: nowIso(),
      }),
      shards_ingested: files.size,
      started_at:
        started !== null && started !== undefined ? new Date(started).toISOString() : null,
      finished_at:
        finished !== null && finished !== undefined ? new Date(finished).toISOString() : null,
      duration_ms: totals.durationMs,
      exit_code: input.exitCode ?? (status === 'passed' ? 0 : 1),
      updated_at: nowIso(),
    })
    .where('id', '=', runId)
    .execute();

  // flaky stats over the window for every scenario key touched by this run
  const keys = new Set(scenarios.map((s) => `${s.fingerprint}|${s.pw_project}`));
  for (const key of keys) {
    const [fingerprint, pwProject] = key.split('|') as [string, string];
    await recomputeFlakyStats(db, driver, { projectId, fingerprint, pwProject });
  }
  // locator stats
  for (const [selector, c] of input.locatorCounters) {
    await bumpLocatorStats(db, projectId, {
      selector,
      fails: c.fails,
      heals: c.heals,
      uses: c.uses,
      lastStrategy: c.lastStrategy ?? null,
      suggestedSelector: c.suggested ?? null,
    });
  }
  void readBool;
  return { totals, status };
}
