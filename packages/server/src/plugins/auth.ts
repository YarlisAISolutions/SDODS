import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import {
  API_TOKEN_PREFIX,
  ORG_ROLE_TO_WORKSPACE_ROLE,
  effectiveWorkspaceRole,
  scopesForRole,
  scopesForWorkspaceRole,
  type OrgRole,
  type Role,
  type WorkspaceRole,
} from '@automax/contracts';
import { getSession, getUserById, resolveApiToken, touchSession } from '@automax/db';
import { forbidden, unauthorized } from '../errors.js';
import type { Principal } from '../types.js';

export const SESSION_COOKIE = 'automax_sid';
const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2 };
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/setup-status',
  '/api/mcp/info',
]);

export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(cookie, { secret: app.config.sessionSecret });
  await app.register(rateLimit, { global: false });
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (req) => {
    req.principal = await resolvePrincipal(app, req);
  });

  // Auth gate for /api/* (public paths exempt); static assets are open on localhost deployments.
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/')) return;
    if (PUBLIC_PATHS.has(path)) return;
    if (!req.principal) throw unauthorized();
    if (req.principal.via === 'session' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const header = req.headers['x-csrf-token'];
      if (!header || header !== req.principal.csrfToken)
        throw forbidden('Missing or invalid CSRF token.');
    }
  });

  app.decorate('requireScope', (scope: string) => async (req: FastifyRequest) => {
    if (!req.principal) throw unauthorized();
    if (!req.principal.scopes.includes(scope)) throw forbidden(`Scope ${scope} required.`);
  });

  app.decorate('workspaceRoleFor', async (principal: Principal, workspaceId: string | null) => {
    if (principal.role === 'admin') return 'admin' as WorkspaceRole;
    if (!workspaceId) return principal.role as WorkspaceRole; // ungrouped projects fall back to platform role
    const ws = await app.adb.db
      .selectFrom('workspaces')
      .select(['organization_id'])
      .where('id', '=', workspaceId)
      .executeTakeFirst();
    return effectiveWorkspaceRole({
      platformRole: principal.role,
      orgRole: ws ? principal.orgRoles[ws.organization_id] : undefined,
      workspaceRole: principal.workspaceRoles[workspaceId],
    });
  });

  app.decorate('workspaceRoleForProject', async (principal: Principal, slug: string) => {
    const project = await app.adb.db
      .selectFrom('projects')
      .select(['workspace_id'])
      .where('slug', '=', slug)
      .executeTakeFirst();
    return app.workspaceRoleFor(principal, project?.workspace_id ?? null);
  });

  app.decorate(
    'requireWorkspaceRole',
    (min: WorkspaceRole) => async (req: FastifyRequest, _reply: FastifyReply) => {
      if (!req.principal) throw unauthorized();
      const params = req.params as Record<string, string | undefined>;
      const slug = params.slug ?? params.project;
      const wsId = params.workspaceId;
      const role = slug
        ? await app.workspaceRoleForProject(req.principal, slug)
        : await app.workspaceRoleFor(req.principal, wsId ?? null);
      if (!role || ROLE_RANK[role] < ROLE_RANK[min])
        throw forbidden(`Workspace role ${min} required.`);
    },
  );
});

async function resolvePrincipal(
  app: FastifyInstance,
  req: FastifyRequest,
): Promise<Principal | null> {
  if (app.config.authDisabled) {
    return {
      userId: 'local',
      username: 'local',
      role: 'admin',
      scopes: scopesForRole('admin'),
      via: 'disabled',
      orgRoles: {},
      workspaceRoles: {},
    };
  }
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (!token.startsWith(API_TOKEN_PREFIX)) return null;
    const resolved = await resolveApiToken(app.adb.db, token);
    if (!resolved) return null;
    const memberships = await loadMemberships(app, resolved.userId);
    return {
      userId: resolved.userId,
      username: resolved.username,
      role: resolved.role,
      scopes: resolved.scopes,
      via: 'token',
      tokenId: resolved.tokenId,
      ...memberships,
    };
  }
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  const token = unsigned.valid ? unsigned.value : raw;
  if (!token) return null;
  const session = await getSession(app.adb.db, token);
  if (!session) return null;
  const user = await getUserById(app.adb.db, session.userId);
  if (!user || !user.active) return null;
  if (Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60_000)
    await touchSession(app.adb.db, token, app.config.sessionTtlMs);
  const memberships = await loadMemberships(app, user.id);
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    scopes: effectiveScopes(user.role, memberships),
    via: 'session',
    sessionToken: token,
    csrfToken: session.csrfToken,
    ...memberships,
  };
}

async function loadMemberships(app: FastifyInstance, userId: string) {
  const orgRows = await app.adb.db
    .selectFrom('org_members')
    .select(['organization_id', 'role'])
    .where('user_id', '=', userId)
    .execute();
  const wsRows = await app.adb.db
    .selectFrom('workspace_members')
    .select(['workspace_id', 'role'])
    .where('user_id', '=', userId)
    .execute();
  const orgRoles: Record<string, OrgRole> = {};
  for (const r of orgRows) orgRoles[r.organization_id] = r.role as OrgRole;
  const workspaceRoles: Record<string, WorkspaceRole> = {};
  for (const r of wsRows) workspaceRoles[r.workspace_id] = r.role as WorkspaceRole;
  return { orgRoles, workspaceRoles };
}

/**
 * Scopes = platform role scopes ∪ scopes implied by the strongest membership. Per-project routes
 * still check the effective workspace role, so an editor in one workspace cannot act in another.
 */
function effectiveScopes(
  role: Role,
  m: { orgRoles: Record<string, OrgRole>; workspaceRoles: Record<string, WorkspaceRole> },
): string[] {
  const set = new Set<string>(scopesForRole(role));
  const wsRoles: WorkspaceRole[] = [
    ...Object.values(m.workspaceRoles),
    ...Object.values(m.orgRoles).map((r) => ORG_ROLE_TO_WORKSPACE_ROLE[r]),
  ];
  for (const r of wsRoles) for (const s of scopesForWorkspaceRole(r)) set.add(s);
  for (const r of Object.values(m.orgRoles))
    if (r === 'owner' || r === 'admin') set.add('workspaces:write').add('orgs:admin');
  return [...set];
}
