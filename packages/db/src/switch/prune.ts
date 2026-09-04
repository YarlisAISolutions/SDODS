import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { AutomaxDb } from '../create-db.js';
import { deleteRun } from '../repos/runs.js';

export interface PruneOptions {
  keepRuns?: number;
  keepDays?: number;
  projectSlug?: string;
  artifactsRoot?: string;
  dryRun?: boolean;
}

export interface PruneResult {
  deleted: Array<{ id: string; projectSlug: string; createdAt: string }>;
  kept: number;
}

/** Delete old runs (and their artifact directories) beyond `keepRuns` per project or older than `keepDays`. */
export async function prune(adb: AutomaxDb, opts: PruneOptions): Promise<PruneResult> {
  const { db } = adb;
  let q = db
    .selectFrom('runs')
    .innerJoin('projects', 'projects.id', 'runs.project_id')
    .select([
      'runs.id as id',
      'projects.slug as slug',
      'runs.created_at as created_at',
      'runs.started_at as started_at',
      'runs.artifacts_dir as artifacts_dir',
    ])
    .orderBy(sql`coalesce(runs.started_at, runs.created_at)`, 'desc');
  if (opts.projectSlug) q = q.where('projects.slug', '=', opts.projectSlug);
  const rows = await q.execute();
  const cutoff = opts.keepDays ? Date.now() - opts.keepDays * 86_400_000 : null;
  const perProject = new Map<string, number>();
  const victims: typeof rows = [];
  for (const r of rows) {
    const n = (perProject.get(r.slug) ?? 0) + 1;
    perProject.set(r.slug, n);
    const tooMany = opts.keepRuns !== undefined && n > opts.keepRuns;
    const tooOld = cutoff !== null && new Date(String(r.created_at)).getTime() < cutoff;
    if (tooMany || tooOld) victims.push(r);
  }
  if (!opts.dryRun) {
    for (const v of victims) {
      await deleteRun(db, v.id);
      const dir = v.artifacts_dir ?? (opts.artifactsRoot ? join(opts.artifactsRoot, v.id) : null);
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    deleted: victims.map((v) => ({
      id: v.id,
      projectSlug: v.slug,
      createdAt: String(v.created_at),
    })),
    kept: rows.length - victims.length,
  };
}
