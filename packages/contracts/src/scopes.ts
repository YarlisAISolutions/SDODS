export const SCOPES = [
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
  'features:read',
  'features:write',
  'agents:run',
  'agents:review',
  'integrations:read',
  'integrations:write',
  'schedules:read',
  'schedules:write',
  'users:admin',
  'audit:read',
] as const;

export type Scope = (typeof SCOPES)[number];

export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const READ_SCOPES = SCOPES.filter((s) => s.endsWith(':read')) as Scope[];

export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  viewer: [...READ_SCOPES, 'artifacts:read'],
  editor: [
    ...READ_SCOPES,
    'artifacts:read',
    'runs:write',
    'runs:ingest',
    'features:write',
    'datasets:write',
    'envs:write',
    'schedules:write',
    'agents:run',
    'agents:review',
  ],
  admin: [...SCOPES],
};

export function scopesForRole(role: Role): Scope[] {
  return [...new Set(ROLE_SCOPES[role])];
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
