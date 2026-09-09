export const SCOPES = [
  'orgs:read',
  'orgs:admin',
  'workspaces:read',
  'workspaces:write',
  'projects:read',
  'projects:write',
  'envs:read',
  'envs:write',
  'datasets:read',
  'datasets:write',
  'runs:read',
  'runs:write',
  'runs:ingest',
  'artifacts:read',
  'browser:read',
  'browser:write',
  // Arbitrary code in the page or the Playwright process. Admin-only, and additionally gated by
  // SDODS_BROWSER_ALLOW_UNSAFE so a deployment can remove it entirely.
  'browser:admin',
  'features:read',
  'features:write',
  'agents:run',
  'agents:review',
  'integrations:read',
  'integrations:write',
  'schedules:read',
  'schedules:write',
  'processes:read',
  'processes:write',
  'users:admin',
  'audit:read',
] as const;

export type Scope = (typeof SCOPES)[number];

/** Platform-wide roles (a user's baseline). */
export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Organization membership roles. */
export const ORG_ROLES = ['member', 'admin', 'owner'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Workspace membership roles. */
export const WORKSPACE_ROLES = ['viewer', 'editor', 'admin'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const READ_SCOPES = SCOPES.filter((s) => s.endsWith(':read')) as Scope[];

export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  viewer: [...READ_SCOPES, 'artifacts:read'],
  editor: [
    ...READ_SCOPES,
    'artifacts:read',
    'runs:write',
    'runs:ingest',
    'browser:write',
    'features:write',
    'datasets:write',
    'envs:write',
    'schedules:write',
    'processes:write',
    'agents:run',
    'agents:review',
  ],
  admin: [...SCOPES],
};

/** Org role → implied workspace role for every workspace in that org. */
export const ORG_ROLE_TO_WORKSPACE_ROLE: Record<OrgRole, WorkspaceRole> = {
  member: 'viewer',
  admin: 'admin',
  owner: 'admin',
};

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2 };

/**
 * Effective role inside a workspace = the higher of the explicit workspace membership and the
 * role implied by the organization membership. Platform admins are admin everywhere.
 */
export function effectiveWorkspaceRole(input: {
  platformRole?: Role;
  orgRole?: OrgRole;
  workspaceRole?: WorkspaceRole;
}): WorkspaceRole | null {
  if (input.platformRole === 'admin') return 'admin';
  const candidates: WorkspaceRole[] = [];
  if (input.workspaceRole) candidates.push(input.workspaceRole);
  if (input.orgRole) candidates.push(ORG_ROLE_TO_WORKSPACE_ROLE[input.orgRole]);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0]!;
}

export function scopesForRole(role: Role): Scope[] {
  return [...new Set(ROLE_SCOPES[role])];
}

export function scopesForWorkspaceRole(role: WorkspaceRole): Scope[] {
  // workspace roles map 1:1 onto the platform role scope sets, minus platform-only scopes
  const base = scopesForRole(role);
  return base.filter((s) => s !== 'users:admin' && s !== 'orgs:admin');
}

export function isScope(v: string): v is Scope {
  return (SCOPES as readonly string[]).includes(v);
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required);
}

/** Tool access levels map onto scopes so the MCP registry can gate uniformly. */
export type ToolAccess = 'read' | 'run' | 'write';

export function scopeForToolAccess(access: ToolAccess, domain: string): Scope | null {
  const candidate = `${domain}:${access === 'read' ? 'read' : 'write'}`;
  return isScope(candidate) ? candidate : null;
}

export const API_TOKEN_PREFIX = 'amx_';
