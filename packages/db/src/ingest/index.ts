import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runFiles } from '@sdods/contracts/names';
import type { RunManifest } from '@sdods/contracts/types';
import type { SdodsDb } from '../create-db.js';
import { readJson } from '../col.js';
import { ensureProject, getProjectBySlug } from '../repos/projects.js';
import { deleteRunChildren, upsertRun } from '../repos/runs.js';
import { IngestSession } from './cucumber-ingest.js';
import { finalizeRun, type LocatorCounter } from './finalize.js';
import { fileSha256, parseNdjson, type ParseStats } from './parse-ndjson.js';
import { ingestRunnerJson } from './runner-json-ingest.js';
import type { IngestContext, IngestResult, IngestRunOptions } from './types.js';

export * from './types.js';
export * from './parse-ndjson.js';
export * from './message-index.js';
export * from './attachments.js';
export * from './cucumber-ingest.js';
export * from './runner-json-ingest.js';
export * from './finalize.js';

/** Read `<runDir>/run.json` when present. */
export function readManifest(runDir: string): RunManifest | null {
  const file = join(runDir, runFiles.manifest);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RunManifest;
  } catch {
    return null;
  }
}

/**
 * Discover result files inside a run directory. Run directories outlive releases, so the
 * pre-rename `pw-results*.json` name is still accepted alongside `runner-results*.json`.
 */
export function discoverRunFiles(runDir: string): { ndjson: string[]; runnerJson: string[] } {
  const ndjson: string[] = [];
  const runnerJson: string[] = [];
  if (!existsSync(runDir)) return { ndjson, runnerJson };
  for (const f of readdirSync(runDir)) {
    if (/^messages(\.shard-\d+)?\.ndjson$/.test(f)) ndjson.push(join(runDir, f));
    if (/^(runner|pw)-results(\.shard-\d+)?\.json$/.test(f)) runnerJson.push(join(runDir, f));
  }
  return { ndjson: ndjson.sort(), runnerJson: runnerJson.sort() };
}

/**
 * Ingest one run (all its NDJSON shards and runner JSON files) into the database.
 * Idempotent: natural keys converge on re-run; `replace` wipes the run's children first.
 */
export async function ingestRun(adb: SdodsDb, opts: IngestRunOptions): Promise<IngestResult> {
  const artifactsRoot = resolve(opts.artifactsRoot);
  const runDir = join(artifactsRoot, opts.runId);
  const manifest = opts.manifest === undefined ? readManifest(runDir) : opts.manifest;
  const projectSlug = manifest?.projectSlug ?? opts.projectSlug;
  if (!projectSlug)
    throw new Error('ingestRun needs a project slug (manifest run.json or --project).');
  const discovered = discoverRunFiles(runDir);
  const ndjsonPaths = (opts.ndjsonPaths?.length ? opts.ndjsonPaths : discovered.ndjson).map((p) =>
    resolve(p),
  );
  const runnerJsonPaths = (
    opts.runnerJsonPaths?.length ? opts.runnerJsonPaths : discovered.runnerJson
  ).map((p) => resolve(p));
  if (ndjsonPaths.length === 0 && runnerJsonPaths.length === 0)
    throw new Error(
      `No messages*.ndjson or runner-results*.json found for run ${opts.runId} under ${runDir}.`,
    );

  const { db, driver } = adb;
  const project = (await getProjectBySlug(db, projectSlug)) ?? {
    id: await ensureProject(db, driver, projectSlug),
    workspaceId: null,
  };
  const ctx: IngestContext = {
    adb,
    runId: opts.runId,
    projectId: project.id,
    projectSlug,
    artifactsRoot,
    runDir,
    workspaceId: project.workspaceId ?? null,
  };

  const existingRun = await db
    .selectFrom('runs')
    .select(['totals_json'])
    .where('id', '=', opts.runId)
    .executeTakeFirst();
  const prevTotals = readJson<Record<string, unknown>>(existingRun?.totals_json) ?? {};
  const alreadyIngested = new Set(
    Array.isArray(prevTotals.ingested_files) ? (prevTotals.ingested_files as string[]) : [],
  );

  await upsertRun(db, driver, {
    id: opts.runId,
    projectId: project.id,
    workspaceId: ctx.workspaceId,
    envName: manifest?.env ?? opts.env ?? 'unknown',
    trigger: manifest?.trigger ?? opts.trigger ?? 'cli',
    status: 'running',
    suiteTag: manifest?.suiteTag ?? null,
    tagsExpr: manifest?.tagsExpr ?? null,
    layers: manifest?.layers ?? [],
    browsers: manifest?.browsers ?? [],
    shardTotal: manifest?.shardTotal ?? null,
    gitSha: manifest?.git?.sha ?? null,
    gitBranch: manifest?.git?.branch ?? null,
    ciProvider: manifest?.ci?.provider ?? null,
    ciRunId: manifest?.ci?.runId ?? null,
    ciUrl: manifest?.ci?.url ?? null,
    command: manifest?.command ?? null,
    startedAt: manifest?.startedAt ?? null,
    artifactsDir: runDir,
    htmlReportRel: existsSync(join(runDir, runFiles.htmlReport)) ? runFiles.htmlReport : null,
    exitCode: manifest?.exitCode ?? null,
    process: (manifest as any)?.process ?? null,
  });
  if (opts.replace) await deleteRunChildren(db, opts.runId);

  const locatorCounters = new Map<string, LocatorCounter>();
  const filesIngested: string[] = [];
  const filesSkipped: string[] = [];
  let parseErrors = 0;
  let runStartedAt: string | null = manifest?.startedAt ?? null;
  let runFinishedAt: string | null = manifest?.finishedAt ?? null;
  const counts = { scenarios: 0, attempts: 0, steps: 0, artifacts: 0, healEvents: 0 };

  for (const file of ndjsonPaths) {
    const sha = fileSha256(file);
    const key = `${basename(file)}@${sha}`;
    if (alreadyIngested.has(key) && !opts.replace) {
      filesSkipped.push(file);
      continue;
    }
    const session = new IngestSession(ctx);
    const stats: ParseStats = { lines: 0, parsed: 0, skipped: 0 };
    for await (const env of parseNdjson(file, stats)) await session.consume(env);
    parseErrors += stats.skipped;
    for (const [sel, c] of session.locatorCounters) {
      const prev = locatorCounters.get(sel) ?? { fails: 0, heals: 0, uses: 0 };
      locatorCounters.set(sel, {
        fails: prev.fails + c.fails,
        heals: prev.heals + c.heals,
        uses: prev.uses + c.uses,
        lastStrategy: c.lastStrategy ?? prev.lastStrategy,
        suggested: c.suggested ?? prev.suggested,
      });
    }
    counts.scenarios += session.counts.scenarios;
    counts.attempts += session.counts.attempts;
    counts.steps += session.counts.steps;
    counts.artifacts += session.counts.artifacts;
    counts.healEvents += session.counts.healEvents;
    if (session.runStartedAt && (!runStartedAt || session.runStartedAt < runStartedAt))
      runStartedAt = session.runStartedAt;
    if (session.runFinishedAt && (!runFinishedAt || session.runFinishedAt > runFinishedAt))
      runFinishedAt = session.runFinishedAt;
    filesIngested.push(key);
  }
  for (const file of runnerJsonPaths) {
    const sha = fileSha256(file);
    const key = `${basename(file)}@${sha}`;
    if (alreadyIngested.has(key) && !opts.replace) {
      filesSkipped.push(file);
      continue;
    }
    const r = await ingestRunnerJson(ctx, file, locatorCounters);
    counts.scenarios += r.scenarios;
    counts.attempts += r.attempts;
    counts.steps += r.steps;
    counts.artifacts += r.artifacts;
    if (r.startedAt && (!runStartedAt || r.startedAt < runStartedAt)) runStartedAt = r.startedAt;
    if (r.finishedAt && (!runFinishedAt || r.finishedAt > runFinishedAt))
      runFinishedAt = r.finishedAt;
    filesIngested.push(key);
  }

  const { totals, status } = await finalizeRun({
    adb,
    runId: opts.runId,
    projectId: project.id,
    locatorCounters,
    runStartedAt,
    runFinishedAt,
    ingestedFiles: filesIngested,
    exitCode: manifest?.exitCode ?? null,
  });
  return {
    runId: opts.runId,
    projectSlug,
    totals,
    status,
    scenarios: counts.scenarios,
    attempts: counts.attempts,
    steps: counts.steps,
    artifacts: counts.artifacts,
    healEvents: counts.healEvents,
    filesIngested,
    filesSkipped,
    parseErrors,
  };
}
