import type { Kysely } from 'kysely';
import { enc, nowIso, readBool, readJson, readTs } from '../col.js';
import type { Driver } from '../driver.js';
import { newId } from '../ids.js';
import type { Database } from '../schema.js';

// ── integrations ──────────────────────────────────────────────────────────
export async function upsertIntegration(
  db: Kysely<Database>,
  driver: Driver,
  input: {
    projectId: string;
    provider: string;
    config: Record<string, unknown>;
    secretEnv?: Record<string, string>;
    enabled?: boolean;
  },
): Promise<string> {
  const existing = await db
    .selectFrom('integrations')
    .select(['id'])
    .where('project_id', '=', input.projectId)
    .where('provider', '=', input.provider)
    .executeTakeFirst();
  const values = {
    config_json: enc.json(input.config),
    secret_env_json: enc.json(input.secretEnv ?? {}),
    enabled: enc.bool(driver, input.enabled ?? false) as number,
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('integrations').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('integrations')
    .values({
      id,
      project_id: input.projectId,
      provider: input.provider,
      last_sync_at: null,
      created_at: nowIso(),
      ...values,
    })
    .execute();
  return id;
}

export async function listIntegrations(db: Kysely<Database>, projectId: string) {
  const rows = await db
    .selectFrom('integrations')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('provider')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    config: readJson<Record<string, unknown>>(r.config_json) ?? {},
    secretEnv: readJson<Record<string, string>>(r.secret_env_json) ?? {},
    enabled: readBool(r.enabled),
    lastSyncAt: readTs(r.last_sync_at),
  }));
}

// ── issue links ───────────────────────────────────────────────────────────
export async function upsertIssueLink(
  db: Kysely<Database>,
  input: {
    projectId: string;
    integrationId?: string | null;
    provider: string;
    fingerprint: string;
    scenarioName?: string | null;
    externalKey: string;
    externalUrl?: string | null;
    status?: string;
    source?: string;
    lastRunId?: string | null;
  },
): Promise<string> {
  const existing = await db
    .selectFrom('issue_links')
    .select(['id'])
    .where('project_id', '=', input.projectId)
    .where('provider', '=', input.provider)
    .where('fingerprint', '=', input.fingerprint)
    .where('external_key', '=', input.externalKey)
    .executeTakeFirst();
  const values = {
    integration_id: input.integrationId ?? null,
    scenario_name: input.scenarioName ?? null,
    external_url: input.externalUrl ?? null,
    status: input.status ?? 'unknown',
    source: input.source ?? 'auto',
    last_run_id: input.lastRunId ?? null,
    last_synced_at: nowIso(),
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('issue_links').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('issue_links')
    .values({
      id,
      project_id: input.projectId,
      provider: input.provider,
      fingerprint: input.fingerprint,
      external_key: input.externalKey,
      created_at: nowIso(),
      ...values,
    })
    .execute();
  return id;
}

export async function findOpenIssueLink(
  db: Kysely<Database>,
  projectId: string,
  provider: string,
  fingerprint: string,
) {
  const row = await db
    .selectFrom('issue_links')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('provider', '=', provider)
    .where('fingerprint', '=', fingerprint)
    .where('status', '=', 'open')
    .executeTakeFirst();
  return row ? mapIssueLink(row) : null;
}

export async function listIssueLinks(
  db: Kysely<Database>,
  opts: { projectId?: string; fingerprint?: string; provider?: string },
) {
  let q = db.selectFrom('issue_links').selectAll().orderBy('updated_at', 'desc');
  if (opts.projectId) q = q.where('project_id', '=', opts.projectId);
  if (opts.fingerprint) q = q.where('fingerprint', '=', opts.fingerprint);
  if (opts.provider) q = q.where('provider', '=', opts.provider);
  return (await q.execute()).map(mapIssueLink);
}

export async function setIssueLinkStatus(db: Kysely<Database>, id: string, status: string) {
  await db
    .updateTable('issue_links')
    .set({ status, last_synced_at: nowIso(), updated_at: nowIso() })
    .where('id', '=', id)
    .execute();
}

function mapIssueLink(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    integrationId: r.integration_id,
    provider: r.provider,
    fingerprint: r.fingerprint,
    scenarioName: r.scenario_name,
    externalKey: r.external_key,
    externalUrl: r.external_url,
    status: r.status,
    source: r.source,
    lastRunId: r.last_run_id,
    lastSyncedAt: readTs(r.last_synced_at),
  };
}

// ── proposals ─────────────────────────────────────────────────────────────
export async function upsertProposal(
  db: Kysely<Database>,
  input: {
    id: string;
    projectId: string;
    role: string;
    status?: string;
    summary?: string | null;
    manifest: Record<string, unknown>;
    costUsd?: number | null;
    model?: string | null;
    createdBy?: string | null;
  },
): Promise<void> {
  const existing = await db
    .selectFrom('proposals')
    .select(['id'])
    .where('id', '=', input.id)
    .executeTakeFirst();
  const values = {
    role: input.role,
    status: input.status ?? 'pending',
    summary: input.summary ?? null,
    manifest_json: enc.json(input.manifest),
    cost_usd: input.costUsd ?? null,
    model: input.model ?? null,
  };
  if (existing) {
    await db.updateTable('proposals').set(values).where('id', '=', input.id).execute();
    return;
  }
  await db
    .insertInto('proposals')
    .values({
      id: input.id,
      project_id: input.projectId,
      created_by: input.createdBy ?? null,
      reviewed_by: null,
      created_at: nowIso(),
      reviewed_at: null,
      ...values,
    })
    .execute();
}

export async function reviewProposal(
  db: Kysely<Database>,
  id: string,
  status: 'accepted' | 'rejected',
  reviewedBy?: string | null,
) {
  await db
    .updateTable('proposals')
    .set({ status, reviewed_by: reviewedBy ?? null, reviewed_at: nowIso() })
    .where('id', '=', id)
    .execute();
}

export async function listProposals(
  db: Kysely<Database>,
  opts: { projectId?: string; status?: string; limit?: number } = {},
) {
  let q = db
    .selectFrom('proposals')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 100);
  if (opts.projectId) q = q.where('project_id', '=', opts.projectId);
  if (opts.status) q = q.where('status', '=', opts.status);
  return (await q.execute()).map((p) => ({
    id: p.id,
    projectId: p.project_id,
    role: p.role,
    status: p.status,
    summary: p.summary,
    manifest: readJson<Record<string, unknown>>(p.manifest_json) ?? {},
    costUsd: p.cost_usd,
    model: p.model,
    createdBy: p.created_by,
    reviewedBy: p.reviewed_by,
    createdAt: readTs(p.created_at),
    reviewedAt: readTs(p.reviewed_at),
  }));
}

// ── agent jobs ────────────────────────────────────────────────────────────
export async function createAgentJob(
  db: Kysely<Database>,
  input: {
    projectId: string;
    kind: string;
    goal?: string | null;
    input?: Record<string, unknown>;
    provider?: string | null;
    model?: string | null;
    startedBy?: string | null;
  },
): Promise<string> {
  const id = newId();
  await db
    .insertInto('agent_jobs')
    .values({
      id,
      project_id: input.projectId,
      kind: input.kind,
      goal: input.goal ?? null,
      status: 'queued',
      input_json: enc.json(input.input ?? {}),
      output_json: null,
      diff_text: null,
      log_rel: null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      turns: null,
      proposal_id: null,
      started_by: input.startedBy ?? null,
      reviewed_by: null,
      started_at: null,
      finished_at: null,
      reviewed_at: null,
      error: null,
      created_at: nowIso(),
    })
    .execute();
  return id;
}

export async function updateAgentJob(
  db: Kysely<Database>,
  id: string,
  patch: Partial<{
    status: string;
    output: Record<string, unknown>;
    diffText: string | null;
    logRel: string | null;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    turns: number;
    proposalId: string | null;
    startedAt: string;
    finishedAt: string;
    error: string | null;
    reviewedBy: string | null;
    reviewedAt: string;
  }>,
) {
  await db
    .updateTable('agent_jobs')
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.output !== undefined ? { output_json: enc.json(patch.output) } : {}),
      ...(patch.diffText !== undefined ? { diff_text: patch.diffText } : {}),
      ...(patch.logRel !== undefined ? { log_rel: patch.logRel } : {}),
      ...(patch.tokensIn !== undefined ? { tokens_in: patch.tokensIn } : {}),
      ...(patch.tokensOut !== undefined ? { tokens_out: patch.tokensOut } : {}),
      ...(patch.costUsd !== undefined ? { cost_usd: patch.costUsd } : {}),
      ...(patch.turns !== undefined ? { turns: patch.turns } : {}),
      ...(patch.proposalId !== undefined ? { proposal_id: patch.proposalId } : {}),
      ...(patch.startedAt !== undefined ? { started_at: patch.startedAt } : {}),
      ...(patch.finishedAt !== undefined ? { finished_at: patch.finishedAt } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.reviewedBy !== undefined ? { reviewed_by: patch.reviewedBy } : {}),
      ...(patch.reviewedAt !== undefined ? { reviewed_at: patch.reviewedAt } : {}),
    })
    .where('id', '=', id)
    .execute();
}

export async function getAgentJob(db: Kysely<Database>, id: string) {
  const j = await db.selectFrom('agent_jobs').selectAll().where('id', '=', id).executeTakeFirst();
  return j ? mapAgentJob(j) : null;
}

export async function listAgentJobs(
  db: Kysely<Database>,
  opts: { projectId?: string; status?: string; limit?: number } = {},
) {
  let q = db
    .selectFrom('agent_jobs')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 50);
  if (opts.projectId) q = q.where('project_id', '=', opts.projectId);
  if (opts.status) q = q.where('status', '=', opts.status);
  return (await q.execute()).map(mapAgentJob);
}

function mapAgentJob(j: any) {
  return {
    id: j.id,
    projectId: j.project_id,
    kind: j.kind,
    goal: j.goal,
    status: j.status,
    input: readJson<Record<string, unknown>>(j.input_json) ?? {},
    output: readJson<Record<string, unknown>>(j.output_json),
    diffText: j.diff_text,
    logRel: j.log_rel,
    provider: j.provider,
    model: j.model,
    tokensIn: j.tokens_in,
    tokensOut: j.tokens_out,
    costUsd: j.cost_usd,
    turns: j.turns,
    proposalId: j.proposal_id,
    startedBy: j.started_by,
    startedAt: readTs(j.started_at),
    finishedAt: readTs(j.finished_at),
    error: j.error,
    createdAt: readTs(j.created_at),
  };
}

// ── schedules ─────────────────────────────────────────────────────────────
export interface ScheduleUpsert {
  projectId: string;
  environmentId?: string | null;
  name: string;
  cronExpr: string;
  timezone?: string;
  runInput: Record<string, unknown>;
  overlapPolicy?: string;
  jitterSeconds?: number;
  catchUp?: boolean;
  enabled?: boolean;
  notify?: unknown;
  retentionRuns?: number | null;
  nextRunAt?: string | null;
  createdBy?: string | null;
}

export async function upsertSchedule(
  db: Kysely<Database>,
  driver: Driver,
  s: ScheduleUpsert,
): Promise<string> {
  const existing = await db
    .selectFrom('schedules')
    .select(['id'])
    .where('project_id', '=', s.projectId)
    .where('name', '=', s.name)
    .executeTakeFirst();
  const values = {
    environment_id: s.environmentId ?? null,
    cron_expr: s.cronExpr,
    timezone: s.timezone ?? 'UTC',
    run_input_json: enc.json(s.runInput),
    overlap_policy: s.overlapPolicy ?? 'skip',
    jitter_seconds: s.jitterSeconds ?? 0,
    catch_up: enc.bool(driver, s.catchUp ?? false) as number,
    enabled: enc.bool(driver, s.enabled ?? true) as number,
    notify_json: enc.json(s.notify ?? []),
    retention_runs: s.retentionRuns ?? null,
    next_run_at: s.nextRunAt ?? null,
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('schedules').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('schedules')
    .values({
      id,
      project_id: s.projectId,
      name: s.name,
      last_run_id: null,
      last_status: null,
      created_by: s.createdBy ?? null,
      created_at: nowIso(),
      ...values,
    })
    .execute();
  return id;
}

export async function listSchedules(db: Kysely<Database>, projectId?: string) {
  let q = db.selectFrom('schedules').selectAll().orderBy('name');
  if (projectId) q = q.where('project_id', '=', projectId);
  return (await q.execute()).map((s) => ({
    id: s.id,
    projectId: s.project_id,
    environmentId: s.environment_id,
    name: s.name,
    cronExpr: s.cron_expr,
    timezone: s.timezone,
    runInput: readJson<Record<string, unknown>>(s.run_input_json) ?? {},
    overlapPolicy: s.overlap_policy,
    jitterSeconds: s.jitter_seconds,
    catchUp: readBool(s.catch_up),
    enabled: readBool(s.enabled),
    notify: readJson(s.notify_json) ?? [],
    retentionRuns: s.retention_runs,
    nextRunAt: readTs(s.next_run_at),
    lastRunId: s.last_run_id,
    lastStatus: s.last_status,
  }));
}

export async function updateScheduleState(
  db: Kysely<Database>,
  id: string,
  patch: {
    nextRunAt?: string | null;
    lastRunId?: string | null;
    lastStatus?: string | null;
    enabled?: boolean;
  },
  driver: Driver,
) {
  await db
    .updateTable('schedules')
    .set({
      ...(patch.nextRunAt !== undefined ? { next_run_at: patch.nextRunAt } : {}),
      ...(patch.lastRunId !== undefined ? { last_run_id: patch.lastRunId } : {}),
      ...(patch.lastStatus !== undefined ? { last_status: patch.lastStatus } : {}),
      ...(patch.enabled !== undefined
        ? { enabled: enc.bool(driver, patch.enabled) as number }
        : {}),
      updated_at: nowIso(),
    })
    .where('id', '=', id)
    .execute();
}

export async function deleteSchedule(db: Kysely<Database>, id: string) {
  await db.deleteFrom('schedules').where('id', '=', id).execute();
}

export async function recordScheduleRun(
  db: Kysely<Database>,
  input: { scheduleId: string; runId?: string | null; status: string; note?: string | null },
) {
  await db
    .insertInto('schedule_runs')
    .values({
      id: newId(),
      schedule_id: input.scheduleId,
      run_id: input.runId ?? null,
      fired_at: nowIso(),
      status: input.status,
      note: input.note ?? null,
    })
    .execute();
}

export async function listScheduleRuns(db: Kysely<Database>, scheduleId: string, limit = 50) {
  return db
    .selectFrom('schedule_runs')
    .selectAll()
    .where('schedule_id', '=', scheduleId)
    .orderBy('fired_at', 'desc')
    .limit(limit)
    .execute();
}

// ── audit ─────────────────────────────────────────────────────────────────
export async function audit(
  db: Kysely<Database>,
  input: {
    actorUserId?: string | null;
    actorType?: 'user' | 'cli' | 'system' | 'token';
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    details?: Record<string, unknown>;
    ip?: string | null;
  },
) {
  await db
    .insertInto('audit_log')
    .values({
      id: newId(),
      actor_user_id: input.actorUserId ?? null,
      actor_type: input.actorType ?? 'system',
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      details_json: input.details ? enc.json(input.details) : null,
      ip: input.ip ?? null,
      created_at: nowIso(),
    })
    .execute();
}

export async function listAudit(
  db: Kysely<Database>,
  opts: { limit?: number; before?: string } = {},
) {
  let q = db
    .selectFrom('audit_log')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 100);
  if (opts.before) q = q.where('created_at', '<', opts.before);
  return (await q.execute()).map((a) => ({
    ...a,
    details: readJson(a.details_json),
    createdAt: readTs(a.created_at),
  }));
}
