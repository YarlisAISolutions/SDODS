import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getRun } from '@sdods/db';
import { runFiles } from '@sdods/contracts';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.js';

/**
 * A run id names one directory directly under the artifacts root. `.` and `..` match the old
 * `[A-Za-z0-9._-]+` pattern, and the router decodes `%2E%2E` before this check sees it, so
 * `/api/runs/%2E%2E/files/sdods.db` used to read the platform database. A leading dot is refused
 * outright: no generated id starts with one.
 */
export function isRunId(id: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(id);
}

export function runDir(artifactsDir: string, id: string): string {
  if (!isRunId(id)) throw badRequest('Invalid run id.');
  return join(artifactsDir, id);
}

/** The project a run belongs to: the database row, a live job, or the run's own manifest. */
export async function projectOfRun(app: FastifyInstance, id: string): Promise<string | null> {
  const row = await getRun(app.adb.db, id);
  if (row) return row.projectSlug;
  const live = app.runManager.get(id);
  if (live) return live.input.project;
  const manifest = join(runDir(app.config.artifactsDir, id), runFiles.manifest);
  if (!existsSync(manifest)) return null;
  try {
    const slug = (JSON.parse(readFileSync(manifest, 'utf8')) as { projectSlug?: unknown })
      .projectSlug;
    return typeof slug === 'string' ? slug : null;
  } catch {
    return null;
  }
}

/**
 * Run files used to be readable by anyone holding `artifacts:read`, whatever workspace the run
 * belonged to. A run with no traceable project is visible to platform admins only.
 */
export async function assertRunAccess(
  app: FastifyInstance,
  req: FastifyRequest,
  id: string,
): Promise<void> {
  if (!req.principal) throw unauthorized();
  const slug = await projectOfRun(app, id);
  if (!slug) {
    if (req.principal.role === 'admin') return;
    throw notFound('Run');
  }
  const role = await app.workspaceRoleForProject(req.principal, slug);
  if (!role) throw forbidden('No access to this project.');
}

const ACTIVE_CONTENT = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml']);

/**
 * Run directories hold content that arrived from CI uploads. Served from the app's own origin,
 * an uploaded page could read the CSRF token from /api/auth/me and act as whoever opened it.
 * `sandbox` without `allow-same-origin` gives such a document an opaque origin: its scripts still
 * run (the SDODS dashboard needs them) but cannot reach the API with the viewer's cookie.
 */
export function hardenFileReply(reply: FastifyReply, path: string): void {
  reply.header('x-content-type-options', 'nosniff');
  if (ACTIVE_CONTENT.has(extname(path).toLowerCase()))
    reply.header('content-security-policy', 'sandbox allow-scripts allow-popups allow-downloads');
}
