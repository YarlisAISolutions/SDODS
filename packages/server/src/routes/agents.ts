import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { audit } from '@sdods/db';
import { AgentJobBody } from '../schemas/index.js';
import { badRequest, forbidden, notFound, parse } from '../errors.js';
import { runCliJson } from '../services/cli.js';
import type { SseEvent } from '../types.js';

export async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agents/jobs', { preHandler: [app.requireScope('agents:run')] }, async () =>
    app.agentManager.list().map(view),
  );

  app.post(
    '/api/agents/jobs',
    { preHandler: [app.requireScope('agents:run')] },
    async (req, reply) => {
      const body = parse(AgentJobBody, req.body);
      const role = await app.workspaceRoleForProject(req.principal!, body.project);
      if (!role || role === 'viewer') throw forbidden('Editor role required to run agents.');
      if (!app.registry.has(body.project)) throw notFound(`Project ${body.project}`);
      const root = app.registry.entry(body.project).root;
      if (body.plan) body.plan = projectFile(root, body.plan, 'plan');
      if (body.spec) body.spec = projectFile(root, body.spec, 'spec');
      const job = app.agentManager.start(body, req.principal!.userId);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'agent.start',
        targetType: 'agent_job',
        targetId: job.id,
        details: { kind: body.kind, project: body.project },
      });
      reply.code(202);
      return view(job);
    },
  );

  app.get('/api/agents/jobs/:id', { preHandler: [app.requireScope('agents:run')] }, async (req) => {
    const { id } = req.params as { id: string };
    const job = app.agentManager.get(id);
    if (!job) throw notFound('Agent job');
    return { ...view(job), result: job.result ?? null };
  });

  app.get(
    '/api/agents/jobs/:id/events',
    { preHandler: [app.requireScope('agents:run')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const job = app.agentManager.get(id);
      if (!job) throw notFound('Agent job');
      const since = Number(req.headers['last-event-id'] ?? 0) || 0;
      return reply.sse(
        (async function* (): AsyncGenerator<SseEvent> {
          for await (const line of job.log.stream(since))
            yield { event: 'log', id: line.seq, data: line };
          yield {
            event: 'done',
            data: {
              status: job.status,
              proposalId: job.proposalId ?? null,
              result: job.result ?? null,
            },
          };
        })(),
      );
    },
  );

  app.post(
    '/api/agents/jobs/:id/cancel',
    { preHandler: [app.requireScope('agents:run')] },
    async (req) => {
      const { id } = req.params as { id: string };
      return { ok: app.agentManager.cancel(id) };
    },
  );

  // Proposals are files under proposals/<id>; review goes through the CLI so the rules stay in one place.
  app.get('/api/proposals', { preHandler: [app.requireScope('agents:review')] }, async (req) => {
    const q = req.query as { project?: string; status?: string };
    const res = await runCliJson(app.config, [
      'proposals',
      'list',
      ...(q.project ? ['-p', q.project] : []),
      ...(q.status ? ['--status', q.status] : []),
    ]);
    return res.data ?? [];
  });

  app.get(
    '/api/proposals/:id',
    { preHandler: [app.requireScope('agents:review')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const res = await runCliJson(app.config, ['proposals', 'show', id]);
      if (!res.ok) throw notFound('Proposal');
      return res.data;
    },
  );

  app.post(
    '/api/proposals/:id/:action',
    { preHandler: [app.requireScope('agents:review')] },
    async (req) => {
      const { id, action } = req.params as { id: string; action: string };
      if (action !== 'accept' && action !== 'reject') throw notFound('Action');
      const body = (req.body ?? {}) as { branch?: string };
      const res = await runCliJson(app.config, [
        'proposals',
        action,
        id,
        ...(action === 'accept' && body.branch ? ['--branch', body.branch] : []),
      ]);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: `proposal.${action}`,
        targetType: 'proposal',
        targetId: id,
      });
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, result: res.data };
    },
  );
}

function view(j: ReturnType<FastifyInstance['agentManager']['get']> & object) {
  return {
    id: j.id,
    input: j.input,
    status: j.status,
    startedBy: j.startedBy,
    startedAt: new Date(j.startedAt).toISOString(),
    finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null,
    exitCode: j.exitCode ?? null,
    proposalId: j.proposalId ?? null,
  };
}

/**
 * `plan` and `spec` are handed to the CLI, which reads them from disk and streams the prompt (file
 * included) back through the job log. Taken verbatim, `spec: "/proc/self/environ"` returned the
 * server's secrets to any editor. Only a regular file inside the project, outside hidden
 * directories and dotfiles such as `.env.*`, is accepted; symlinks are resolved before checking.
 */
function projectFile(projectRoot: string, input: string, field: string): string {
  const reject = () =>
    badRequest(`${field} must be a file inside the project (for example docs/test-plans/x.md).`);
  const root = realpathSync(projectRoot);
  const candidate = resolve(root, input);
  if (!existsSync(candidate)) throw reject();
  const real = realpathSync(candidate);
  const rel = relative(root, real);
  if (!rel || isAbsolute(rel) || rel.split(sep).some((seg) => seg === '..' || seg.startsWith('.')))
    throw reject();
  if (!statSync(real).isFile()) throw reject();
  return real;
}
