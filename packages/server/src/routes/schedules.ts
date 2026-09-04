import type { FastifyInstance } from 'fastify';
import {
  audit,
  deleteSchedule,
  getProjectBySlug,
  listScheduleRuns,
  updateScheduleState,
  upsertSchedule,
} from '@sdods/db';
import { ScheduleBody } from '../schemas/index.js';
import { badRequest, forbidden, notFound, parse } from '../errors.js';
import { nextTimes } from '../services/scheduler.js';
import type { Principal } from '../types.js';

export async function scheduleRoutes(app: FastifyInstance) {
  const visible = async (req: { principal: Principal | null }, projectSlug?: string) => {
    if (!projectSlug) return true;
    const role = await app.workspaceRoleForProject(req.principal!, projectSlug);
    if (!role) throw forbidden('No access to this project.');
    return role;
  };

  app.get('/api/schedules', { preHandler: [app.requireScope('schedules:read')] }, async (req) => {
    const q = req.query as { project?: string };
    const all = await app.scheduler.list();
    const out = [];
    for (const s of all) {
      if (q.project && s.projectSlug !== q.project) continue;
      const role = s.projectSlug
        ? await app.workspaceRoleForProject(req.principal!, s.projectSlug).catch(() => null)
        : 'viewer';
      if (role) out.push(s);
    }
    return out;
  });

  app.post(
    '/api/schedules',
    { preHandler: [app.requireScope('schedules:write')] },
    async (req, reply) => {
      const body = parse(ScheduleBody, req.body);
      const role = await visible(req, body.project);
      if (role === 'viewer') throw forbidden('Editor role required.');
      const project = await getProjectBySlug(app.adb.db, body.project);
      if (!project) throw notFound(`Project ${body.project}`);
      const next = nextTimes(body.cron, body.timezone, 1);
      if (!next.length) throw badRequest(`Invalid cron expression "${body.cron}".`);
      const id = await upsertSchedule(app.adb.db, app.adb.driver, {
        projectId: project.id,
        name: body.name,
        cronExpr: body.cron,
        timezone: body.timezone,
        runInput: {
          env: body.env,
          tags: body.tags,
          layers: body.layers,
          browsers: body.browsers,
          process: body.process,
          workers: body.workers,
          harMode: body.harMode,
        },
        overlapPolicy: body.overlap,
        jitterSeconds: body.jitterSeconds,
        catchUp: body.catchUp,
        enabled: body.enabled,
        notify: body.notify,
        nextRunAt: next[0],
        createdBy: req.principal!.userId,
      });
      await app.scheduler.reload();
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'schedule.upsert',
        targetType: 'schedule',
        targetId: id,
        details: { name: body.name, cron: body.cron },
      });
      reply.code(201);
      return { id, nextFireTimes: nextTimes(body.cron, body.timezone, 5) };
    },
  );

  app.get(
    '/api/schedules/next',
    { preHandler: [app.requireScope('schedules:read')] },
    async (req) => {
      const q = req.query as { cron?: string; tz?: string; count?: string };
      if (!q.cron) throw badRequest('cron is required');
      const times = nextTimes(q.cron, q.tz ?? 'UTC', Math.min(Number(q.count ?? 5), 50));
      if (!times.length) throw badRequest('Invalid cron expression.');
      return { cron: q.cron, timezone: q.tz ?? 'UTC', times };
    },
  );

  app.get(
    '/api/schedules/:id',
    { preHandler: [app.requireScope('schedules:read')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const s = (await app.scheduler.list()).find((x) => x.id === id);
      if (!s) throw notFound('Schedule');
      await visible(req, s.projectSlug);
      return { ...s, history: await listScheduleRuns(app.adb.db, id) };
    },
  );

  app.post(
    '/api/schedules/:id/:action',
    { preHandler: [app.requireScope('schedules:write')] },
    async (req) => {
      const { id, action } = req.params as { id: string; action: string };
      const s = (await app.scheduler.list()).find((x) => x.id === id);
      if (!s) throw notFound('Schedule');
      const role = await visible(req, s.projectSlug);
      if (role === 'viewer') throw forbidden('Editor role required.');
      if (action === 'pause' || action === 'resume') {
        await updateScheduleState(app.adb.db, id, { enabled: action === 'resume' }, app.adb.driver);
        await app.scheduler.reload();
        return { ok: true, enabled: action === 'resume' };
      }
      if (action === 'run-now') {
        const r = await app.scheduler.fire(id, { force: true });
        await audit(app.adb.db, {
          actorUserId: req.principal!.userId,
          actorType: 'user',
          action: 'schedule.run-now',
          targetType: 'schedule',
          targetId: id,
        });
        return r;
      }
      throw badRequest(`Unknown action ${action}. Use pause, resume or run-now.`);
    },
  );

  app.delete(
    '/api/schedules/:id',
    { preHandler: [app.requireScope('schedules:write')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const s = (await app.scheduler.list()).find((x) => x.id === id);
      if (!s) throw notFound('Schedule');
      const role = await visible(req, s.projectSlug);
      if (role === 'viewer') throw forbidden('Editor role required.');
      await deleteSchedule(app.adb.db, id);
      await app.scheduler.reload();
      return { ok: true };
    },
  );
}
