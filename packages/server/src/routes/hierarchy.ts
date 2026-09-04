import type { FastifyInstance } from 'fastify';
import {
  audit,
  createApiToken,
  createUser,
  getUserById,
  getUserByUsername,
  listApiTokens,
  listAudit,
  listUsers,
  revokeApiToken,
  updateUser,
  scopesForRole,
  hasScope,
} from '@automax/db';
import type { OrgRole, WorkspaceRole } from '@automax/contracts';
import {
  CreateTokenBody,
  CreateUserBody,
  CreateWorkspaceBody,
  OrgMemberBody,
  PatchUserBody,
  WorkspaceMemberBody,
} from '../schemas/index.js';
import { badRequest, forbidden, notFound, parse } from '../errors.js';
import { hashPassword, publicUser } from './auth.js';

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2 };

export async function hierarchyRoutes(app: FastifyInstance) {
  /**
   * `:orgId` / `:workspaceId` accept either the id or the slug (the web UI addresses
   * workspaces by slug). Resolved before route preHandlers (role checks) run.
   */
  app.addHook('preValidation', async (req) => {
    const params = req.params as Record<string, string | undefined>;
    if (params.orgId) {
      const orgs = await app.hierarchy.organizations();
      const hit =
        orgs.find((o) => o.id === params.orgId) ?? orgs.find((o) => o.slug === params.orgId);
      if (hit) params.orgId = hit.id;
    }
    if (params.workspaceId) {
      const all = await app.hierarchy.workspaces();
      const hit =
        all.find((w) => w.id === params.workspaceId) ??
        all.find((w) => w.slug === params.workspaceId);
      if (hit) params.workspaceId = hit.id;
    }
  });

  const resolveUserId = async (body: { userId?: string; username?: string }) => {
    if (body.userId) {
      if (!(await getUserById(app.adb.db, body.userId))) throw notFound('User');
      return body.userId;
    }
    const u = body.username ? await getUserByUsername(app.adb.db, body.username) : null;
    if (!u) throw notFound('User');
    return u.id;
  };
  // ── organizations ──────────────────────────────────────────────────────
  app.get('/api/orgs', { preHandler: [app.requireScope('orgs:read')] }, async (req) => {
    const p = req.principal!;
    const orgs = await app.hierarchy.organizations();
    return orgs
      .map((o) => ({ ...o, role: p.role === 'admin' ? 'owner' : (p.orgRoles[o.id] ?? null) }))
      .filter((o) => o.role);
  });

  app.get(
    '/api/orgs/:orgId/members',
    { preHandler: [app.requireScope('orgs:read')] },
    async (req) => {
      const { orgId } = req.params as { orgId: string };
      requireOrgAdmin(req.principal!, orgId);
      return app.hierarchy.orgMembers(orgId);
    },
  );

  app.post(
    '/api/orgs/:orgId/members',
    { preHandler: [app.requireScope('orgs:admin')] },
    async (req) => {
      const { orgId } = req.params as { orgId: string };
      requireOrgAdmin(req.principal!, orgId);
      const body = parse(OrgMemberBody, req.body);
      const userId = await resolveUserId(body);
      await app.hierarchy.setOrgRole(orgId, userId, body.role as OrgRole);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'org.member.set',
        targetType: 'organization',
        targetId: orgId,
        details: body,
      });
      return app.hierarchy.orgMembers(orgId);
    },
  );

  app.delete(
    '/api/orgs/:orgId/members/:userId',
    { preHandler: [app.requireScope('orgs:admin')] },
    async (req) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      requireOrgAdmin(req.principal!, orgId);
      await app.hierarchy.removeOrgMember(orgId, userId);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'org.member.remove',
        targetType: 'organization',
        targetId: orgId,
        details: { userId },
      });
      return { ok: true };
    },
  );

  // ── workspaces (many per org) with the caller's effective role ─────────
  app.get('/api/workspaces', { preHandler: [app.requireScope('workspaces:read')] }, async (req) => {
    const p = req.principal!;
    const list = await app.hierarchy.workspacesForUser(p.userId, p.role);
    const counts = await app.adb.db
      .selectFrom('projects')
      .select(['workspace_id'])
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .groupBy('workspace_id')
      .execute();
    const byWs = new Map(counts.map((c) => [c.workspace_id, Number(c.n)]));
    return list.map((w) => ({ ...w, projectCount: byWs.get(w.id) ?? 0 }));
  });

  /** Flat form of the create route: organization by id or slug in the body (default: the only org). */
  app.post(
    '/api/workspaces',
    { preHandler: [app.requireScope('workspaces:write')] },
    async (req, reply) => {
      const body = parse(CreateWorkspaceBody, req.body);
      const orgs = await app.hierarchy.organizations();
      const org = body.organization
        ? (orgs.find((o) => o.id === body.organization) ??
          orgs.find((o) => o.slug === body.organization))
        : orgs.length === 1
          ? orgs[0]
          : undefined;
      if (!org) throw badRequest('organization (id or slug) is required.');
      requireOrgAdmin(req.principal!, org.id);
      const { organization: _org, ...rest } = body;
      const id = await app.hierarchy.createWorkspace({ organizationId: org.id, ...rest });
      await app.hierarchy
        .setWorkspaceRole(id, req.principal!.userId, 'admin')
        .catch(() => undefined);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'workspace.create',
        targetType: 'workspace',
        targetId: id,
        details: rest,
      });
      reply.code(201);
      return { id, ...rest, organizationId: org.id, organizationSlug: org.slug };
    },
  );

  app.post(
    '/api/orgs/:orgId/workspaces',
    { preHandler: [app.requireScope('workspaces:write')] },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      requireOrgAdmin(req.principal!, orgId);
      const body = parse(CreateWorkspaceBody, req.body);
      const id = await app.hierarchy.createWorkspace({ organizationId: orgId, ...body });
      await app.hierarchy
        .setWorkspaceRole(id, req.principal!.userId, 'admin')
        .catch(() => undefined);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'workspace.create',
        targetType: 'workspace',
        targetId: id,
        details: body,
      });
      reply.code(201);
      return { id, ...body, organizationId: orgId };
    },
  );

  app.get(
    '/api/workspaces/:workspaceId',
    { preHandler: [app.requireScope('workspaces:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const ws = (await app.hierarchy.workspaces()).find((w) => w.id === workspaceId);
      if (!ws) throw notFound('Workspace');
      const projects = await app.adb.db
        .selectFrom('projects')
        .select(['id', 'slug', 'name', 'description'])
        .where('workspace_id', '=', workspaceId)
        .orderBy('slug')
        .execute();
      const role = await app.workspaceRoleFor(req.principal!, workspaceId);
      return { ...ws, role, projects };
    },
  );

  app.get(
    '/api/workspaces/:workspaceId/members',
    { preHandler: [app.requireScope('workspaces:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      return app.hierarchy.workspaceMembers(workspaceId);
    },
  );

  app.post(
    '/api/workspaces/:workspaceId/members',
    { preHandler: [app.requireScope('workspaces:write'), app.requireWorkspaceRole('admin')] },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const body = parse(WorkspaceMemberBody, req.body);
      const userId = await resolveUserId(body);
      await app.hierarchy.setWorkspaceRole(workspaceId, userId, body.role as WorkspaceRole);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'workspace.member.set',
        targetType: 'workspace',
        targetId: workspaceId,
        details: body,
      });
      return app.hierarchy.workspaceMembers(workspaceId);
    },
  );

  app.delete(
    '/api/workspaces/:workspaceId/members/:userId',
    { preHandler: [app.requireScope('workspaces:write'), app.requireWorkspaceRole('admin')] },
    async (req) => {
      const { workspaceId, userId } = req.params as { workspaceId: string; userId: string };
      await app.hierarchy.removeWorkspaceMember(workspaceId, userId);
      return { ok: true };
    },
  );

  app.post(
    '/api/hierarchy/sync',
    { preHandler: [app.requireScope('workspaces:write')] },
    async (req) => {
      if (req.principal!.role !== 'admin') throw forbidden('Platform admin required.');
      const registry = app.reloadRegistry();
      const result = await app.hierarchy.sync(registry);
      await app.scheduler.syncFromRegistry(registry);
      return result;
    },
  );

  // ── users (platform admin) ─────────────────────────────────────────────
  app.get('/api/users', { preHandler: [app.requireScope('users:admin')] }, async () =>
    (await listUsers(app.adb.db)).map(publicUser),
  );

  app.post('/api/users', { preHandler: [app.requireScope('users:admin')] }, async (req, reply) => {
    const body = parse(CreateUserBody, req.body);
    const id = await createUser(app.adb.db, app.adb.driver, {
      username: body.username,
      passwordHash: await hashPassword(body.password),
      role: body.role,
      email: body.email ?? null,
    });
    const ownerOf = body.orgOwner ? await app.hierarchy.bootstrapOwner(id) : [];
    await audit(app.adb.db, {
      actorUserId: req.principal!.userId,
      actorType: 'user',
      action: 'user.create',
      targetType: 'user',
      targetId: id,
      details: { username: body.username, role: body.role },
    });
    reply.code(201);
    return { id, username: body.username, role: body.role, ownerOf };
  });

  app.patch('/api/users/:id', { preHandler: [app.requireScope('users:admin')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(PatchUserBody, req.body);
    if (!(await getUserById(app.adb.db, id))) throw notFound('User');
    await updateUser(app.adb.db, app.adb.driver, id, {
      ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      role: body.role,
      active: body.active,
      email: body.email,
    });
    await audit(app.adb.db, {
      actorUserId: req.principal!.userId,
      actorType: 'user',
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      details: { role: body.role, active: body.active },
    });
    return publicUser((await getUserById(app.adb.db, id))!);
  });

  // ── API tokens (free, scoped; session-only management) ─────────────────
  app.get('/api/tokens', async (req) => {
    const p = req.principal!;
    const all = (req.query as { all?: string }).all === '1' && p.role === 'admin';
    return listApiTokens(app.adb.db, all ? undefined : p.userId);
  });

  app.post('/api/tokens', async (req, reply) => {
    const p = req.principal!;
    if (p.via === 'token') throw forbidden('Tokens cannot mint tokens; use a browser session.');
    const body = parse(CreateTokenBody, req.body);
    const targetUserId = body.userId && p.role === 'admin' ? body.userId : p.userId;
    const owner =
      targetUserId === p.userId
        ? { id: p.userId, role: p.role }
        : await getUserById(app.adb.db, targetUserId);
    if (!owner) throw notFound('User');
    const allowed = scopesForRole(owner.role);
    const denied = body.scopes.filter((s) => !hasScope(allowed, s));
    if (denied.length) throw badRequest(`Scopes exceed the owner's role: ${denied.join(', ')}`);
    const created = await createApiToken(app.adb.db, {
      userId: targetUserId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays ?? null,
      ownerRole: owner.role,
    });
    await audit(app.adb.db, {
      actorUserId: p.userId,
      actorType: 'user',
      action: 'token.create',
      targetType: 'api_token',
      targetId: created.id,
      details: { name: body.name, scopes: body.scopes },
    });
    reply.code(201);
    return { ...created, note: 'Store this token now; it is not shown again.' };
  });

  app.delete('/api/tokens/:id', async (req) => {
    const p = req.principal!;
    const { id } = req.params as { id: string };
    const mine = (await listApiTokens(app.adb.db, p.role === 'admin' ? undefined : p.userId)).find(
      (t) => t.id === id,
    );
    if (!mine) throw notFound('Token');
    await revokeApiToken(app.adb.db, id);
    await audit(app.adb.db, {
      actorUserId: p.userId,
      actorType: 'user',
      action: 'token.revoke',
      targetType: 'api_token',
      targetId: id,
    });
    return { ok: true };
  });

  app.get('/api/audit', { preHandler: [app.requireScope('audit:read')] }, async (req) => {
    const q = req.query as { limit?: string; before?: string };
    return listAudit(app.adb.db, { limit: q.limit ? Number(q.limit) : 100, before: q.before });
  });
}

function requireOrgAdmin(p: { role: string; orgRoles: Record<string, OrgRole> }, orgId: string) {
  if (p.role === 'admin') return;
  const r = p.orgRoles[orgId];
  if (r !== 'owner' && r !== 'admin') throw forbidden('Organization admin or owner required.');
}

export function rankOf(role: WorkspaceRole | null): number {
  return role ? ROLE_RANK[role] : -1;
}
