import type { Kysely } from 'kysely';
import type { RunRecord, RunTotals } from '@sdods/contracts/types';
import { enc, nowIso, readBool, readJson, readTs } from '../col.js';
import type { Driver } from '../driver.js';
import { newId } from '../ids.js';
import { gateResultOf } from '../ingest/finalize.js';
import type { Database } from '../schema.js';

export interface RunUpsert {
  id: string;
  projectId: string;
  workspaceId?: string | null;
  environmentId?: string | null;
  envName: string;
  process?: string | null;
  trigger?: string;
  status?: string;
  suiteTag?: string | null;
  tagsExpr?: string | null;
  layers?: string[];
  browsers?: string[];
  shardTotal?: number | null;
  gitSha?: string | null;
  gitBranch?: string | null;
  ciProvider?: string | null;
  ciRunId?: string | null;
  ciUrl?: string | null;
  startedBy?: string | null;
  command?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  totals?: Record<string, unknown>;
  artifactsDir?: string | null;
  htmlReportRel?: string | null;
  exitCode?: number | null;
  errorText?: string | null;
  /** The selection a server-started run was launched with, for Rerun. */
  params?: Record<string, unknown>;
}

export async function upsertRun(
  db: Kysely<Database>,
  _driver: Driver,
  r: RunUpsert,
): Promise<void> {
  const existing = await db
    .selectFrom('runs')
    .select(['id', 'totals_json'])
    .where('id', '=', r.id)
    .executeTakeFirst();
  const base = {
    project_id: r.projectId,
    environment_id: r.environmentId ?? null,
    env_name: r.envName,
    updated_at: nowIso(),
  };
  const optional = stripUndefined({
    workspace_id: r.workspaceId,
    process: r.process,
    trigger: r.trigger,
    status: r.status,
    suite_tag: r.suiteTag,
    tags_expr: r.tagsExpr,
    layers_json: r.layers ? enc.json(r.layers) : undefined,
    browsers_json: r.browsers ? enc.json(r.browsers) : undefined,
    shard_total: r.shardTotal,
    git_sha: r.gitSha,
    git_branch: r.gitBranch,
    ci_provider: r.ciProvider,
    ci_run_id: r.ciRunId,
    ci_url: r.ciUrl,
    started_by: r.startedBy,
    command: r.command,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
    duration_ms: r.durationMs,
    totals_json: r.totals ? enc.json(r.totals) : undefined,
    artifacts_dir: r.artifactsDir,
    html_report_rel: r.htmlReportRel,
    exit_code: r.exitCode,
    error_text: r.errorText,
    params_json: r.params ? enc.json(r.params) : undefined,
  });
  if (existing) {
    await db
      .updateTable('runs')
      .set({ ...base, ...optional } as any)
      .where('id', '=', r.id)
      .execute();
    return;
  }
  await db
    .insertInto('runs')
    .values({
      id: r.id,
      created_at: nowIso(),
      trigger: r.trigger ?? 'cli',
      status: r.status ?? 'queued',
      layers_json: enc.json(r.layers ?? []),
      browsers_json: enc.json(r.browsers ?? []),
      shards_ingested: 0,
      totals_json: enc.json(r.totals ?? {}),
      ...base,
      ...optional,
    } as any)
    .execute();
}

export async function getRun(
  db: Kysely<Database>,
  id: string,
): Promise<(RunRecord & { projectId: string; totalsRaw: Record<string, unknown> }) | null> {
  const row = await db
    .selectFrom('runs')
    .innerJoin('projects', 'projects.id', 'runs.project_id')
    .selectAll('runs')
    .select('projects.slug as project_slug')
    .where('runs.id', '=', id)
    .executeTakeFirst();
  return row ? mapRun(row) : null;
}

export async function listRuns(
  db: Kysely<Database>,
  opts: {
    projectSlug?: string;
    status?: string;
    env?: string;
    limit?: number;
    before?: string;
  } = {},
) {
  let q = db
    .selectFrom('runs')
    .innerJoin('projects', 'projects.id', 'runs.project_id')
    .selectAll('runs')
    .select('projects.slug as project_slug')
    .orderBy('runs.created_at', 'desc')
    .limit(opts.limit ?? 50);
  if (opts.projectSlug) q = q.where('projects.slug', '=', opts.projectSlug);
  if (opts.status) q = q.where('runs.status', '=', opts.status);
  if (opts.env) q = q.where('runs.env_name', '=', opts.env);
  if (opts.before) q = q.where('runs.created_at', '<', opts.before);
  const rows = await q.execute();
  return rows.map(mapRun);
}

export function mapRun(
  row: any,
): RunRecord & { projectId: string; totalsRaw: Record<string, unknown> } {
  const totalsRaw = readJson<Record<string, unknown>>(row.totals_json) ?? {};
  const totals = totalsRaw.total !== undefined ? (totalsRaw as unknown as RunTotals) : undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    workspaceId: row.workspace_id ?? null,
    process: row.process ?? undefined,
    env: row.env_name,
    trigger: row.trigger,
    status: row.status,
    suiteTag: row.suite_tag ?? undefined,
    tagsExpr: row.tags_expr ?? undefined,
    layers: readJson<string[]>(row.layers_json) ?? [],
    browsers: readJson<string[]>(row.browsers_json) ?? [],
    gitSha: row.git_sha ?? undefined,
    gitBranch: row.git_branch ?? undefined,
    ciProvider: row.ci_provider ?? undefined,
    ciRunId: row.ci_run_id ?? undefined,
    ciUrl: row.ci_url ?? undefined,
    startedAt: readTs(row.started_at) ?? undefined,
    finishedAt: readTs(row.finished_at) ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    totals,
    gates: gateResultOf(totalsRaw.gates),
    totalsRaw,
    artifactsDir: row.artifacts_dir ?? undefined,
    exitCode: row.exit_code ?? undefined,
    errorText: row.error_text ?? undefined,
  } as RunRecord & { projectId: string; totalsRaw: Record<string, unknown> };
}

/**
 * What a run was started with, for Rerun: the stored selection when the server started it, else
 * the parts the row always records. `null` when the run does not exist.
 */
export async function getRunParams(
  db: Kysely<Database>,
  id: string,
): Promise<{ project: string; params: Record<string, unknown> } | null> {
  const row = await db
    .selectFrom('runs')
    .innerJoin('projects', 'projects.id', 'runs.project_id')
    .select([
      'projects.slug as project_slug',
      'runs.params_json',
      'runs.env_name',
      'runs.process',
      'runs.tags_expr',
      'runs.layers_json',
      'runs.browsers_json',
    ])
    .where('runs.id', '=', id)
    .executeTakeFirst();
  if (!row) return null;
  const stored = readJson<Record<string, unknown>>(row.params_json);
  if (stored) return { project: row.project_slug, params: stored };
  const layers = readJson<string[]>(row.layers_json) ?? [];
  const browsers = readJson<string[]>(row.browsers_json) ?? [];
  return {
    project: row.project_slug,
    params: stripUndefined({
      env: row.env_name || undefined,
      process: row.process ?? undefined,
      tags: row.tags_expr ?? undefined,
      layers: layers.length ? layers : undefined,
      browsers: browsers.length ? browsers : undefined,
    }),
  };
}

/** Names of the scenarios that failed in a run, deduplicated (a scenario can run per browser). */
export async function getFailedScenarioNames(
  db: Kysely<Database>,
  runId: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom('scenarios')
    .select('scenario_name')
    .where('run_id', '=', runId)
    .where('status', 'in', ['failed', 'timedOut', 'interrupted'])
    .execute();
  return [...new Set(rows.map((r) => r.scenario_name))];
}

export async function deleteRunChildren(db: Kysely<Database>, runId: string): Promise<void> {
  // FK cascades handle steps/attempts/artifacts/heal_events; delete explicitly for engines without FK enforcement.
  await db.deleteFrom('heal_events').where('run_id', '=', runId).execute();
  await db.deleteFrom('artifacts').where('run_id', '=', runId).execute();
  await db.deleteFrom('steps').where('run_id', '=', runId).execute();
  await db.deleteFrom('scenario_attempts').where('run_id', '=', runId).execute();
  await db.deleteFrom('scenarios').where('run_id', '=', runId).execute();
}

export async function deleteRun(db: Kysely<Database>, runId: string): Promise<void> {
  await deleteRunChildren(db, runId);
  await db.deleteFrom('runs').where('id', '=', runId).execute();
}

/** Scenario tree for a run: scenarios with their attempts (no steps). */
export async function getRunScenarios(db: Kysely<Database>, runId: string) {
  const scenarios = await db
    .selectFrom('scenarios')
    .selectAll()
    .where('run_id', '=', runId)
    .orderBy('feature_uri')
    .orderBy('scenario_name')
    .execute();
  const attempts = await db
    .selectFrom('scenario_attempts')
    .selectAll()
    .where('run_id', '=', runId)
    .orderBy('attempt')
    .execute();
  const byScenario = new Map<string, any[]>();
  for (const a of attempts) {
    const list = byScenario.get(a.scenario_id) ?? [];
    list.push(mapAttempt(a));
    byScenario.set(a.scenario_id, list);
  }
  return scenarios.map((s) => ({ ...mapScenario(s), attempts: byScenario.get(s.id) ?? [] }));
}

/** One scenario with steps and artifacts grouped by attempt. */
export async function getScenarioDetail(db: Kysely<Database>, scenarioId: string) {
  const scenario = await db
    .selectFrom('scenarios')
    .selectAll()
    .where('id', '=', scenarioId)
    .executeTakeFirst();
  if (!scenario) return null;
  const attempts = await db
    .selectFrom('scenario_attempts')
    .selectAll()
    .where('scenario_id', '=', scenarioId)
    .orderBy('attempt')
    .execute();
  const steps = await db
    .selectFrom('steps')
    .selectAll()
    .where('scenario_id', '=', scenarioId)
    .orderBy('step_index')
    .execute();
  const artifacts = await db
    .selectFrom('artifacts')
    .selectAll()
    .where('scenario_id', '=', scenarioId)
    .execute();
  const heals = await db
    .selectFrom('heal_events')
    .selectAll()
    .where('scenario_id', '=', scenarioId)
    .execute();
  return {
    ...mapScenario(scenario),
    attempts: attempts.map((a) => ({
      ...mapAttempt(a),
      steps: steps.filter((s) => s.attempt_id === a.id).map(mapStep),
      artifacts: artifacts.filter((x) => x.attempt_id === a.id).map(mapArtifact),
      heals: heals.filter((h) => h.attempt_id === a.id).map(mapHeal),
    })),
  };
}

export function mapScenario(s: any) {
  return {
    id: s.id,
    runId: s.run_id,
    projectId: s.project_id,
    naturalKey: s.natural_key,
    fingerprint: s.fingerprint,
    source: s.source,
    featureUri: s.feature_uri,
    featureName: s.feature_name,
    scenarioName: s.scenario_name,
    module: s.module ?? null,
    exampleIndex: s.examples_row,
    runnerProject: s.runner_project,
    layer: s.layer,
    browser: s.browser,
    suiteTag: s.suite_tag,
    tags: readJson<string[]>(s.tags_json) ?? [],
    jiraKeys: readJson<string[]>(s.jira_keys_json) ?? [],
    status: s.status,
    attemptsCount: s.attempts_count,
    flaky: readBool(s.flaky),
    durationMs: s.duration_ms,
    errorMessage: s.error_message,
    errorStack: s.error_stack,
    startedAt: readTs(s.started_at),
    finishedAt: readTs(s.finished_at),
  };
}

export function mapAttempt(a: any) {
  return {
    id: a.id,
    scenarioId: a.scenario_id,
    attempt: a.attempt,
    testCaseStartedId: a.test_case_started_id,
    status: a.status,
    durationMs: a.duration_ms,
    errorMessage: a.error_message,
    errorStack: a.error_stack,
    willBeRetried: readBool(a.will_be_retried),
    workerIndex: a.worker_index,
    startedAt: readTs(a.started_at),
    finishedAt: readTs(a.finished_at),
  };
}

export function mapStep(s: any) {
  return {
    id: s.id,
    attemptId: s.attempt_id,
    scenarioId: s.scenario_id,
    runId: s.run_id,
    stepIndex: s.step_index,
    kind: s.kind,
    hookType: s.hook_type,
    keyword: s.keyword,
    text: s.text,
    argument: readJson(s.argument_json),
    status: s.status,
    durationMs: s.duration_ms,
    errorMessage: s.error_message,
    errorStack: s.error_stack,
    definitionLocation: s.definition_location,
    layerHint: s.layer_hint,
    apiSnapshot: readJson(s.api_snapshot_json),
    perf: readJson(s.perf_json),
    startedAt: readTs(s.started_at),
    finishedAt: readTs(s.finished_at),
  };
}

export function mapArtifact(a: any) {
  return {
    id: a.id,
    runId: a.run_id,
    scenarioId: a.scenario_id,
    attemptId: a.attempt_id,
    stepId: a.step_id,
    stepIndex: a.step_index,
    kind: a.kind,
    phase: a.phase,
    mediaType: a.media_type,
    fileName: a.file_name,
    relPath: a.rel_path,
    sizeBytes: a.size_bytes,
    sha256: a.sha256,
    width: a.width,
    height: a.height,
    meta: readJson<Record<string, unknown>>(a.meta_json),
  };
}

export function mapHeal(h: any) {
  return {
    id: h.id,
    projectId: h.project_id,
    runId: h.run_id,
    scenarioId: h.scenario_id,
    attemptId: h.attempt_id,
    stepId: h.step_id,
    pageUrl: h.page_url,
    originalSelector: h.original_selector,
    context: readJson<Record<string, unknown>>(h.context_json) ?? {},
    strategyUsed: h.strategy_used,
    healedSelector: h.healed_selector,
    candidates: readJson<unknown[]>(h.candidates_json) ?? [],
    succeeded: readBool(h.succeeded),
    durationMs: h.duration_ms,
    source: h.source,
    accepted: h.accepted == null ? null : readBool(h.accepted),
    createdAt: readTs(h.created_at),
  };
}

export async function getArtifact(db: Kysely<Database>, id: string) {
  const row = await db.selectFrom('artifacts').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? mapArtifact(row) : null;
}

export function newArtifactId(): string {
  return newId();
}

export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
