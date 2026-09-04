import type { Kysely } from 'kysely';
import type {
  ModuleConfig,
  ProcessConfig,
  ProjectConfig,
  WorkspaceFile,
} from '@sdods/contracts/schemas';
import {
  effectiveWorkspaceRole,
  type OrgRole,
  type Role,
  type WorkspaceRole,
} from '@sdods/contracts/scopes';
import { enc, nowIso, readBool, readJson, readTs } from '../col.js';
import type { Driver } from '../driver.js';
import { newId } from '../ids.js';
import type { Database } from '../schema.js';
import { upsertProject } from './projects.js';

// ── organizations / workspaces ────────────────────────────────────────────
export async function upsertOrganization(
  db: Kysely<Database>,
  input: { slug: string; name: string; description?: string | null; url?: string | null },
): Promise<string> {
  const existing = await db
    .selectFrom('organizations')
    .select(['id'])
    .where('slug', '=', input.slug)
    .executeTakeFirst();
  const values = {
    name: input.name,
    description: input.description ?? null,
    url: input.url ?? null,
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('organizations').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('organizations')
    .values({ id, slug: input.slug, created_at: nowIso(), ...values })
    .execute();
  return id;
}

export async function upsertWorkspace(
  db: Kysely<Database>,
  input: { organizationId: string; slug: string; name: string; description?: string | null },
): Promise<string> {
  const existing = await db
    .selectFrom('workspaces')
    .select(['id'])
    .where('organization_id', '=', input.organizationId)
    .where('slug', '=', input.slug)
    .executeTakeFirst();
  const values = { name: input.name, description: input.description ?? null, updated_at: nowIso() };
  if (existing) {
    await db.updateTable('workspaces').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('workspaces')
    .values({
      id,
      organization_id: input.organizationId,
      slug: input.slug,
      created_at: nowIso(),
      ...values,
    })
    .execute();
  return id;
}

export async function listOrganizations(db: Kysely<Database>) {
  const rows = await db.selectFrom('organizations').selectAll().orderBy('slug').execute();
  return rows.map((o) => ({
    id: o.id,
    slug: o.slug,
    name: o.name,
    description: o.description,
    url: o.url,
    createdAt: readTs(o.created_at),
  }));
}

export async function listWorkspaces(db: Kysely<Database>, organizationId?: string) {
  let q = db
    .selectFrom('workspaces')
    .innerJoin('organizations', 'organizations.id', 'workspaces.organization_id')
    .selectAll('workspaces')
    .select('organizations.slug as org_slug')
    .orderBy('workspaces.slug');
  if (organizationId) q = q.where('workspaces.organization_id', '=', organizationId);
  const rows = await q.execute();
  return rows.map(mapWorkspace);
}

export async function getWorkspaceBySlug(db: Kysely<Database>, orgSlug: string, slug: string) {
  const row = await db
    .selectFrom('workspaces')
    .innerJoin('organizations', 'organizations.id', 'workspaces.organization_id')
    .selectAll('workspaces')
    .select('organizations.slug as org_slug')
    .where('organizations.slug', '=', orgSlug)
    .where('workspaces.slug', '=', slug)
    .executeTakeFirst();
  return row ? mapWorkspace(row) : null;
}

function mapWorkspace(w: any) {
  return {
    id: w.id as string,
    organizationId: w.organization_id as string,
    organizationSlug: w.org_slug as string,
    slug: w.slug as string,
    name: w.name as string,
    description: w.description as string | null,
    createdAt: readTs(w.created_at),
  };
}

// ── memberships ───────────────────────────────────────────────────────────
export async function addOrgMember(
  db: Kysely<Database>,
  organizationId: string,
  userId: string,
  role: OrgRole,
): Promise<void> {
  const existing = await db
    .selectFrom('org_members')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing) {
    await db.updateTable('org_members').set({ role }).where('id', '=', existing.id).execute();
    return;
  }
  await db
    .insertInto('org_members')
    .values({
      id: newId(),
      organization_id: organizationId,
      user_id: userId,
      role,
      created_at: nowIso(),
    })
    .execute();
}

export async function removeOrgMember(
  db: Kysely<Database>,
  organizationId: string,
  userId: string,
): Promise<void> {
  await db
    .deleteFrom('org_members')
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .execute();
}

export async function addWorkspaceMember(
  db: Kysely<Database>,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const existing = await db
    .selectFrom('workspace_members')
    .select(['id'])
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing) {
    await db.updateTable('workspace_members').set({ role }).where('id', '=', existing.id).execute();
    return;
  }
  await db
    .insertInto('workspace_members')
    .values({ id: newId(), workspace_id: workspaceId, user_id: userId, role, created_at: nowIso() })
    .execute();
}

export async function removeWorkspaceMember(
  db: Kysely<Database>,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await db
    .deleteFrom('workspace_members')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .execute();
}

/** `setRole` for either level. */
export async function setRole(
  db: Kysely<Database>,
  target:
    | { organizationId: string; userId: string; role: OrgRole }
    | { workspaceId: string; userId: string; role: WorkspaceRole },
): Promise<void> {
  if ('organizationId' in target)
    return addOrgMember(db, target.organizationId, target.userId, target.role);
  return addWorkspaceMember(db, target.workspaceId, target.userId, target.role);
}

export async function listOrgMembers(db: Kysely<Database>, organizationId: string) {
  const rows = await db
    .selectFrom('org_members')
    .innerJoin('users', 'users.id', 'org_members.user_id')
    .select([
      'org_members.id as id',
      'org_members.user_id as user_id',
      'users.username as username',
      'org_members.role as role',
      'org_members.created_at as created_at',
    ])
    .where('org_members.organization_id', '=', organizationId)
    .orderBy('users.username')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    role: r.role as OrgRole,
    createdAt: readTs(r.created_at),
  }));
}

export async function listWorkspaceMembers(db: Kysely<Database>, workspaceId: string) {
  const rows = await db
    .selectFrom('workspace_members')
    .innerJoin('users', 'users.id', 'workspace_members.user_id')
    .select([
      'workspace_members.id as id',
      'workspace_members.user_id as user_id',
      'users.username as username',
      'workspace_members.role as role',
      'workspace_members.created_at as created_at',
    ])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .orderBy('users.username')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    role: r.role as WorkspaceRole,
    createdAt: readTs(r.created_at),
  }));
}

export async function listUserOrgs(db: Kysely<Database>, userId: string) {
  const rows = await db
    .selectFrom('org_members')
    .innerJoin('organizations', 'organizations.id', 'org_members.organization_id')
    .select([
      'organizations.id as id',
      'organizations.slug as slug',
      'organizations.name as name',
      'org_members.role as role',
    ])
    .where('org_members.user_id', '=', userId)
    .orderBy('organizations.slug')
    .execute();
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, role: r.role as OrgRole }));
}

/**
 * Every workspace the user can see with the effective role (max of explicit workspace role and the
 * role implied by org membership; platform admins see everything as admin).
 */
export async function listUserWorkspaces(
  db: Kysely<Database>,
  userId: string,
  platformRole?: Role,
) {
  const orgRoles = new Map<string, OrgRole>();
  for (const o of await listUserOrgs(db, userId)) orgRoles.set(o.id, o.role);
  const wsRoles = new Map<string, WorkspaceRole>();
  const memberships = await db
    .selectFrom('workspace_members')
    .select(['workspace_id', 'role'])
    .where('user_id', '=', userId)
    .execute();
  for (const m of memberships) wsRoles.set(m.workspace_id, m.role as WorkspaceRole);
  const all = await listWorkspaces(db);
  const out: Array<ReturnType<typeof mapWorkspace> & { role: WorkspaceRole }> = [];
  for (const w of all) {
    const role = effectiveWorkspaceRole({
      platformRole,
      orgRole: orgRoles.get(w.organizationId),
      workspaceRole: wsRoles.get(w.id),
    });
    if (role) out.push({ ...w, role });
  }
  return out;
}

export async function effectiveRoleForWorkspace(
  db: Kysely<Database>,
  userId: string,
  workspaceId: string,
  platformRole?: Role,
): Promise<WorkspaceRole | null> {
  const ws = await db
    .selectFrom('workspaces')
    .select(['organization_id'])
    .where('id', '=', workspaceId)
    .executeTakeFirst();
  if (!ws) return null;
  const org = await db
    .selectFrom('org_members')
    .select(['role'])
    .where('organization_id', '=', ws.organization_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  const m = await db
    .selectFrom('workspace_members')
    .select(['role'])
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return effectiveWorkspaceRole({
    platformRole,
    orgRole: org?.role as OrgRole | undefined,
    workspaceRole: m?.role as WorkspaceRole | undefined,
  });
}

/** Grant `owner` on every organization that has no owner yet (admin bootstrap). */
export async function bootstrapOwner(db: Kysely<Database>, userId: string): Promise<string[]> {
  const orgs = await db.selectFrom('organizations').select(['id', 'slug']).execute();
  const granted: string[] = [];
  for (const o of orgs) {
    const owner = await db
      .selectFrom('org_members')
      .select(['id'])
      .where('organization_id', '=', o.id)
      .where('role', '=', 'owner')
      .executeTakeFirst();
    if (owner) continue;
    await addOrgMember(db, o.id, userId, 'owner');
    granted.push(o.slug);
  }
  return granted;
}

// ── modules / processes ───────────────────────────────────────────────────
export async function upsertModule(
  db: Kysely<Database>,
  projectId: string,
  m: ModuleConfig,
): Promise<string> {
  const existing = await db
    .selectFrom('modules')
    .select(['id'])
    .where('project_id', '=', projectId)
    .where('name', '=', m.name)
    .executeTakeFirst();
  const values = {
    title: m.title ?? null,
    description: m.description ?? null,
    path: m.path ?? m.name,
    layers_json: enc.json(m.layers ?? []),
    testing_types_json: enc.json(m.testingTypes ?? []),
    tags_json: enc.json(m.tags ?? []),
    owner: m.owner ?? null,
    jira_component: m.jiraComponent ?? null,
    routes_json: enc.json(m.routes ?? []),
    endpoints_json: enc.json(m.endpoints ?? []),
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('modules').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('modules')
    .values({ id, project_id: projectId, name: m.name, created_at: nowIso(), ...values })
    .execute();
  return id;
}

export async function listModules(db: Kysely<Database>, projectId: string) {
  const rows = await db
    .selectFrom('modules')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('name')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    description: r.description,
    path: r.path,
    layers: readJson<string[]>(r.layers_json) ?? [],
    testingTypes: readJson<string[]>(r.testing_types_json) ?? [],
    tags: readJson<string[]>(r.tags_json) ?? [],
    owner: r.owner,
    jiraComponent: r.jira_component,
    routes: readJson<string[]>(r.routes_json) ?? [],
    endpoints: readJson<string[]>(r.endpoints_json) ?? [],
  }));
}

export async function upsertProcess(
  db: Kysely<Database>,
  driver: Driver,
  scope: { projectId?: string | null; workspaceId?: string | null },
  p: ProcessConfig,
): Promise<string> {
  let q = db.selectFrom('processes').select(['id']).where('name', '=', p.name);
  q = scope.projectId
    ? q.where('project_id', '=', scope.projectId)
    : q.where('project_id', 'is', null).where('workspace_id', '=', scope.workspaceId ?? null);
  const existing = await q.executeTakeFirst();
  const { name: _n, title, description, trigger, ...config } = p;
  const values = {
    title: title ?? null,
    description: description ?? null,
    trigger: trigger ?? 'manual',
    config_json: enc.json(config),
    enabled: enc.bool(driver, true) as number,
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('processes').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('processes')
    .values({
      id,
      project_id: scope.projectId ?? null,
      workspace_id: scope.workspaceId ?? null,
      name: p.name,
      last_run_id: null,
      last_status: null,
      created_at: nowIso(),
      ...values,
    })
    .execute();
  return id;
}

export async function listProcesses(
  db: Kysely<Database>,
  scope: { projectId?: string; workspaceId?: string } = {},
) {
  let q = db.selectFrom('processes').selectAll().orderBy('name');
  if (scope.projectId) q = q.where('project_id', '=', scope.projectId);
  if (scope.workspaceId) q = q.where('workspace_id', '=', scope.workspaceId);
  const rows = await q.execute();
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    workspaceId: r.workspace_id,
    name: r.name,
    title: r.title,
    description: r.description,
    trigger: r.trigger,
    config: readJson<Record<string, unknown>>(r.config_json) ?? {},
    enabled: readBool(r.enabled),
    lastRunId: r.last_run_id,
    lastStatus: r.last_status,
  }));
}

export async function updateProcessState(
  db: Kysely<Database>,
  id: string,
  patch: { lastRunId?: string | null; lastStatus?: string | null },
) {
  await db
    .updateTable('processes')
    .set({
      last_run_id: patch.lastRunId ?? null,
      last_status: patch.lastStatus ?? null,
      updated_at: nowIso(),
    })
    .where('id', '=', id)
    .execute();
}

// ── sync from yaml ────────────────────────────────────────────────────────
export interface SyncHierarchyInput {
  workspaceFile?: WorkspaceFile | null;
  projects: Array<{ config: ProjectConfig; root?: string }>;
}

export interface SyncHierarchyResult {
  organizationId: string | null;
  workspaces: Record<string, string>;
  projects: Record<string, string>;
  modules: number;
  processes: number;
}

/** Upsert organization → workspaces → projects → modules/processes from the yaml files. */
export async function syncHierarchy(
  db: Kysely<Database>,
  driver: Driver,
  input: SyncHierarchyInput,
): Promise<SyncHierarchyResult> {
  const result: SyncHierarchyResult = {
    organizationId: null,
    workspaces: {},
    projects: {},
    modules: 0,
    processes: 0,
  };
  const wf = input.workspaceFile ?? null;
  let defaultWorkspaceId: string | null = null;
  if (wf) {
    result.organizationId = await upsertOrganization(db, wf.organization);
    for (const ws of wf.workspaces) {
      const id = await upsertWorkspace(db, {
        organizationId: result.organizationId,
        slug: ws.slug,
        name: ws.name,
        description: ws.description ?? null,
      });
      result.workspaces[ws.slug] = id;
      for (const p of wf.defaults.processes) {
        await upsertProcess(db, driver, { workspaceId: id }, p);
        result.processes++;
      }
    }
    defaultWorkspaceId = result.workspaces[wf.defaultWorkspace] ?? null;
  }
  for (const { config, root } of input.projects) {
    const workspaceId =
      (config.workspace && result.workspaces[config.workspace]) || defaultWorkspaceId;
    const projectId = await upsertProject(db, driver, {
      slug: config.slug,
      name: config.name,
      workspaceId,
      description: config.description ?? null,
      rootPath: root ?? null,
      config: config as unknown as Record<string, unknown>,
      layers: config.layers,
      browsers: config.browsers,
      tagsPolicy: config.tags as unknown as Record<string, unknown>,
      screenshotPolicy: config.screenshots as unknown as Record<string, unknown>,
    });
    result.projects[config.slug] = projectId;
    for (const m of config.modules ?? []) {
      await upsertModule(db, projectId, m);
      result.modules++;
    }
    for (const p of config.processes ?? []) {
      await upsertProcess(db, driver, { projectId }, p);
      result.processes++;
    }
  }
  return result;
}
