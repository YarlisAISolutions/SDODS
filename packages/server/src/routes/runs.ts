import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  audit,
  getArtifact,
  getProjectBySlug,
  getRun,
  getRunScenarios,
  getScenarioDetail,
  ingestRun,
  listFlakyStats,
  listHealEvents,
  listLocatorStats,
  listRuns,
  computeInsights,
} from '@sdods/db';
import { legacyRunFiles, runFiles } from '@sdods/contracts';

import { CompareQuery, RunListQuery, StartRunBody } from '../schemas/index.js';
import { badRequest, forbidden, notFound, parse } from '../errors.js';
import { diffPngs, pngSize } from '../services/image-diff.js';
import { ArchiveTooLargeError, extractArtifacts } from '../services/artifacts-archive.js';
import { assertRunAccess, hardenFileReply, projectOfRun, runDir } from '../services/run-access.js';
import type { Principal, SseEvent } from '../types.js';

/** Report and runner scratch directories are served or ignored elsewhere, never listed as run files. */
const SKIP_RUN_DIRS = new Set<string>([
  runFiles.output,
  runFiles.htmlReport,
  runFiles.shardReports,
  legacyRunFiles.output,
  legacyRunFiles.htmlReport,
  legacyRunFiles.shardReports,
]);

export async function runRoutes(app: FastifyInstance) {
  // multipart is normally registered by the projects routes; in minimal builds register it here
  if (!app.hasContentTypeParser('multipart/form-data'))
    await app.register(multipart, { limits: { fileSize: app.config.ingestMaxMb * 1024 * 1024 } });
  const runDirOf = (runId: string) => runDir(app.config.artifactsDir, runId);
  const safeFile = (runId: string, rel: string) => {
    const base = runDirOf(runId);
    const abs = resolve(base, rel);
    const back = relative(base, abs);
    if (back.startsWith('..') || back.split(sep).includes('..'))
      throw forbidden('Path escapes the run directory.');
    return abs;
  };
  const canSeeProject = async (req: { principal: Principal | null }, slug: string) => {
    const role = await app.workspaceRoleForProject(req.principal!, slug);
    if (!role) throw forbidden('No access to this project.');
    return role;
  };

  app.get('/api/runs', { preHandler: [app.requireScope('runs:read')] }, async (req) => {
    const q = parse(RunListQuery, req.query, 'query');
    const rows = await listRuns(app.adb.db, {
      projectSlug: q.project,
      status: q.status,
      env: q.env,
      limit: q.limit,
      before: q.before,
    });
    const visible = [];
    for (const r of rows) {
      const role = await app
        .workspaceRoleForProject(req.principal!, r.projectSlug)
        .catch(() => null);
      if (!role) continue;
      if (q.process && (r as { process?: string | null }).process !== q.process) continue;
      const live = app.runManager.get(r.id);
      visible.push({
        ...r,
        live: live ? { status: live.status, startedAt: live.startedAt } : null,
      });
    }
    // queued/running jobs not yet in the DB (project row missing) still show up
    for (const j of app.runManager.list()) {
      if (visible.some((v) => v.id === j.runId)) continue;
      if (q.project && j.input.project !== q.project) continue;
      visible.unshift({
        ...(app.runManager.toRecord(j) as Record<string, unknown>),
        live: { status: j.status, startedAt: j.startedAt },
      } as never);
    }
    return visible;
  });

  app.post('/api/runs', { preHandler: [app.requireScope('runs:write')] }, async (req, reply) => {
    const body = parse(StartRunBody, req.body);
    const role = await canSeeProject(req, body.project);
    if (role === 'viewer') throw forbidden('Editor role required to start runs.');
    if (!app.registry.has(body.project)) throw notFound(`Project ${body.project}`);
    const job = await app.runManager.start({ ...body, trigger: 'ui' }, req.principal!.userId);
    await audit(app.adb.db, {
      actorUserId: req.principal!.userId,
      actorType: req.principal!.via === 'token' ? 'token' : 'user',
      action: 'run.start',
      targetType: 'run',
      targetId: job.runId,
      details: body,
    });
    reply.code(202);
    return { runId: job.runId, status: job.status };
  });

  app.get('/api/runs/:id', { preHandler: [app.requireScope('runs:read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const run = await getRun(app.adb.db, id);
    const live = app.runManager.get(id);
    if (!run && !live) throw notFound('Run');
    if (run) await canSeeProject(req, run.projectSlug);
    else await canSeeProject(req, live!.input.project);
    const scenarios = run ? await getRunScenarios(app.adb.db, id) : [];
    const byModule = new Map<string, typeof scenarios>();
    for (const s of scenarios) {
      const key = (s as { module?: string | null }).module ?? 'ungrouped';
      byModule.set(key, [...(byModule.get(key) ?? []), s]);
    }
    const summary = app.runManager.readSummary(id);
    const manifestPath = join(runDirOf(id), runFiles.manifest);
    const manifest = existsSync(manifestPath)
      ? JSON.parse(await import('node:fs/promises').then((m) => m.readFile(manifestPath, 'utf8')))
      : null;
    return {
      run: run ?? app.runManager.toRecord(live!),
      live: live
        ? {
            status: live.status,
            startedAt: live.startedAt,
            finishedAt: live.finishedAt,
            exitCode: live.exitCode,
          }
        : null,
      manifest,
      summary,
      scenarios,
      modules: [...byModule.entries()].map(([module, list]) => ({
        module,
        count: list.length,
        failed: list.filter((s) => s.status === 'failed').length,
        scenarios: list.map((s) => s.id),
      })),
      reportUrl: existsSync(join(runDirOf(id), runFiles.htmlReport, 'index.html'))
        ? `/reports/${id}/index.html`
        : null,
      dashboardUrl: existsSync(join(runDirOf(id), runFiles.dashboard, 'index.html'))
        ? `/api/runs/${id}/files/${runFiles.dashboard}/index.html`
        : null,
    };
  });

  app.get(
    '/api/runs/:id/scenarios/:sid',
    { preHandler: [app.requireScope('runs:read')] },
    async (req) => {
      const { id, sid } = req.params as { id: string; sid: string };
      const run = await getRun(app.adb.db, id);
      if (!run) throw notFound('Run');
      await canSeeProject(req, run.projectSlug);
      const detail = await getScenarioDetail(app.adb.db, sid);
      if (!detail || detail.runId !== id) throw notFound('Scenario');
      // pair before/after screenshots per step for the viewer
      const attempts = detail.attempts.map((a) => {
        const shots = a.artifacts.filter((x) => x.kind === 'screenshot');
        const stepsWithShots = a.steps.map((s) => ({
          ...s,
          before: shots.find((x) => x.stepIndex === s.stepIndex && x.phase === 'before') ?? null,
          after: shots.find((x) => x.stepIndex === s.stepIndex && x.phase === 'after') ?? null,
        }));
        return {
          ...a,
          steps: stepsWithShots,
          scenarioShots: shots.filter((x) => x.stepIndex == null),
          heals: a.heals,
        };
      });
      return { ...detail, attempts };
    },
  );

  app.get(
    '/api/runs/:id/events',
    { preHandler: [app.requireScope('runs:read')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const job = app.runManager.get(id);
      if (!job) {
        const run = await getRun(app.adb.db, id);
        if (!run) throw notFound('Run');
        await canSeeProject(req, run.projectSlug);
        return reply.sse(finished(run.status));
      }
      await canSeeProject(req, job.input.project);
      const since =
        Number(req.headers['last-event-id'] ?? (req.query as { since?: string }).since ?? 0) || 0;
      return reply.sse(stream(job, since));
    },
  );

  app.post(
    '/api/runs/:id/cancel',
    { preHandler: [app.requireScope('runs:write')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const job = app.runManager.get(id);
      if (!job) throw notFound('Live run');
      await canSeeProject(req, job.input.project);
      const ok = app.runManager.cancel(id);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'run.cancel',
        targetType: 'run',
        targetId: id,
      });
      return { ok, status: job.status };
    },
  );

  app.get(
    '/api/runs/:id/report',
    { preHandler: [app.requireScope('runs:read')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      runDirOf(id);
      await assertRunAccess(app, req, id);
      return reply.redirect(`/reports/${id}/index.html`);
    },
  );

  app.get(
    '/api/runs/:id/files/*',
    { preHandler: [app.requireScope('artifacts:read')] },
    async (req, reply) => {
      const { id, '*': rest } = req.params as { id: string; '*': string };
      const abs = safeFile(id, rest);
      await assertRunAccess(app, req, id);
      if (!existsSync(abs) || statSync(abs).isDirectory()) throw notFound('File');
      reply.type(mimeOf(abs));
      hardenFileReply(reply, abs);
      return reply.send(createReadStream(abs));
    },
  );

  app.get(
    '/api/runs/:id/tree',
    { preHandler: [app.requireScope('artifacts:read')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const base = runDirOf(id);
      await assertRunAccess(app, req, id);
      if (!existsSync(base)) throw notFound('Run directory');
      const out: Array<{ path: string; size: number }> = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir).sort()) {
          const abs = join(dir, name);
          const st = statSync(abs);
          if (st.isDirectory()) {
            if (SKIP_RUN_DIRS.has(name)) continue;
            walk(abs);
          } else out.push({ path: relative(base, abs).split(sep).join('/'), size: st.size });
        }
      };
      walk(base);
      return out;
    },
  );

  /**
   * CI ingest without DB credentials: multipart files (run.json, summary.json, messages*.ndjson,
   * runner-results*.json) plus an optional `artifacts.tgz` holding the run directory (screenshots,
   * api snapshots, meta.json …). The archive is extracted under the run dir; entries that would
   * escape it (absolute paths, `..`, symlinks/links) are dropped; total size is capped by
   * SDODS_INGEST_MAX_MB (multipart limit) and the extracted bytes by 4× that.
   */
  app.post(
    '/api/runs/:id/ingest',
    { preHandler: [app.requireScope('runs:ingest')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const dir = runDirOf(id);
      // Uploading into an existing run of a project the caller cannot see would overwrite it.
      if (existsSync(dir)) {
        const owner = await projectOfRun(app, id);
        if (owner) await canSeeProject(req, owner);
      }
      mkdirSync(dir, { recursive: true });
      const saved: string[] = [];
      let extracted: { files: number; bytes: number; skipped: number } | undefined;
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        const name = part.filename.replace(/[^A-Za-z0-9._-]/g, '_');
        if (name === 'artifacts.tgz' || name === 'artifacts.tar.gz') {
          const tmp = join(dir, `.upload-${process.pid}-${Date.now()}.tgz`);
          await pipeline(part.file, (await import('node:fs')).createWriteStream(tmp));
          try {
            extracted = await extractArtifacts(tmp, dir, app.config.ingestMaxMb * 4 * 1024 * 1024);
          } catch (e) {
            if (e instanceof ArchiveTooLargeError) throw badRequest(e.message);
            throw badRequest(`artifacts.tgz could not be extracted: ${(e as Error).message}`);
          } finally {
            (await import('node:fs')).rmSync(tmp, { force: true });
          }
          saved.push(name);
          continue;
        }
        if (
          !/^(run\.json|summary\.json|messages(\.shard-\d+)?\.ndjson|(runner|pw)-results(\.shard-\d+)?\.json)$/.test(
            name,
          )
        ) {
          await part.toBuffer();
          continue;
        }
        const abs = join(dir, name);
        await pipeline(part.file, (await import('node:fs')).createWriteStream(abs));
        saved.push(name);
      }
      if (!saved.length)
        throw badRequest(
          'No accepted files. Send run.json, messages*.ndjson, runner-results*.json or artifacts.tgz.',
        );
      const manifestFile = join(dir, runFiles.manifest);
      const manifest = existsSync(manifestFile)
        ? JSON.parse(await import('node:fs/promises').then((m) => m.readFile(manifestFile, 'utf8')))
        : undefined;
      // The project comes from the uploaded manifest; a token must not file results under a
      // project its owner cannot edit.
      if (typeof manifest?.projectSlug === 'string') {
        const role = await canSeeProject(req, manifest.projectSlug);
        if (role === 'viewer') throw forbidden('Editor role required to ingest runs.');
      }
      // Files may arrive as separate parts or inside artifacts.tgz: ingest whatever is in the dir.
      const present = (await import('node:fs')).readdirSync(dir);
      const ndjsonPaths = present
        .filter((f) => /^messages(\.shard-\d+)?\.ndjson$/.test(f))
        .map((f) => join(dir, f));
      const runnerJsonPaths = present
        .filter((f) => /^(runner|pw)-results(\.shard-\d+)?\.json$/.test(f))
        .map((f) => join(dir, f));
      const result = await ingestRun(app.adb, {
        runId: id,
        manifest,
        ndjsonPaths,
        runnerJsonPaths,
        artifactsRoot: app.config.artifactsDir,
      } as never);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'token',
        action: 'run.ingest',
        targetType: 'run',
        targetId: id,
        details: { files: saved },
      });
      return { runId: id, files: saved, extracted, result };
    },
  );

  // ── artifacts ──────────────────────────────────────────────────────────
  app.get(
    '/api/artifacts/:id',
    { preHandler: [app.requireScope('artifacts:read')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const a = await getArtifact(app.adb.db, id);
      if (!a) throw notFound('Artifact');
      const abs = resolve(app.config.artifactsDir, a.relPath);
      if (!abs.startsWith(app.config.artifactsDir) || !existsSync(abs))
        throw notFound('Artifact file');
      await assertRunAccess(app, req, a.runId);
      reply.type(a.mediaType || mimeOf(abs));
      hardenFileReply(reply, abs);
      // SVG is an image type that runs script when opened directly.
      if (!(a.mediaType ?? '').startsWith('image/') || /svg/i.test(a.mediaType ?? ''))
        reply.header('content-disposition', `attachment; filename="${a.fileName}"`);
      return reply.send(createReadStream(abs));
    },
  );

  app.get(
    '/api/artifacts/compare',
    { preHandler: [app.requireScope('artifacts:read')] },
    async (req) => {
      const q = parse(CompareQuery, req.query, 'query');
      const [a, b] = await Promise.all([
        getArtifact(app.adb.db, q.before),
        getArtifact(app.adb.db, q.after),
      ]);
      if (!a || !b) throw notFound('Artifact');
      await assertRunAccess(app, req, a.runId);
      await assertRunAccess(app, req, b.runId);
      const pa = resolve(app.config.artifactsDir, a.relPath);
      const pb = resolve(app.config.artifactsDir, b.relPath);
      const cacheDir = join(app.config.artifactsDir, a.runId, 'diff');
      const diff = diffPngs(pa, pb, cacheDir, q.threshold);
      return {
        before: { id: a.id, url: `/api/artifacts/${a.id}`, ...pngSize(pa) },
        after: { id: b.id, url: `/api/artifacts/${b.id}`, ...pngSize(pb) },
        diff: {
          url: `/api/runs/${a.runId}/files/diff/${relative(cacheDir, diff.diffPath)}`,
          width: diff.width,
          height: diff.height,
        },
        mismatchPixels: diff.mismatchPixels,
        mismatchRatio: diff.mismatchRatio,
        cached: diff.cached,
      };
    },
  );

  /** Compare two files of the same run by path (works without DB artifact rows). */
  app.get(
    '/api/runs/:id/compare',
    { preHandler: [app.requireScope('artifacts:read')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const q = req.query as { before?: string; after?: string; threshold?: string };
      if (!q.before || !q.after)
        throw badRequest('before and after are required (paths relative to the run directory).');
      const pa = safeFile(id, q.before);
      const pb = safeFile(id, q.after);
      await assertRunAccess(app, req, id);
      if (!existsSync(pa) || !existsSync(pb)) throw notFound('File');
      const cacheDir = join(runDirOf(id), 'diff');
      const diff = diffPngs(pa, pb, cacheDir, q.threshold ? Number(q.threshold) : 0.1);
      return {
        before: { url: `/api/runs/${id}/files/${q.before}`, ...pngSize(pa) },
        after: { url: `/api/runs/${id}/files/${q.after}`, ...pngSize(pb) },
        diff: {
          url: `/api/runs/${id}/files/diff/${relative(cacheDir, diff.diffPath)}`,
          width: diff.width,
          height: diff.height,
        },
        mismatchPixels: diff.mismatchPixels,
        mismatchRatio: diff.mismatchRatio,
        cached: diff.cached,
      };
    },
  );

  // ── stats ──────────────────────────────────────────────────────────────
  app.get('/api/stats/trends', { preHandler: [app.requireScope('runs:read')] }, async (req) => {
    const q = req.query as { project?: string; days?: string };
    const since = new Date(Date.now() - Number(q.days ?? 30) * 86_400_000).toISOString();
    let query = app.adb.db
      .selectFrom('runs')
      .innerJoin('projects', 'projects.id', 'runs.project_id')
      .select([
        'runs.id',
        'runs.status',
        'runs.env_name',
        'runs.started_at',
        'runs.duration_ms',
        'runs.totals_json',
        'runs.process',
        'projects.slug as project',
      ])
      .where('runs.created_at', '>=', since)
      .orderBy('runs.created_at', 'asc');
    if (q.project) query = query.where('projects.slug', '=', q.project);
    const rows = await query.execute();
    return rows.map((r) => {
      const t = (
        typeof r.totals_json === 'string' ? JSON.parse(r.totals_json) : r.totals_json
      ) as Record<string, number> | null;
      const total = t?.total ?? 0;
      return {
        runId: r.id,
        project: r.project,
        env: r.env_name,
        process: r.process,
        status: r.status,
        startedAt: r.started_at,
        durationMs: r.duration_ms,
        total,
        passed: t?.passed ?? 0,
        failed: t?.failed ?? 0,
        flaky: t?.flaky ?? 0,
        passRate: total ? Math.round(((t?.passed ?? 0) / total) * 1000) / 10 : null,
      };
    });
  });

  app.get('/api/stats/flaky', { preHandler: [app.requireScope('runs:read')] }, async (req) => {
    const q = req.query as { project?: string; limit?: string };
    if (!q.project) throw badRequest('project is required');
    const p = await getProjectBySlug(app.adb.db, q.project);
    if (!p) return [];
    return listFlakyStats(app.adb.db, p.id, Number(q.limit ?? 50));
  });

  app.get('/api/stats/heal', { preHandler: [app.requireScope('runs:read')] }, async (req) => {
    const q = req.query as { project?: string; limit?: string };
    if (!q.project) throw badRequest('project is required');
    const p = await getProjectBySlug(app.adb.db, q.project);
    if (!p) return { locators: [], events: [] };
    return {
      locators: await listLocatorStats(app.adb.db, p.id, Number(q.limit ?? 50)),
      events: await listHealEvents(app.adb.db, { projectId: p.id, limit: Number(q.limit ?? 50) }),
    };
  });

  app.get('/api/stats/insights', { preHandler: [app.requireScope('runs:read')] }, async (req) => {
    const q = req.query as { project?: string; window?: string };
    if (!q.project) throw badRequest('project is required');
    return computeInsights(app.adb.db, {
      projectSlug: q.project,
      window: q.window ? Number(q.window) : undefined,
    });
  });
}

async function* stream(
  job: {
    log: {
      stream(
        since: number,
      ): AsyncGenerator<{ seq: number; t: number; stream: string; line: string }>;
    };
    status: string;
    exitCode?: number;
  },
  since: number,
): AsyncGenerator<SseEvent> {
  yield { event: 'status', data: { status: job.status } };
  for await (const line of job.log.stream(since)) {
    yield { event: 'log', id: line.seq, data: line };
    const m = /\[(\d+)\/(\d+)\]/.exec(line.line);
    if (m) yield { event: 'progress', data: { current: Number(m[1]), total: Number(m[2]) } };
  }
  yield { event: 'done', data: { status: job.status, exitCode: job.exitCode } };
}

async function* finished(status: string): AsyncGenerator<SseEvent> {
  yield { event: 'status', data: { status } };
  yield { event: 'done', data: { status } };
}

function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        json: 'application/json',
        ndjson: 'application/x-ndjson',
        html: 'text/html; charset=utf-8',
        txt: 'text/plain; charset=utf-8',
        log: 'text/plain; charset=utf-8',
        zip: 'application/zip',
        webm: 'video/webm',
        har: 'application/json',
        md: 'text/markdown; charset=utf-8',
        css: 'text/css',
        js: 'text/javascript',
      } as Record<string, string>
    )[ext] ?? 'application/octet-stream'
  );
}

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function touchFile(path: string) {
  writeFileSync(path, '');
}
