import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  API_TOKEN_PREFIX,
  ROLES,
  isScope,
  scopesForRole,
  type Role,
  type Scope,
} from '@sdods/contracts/scopes';
import { enc, nowIso, readBool, readJson, readTs } from '../col.js';
import type { Driver } from '../driver.js';
import { newId } from '../ids.js';
import type { Database } from '../schema.js';

/** Seed the three built-in roles (idempotent). */
export async function ensureRoles(db: Kysely<Database>): Promise<Record<Role, string>> {
  const out = {} as Record<Role, string>;
  for (const name of ROLES) {
    const existing = await db
      .selectFrom('roles')
      .select(['id'])
      .where('name', '=', name)
      .executeTakeFirst();
    if (existing) {
      out[name] = existing.id;
      continue;
    }
    const id = newId();
    await db
      .insertInto('roles')
      .values({ id, name, permissions_json: enc.json(scopesForRole(name)), created_at: nowIso() })
      .execute();
    out[name] = id;
  }
  return out;
}

export async function createUser(
  db: Kysely<Database>,
  driver: Driver,
  input: {
    username: string;
    passwordHash: string;
    role: Role;
    email?: string | null;
    authProvider?: string;
    externalId?: string | null;
  },
): Promise<string> {
  const roles = await ensureRoles(db);
  const id = newId();
  await db
    .insertInto('users')
    .values({
      id,
      username: input.username,
      email: input.email ?? null,
      password_hash: input.passwordHash,
      role_id: roles[input.role],
      active: enc.bool(driver, true) as number,
      auth_provider: input.authProvider ?? 'local',
      external_id: input.externalId ?? null,
      last_login_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .execute();
  return id;
}

export async function getUserByUsername(db: Kysely<Database>, username: string) {
  const row = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .selectAll('users')
    .select('roles.name as role')
    .where('users.username', '=', username)
    .executeTakeFirst();
  return row ? mapUser(row) : null;
}

export async function getUserById(db: Kysely<Database>, id: string) {
  const row = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .selectAll('users')
    .select('roles.name as role')
    .where('users.id', '=', id)
    .executeTakeFirst();
  return row ? mapUser(row) : null;
}

export async function listUsers(db: Kysely<Database>) {
  const rows = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .selectAll('users')
    .select('roles.name as role')
    .orderBy('users.username')
    .execute();
  return rows.map(mapUser);
}

export async function updateUser(
  db: Kysely<Database>,
  driver: Driver,
  id: string,
  patch: {
    passwordHash?: string;
    role?: Role;
    active?: boolean;
    email?: string | null;
    lastLoginAt?: string;
  },
) {
  const roles = patch.role ? await ensureRoles(db) : undefined;
  await db
    .updateTable('users')
    .set({
      ...(patch.passwordHash ? { password_hash: patch.passwordHash } : {}),
      ...(roles && patch.role ? { role_id: roles[patch.role] } : {}),
      ...(patch.active !== undefined ? { active: enc.bool(driver, patch.active) as number } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.lastLoginAt ? { last_login_at: patch.lastLoginAt } : {}),
      updated_at: nowIso(),
    })
    .where('id', '=', id)
    .execute();
}

export async function countUsers(db: Kysely<Database>): Promise<number> {
  const r = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

function mapUser(row: any) {
  return {
    id: row.id as string,
    username: row.username as string,
    email: row.email as string | null,
    passwordHash: row.password_hash as string,
    role: row.role as Role,
    active: readBool(row.active),
    authProvider: row.auth_provider as string,
    lastLoginAt: readTs(row.last_login_at),
    createdAt: readTs(row.created_at),
  };
}

// ── sessions ──────────────────────────────────────────────────────────────
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Kysely<Database>,
  input: { userId: string; ttlMs: number; ip?: string | null; userAgent?: string | null },
) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const now = nowIso();
  await db
    .insertInto('sessions')
    .values({
      id: hashToken(token),
      user_id: input.userId,
      csrf_token: csrf,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      created_at: now,
      expires_at: new Date(Date.now() + input.ttlMs).toISOString(),
      last_seen_at: now,
    })
    .execute();
  return { token, csrfToken: csrf };
}

export async function getSession(db: Kysely<Database>, token: string) {
  const row = await db
    .selectFrom('sessions')
    .selectAll()
    .where('id', '=', hashToken(token))
    .executeTakeFirst();
  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() < Date.now()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    expiresAt: readTs(row.expires_at)!,
    lastSeenAt: readTs(row.last_seen_at)!,
  };
}

export async function touchSession(db: Kysely<Database>, token: string, ttlMs: number) {
  await db
    .updateTable('sessions')
    .set({ last_seen_at: nowIso(), expires_at: new Date(Date.now() + ttlMs).toISOString() })
    .where('id', '=', hashToken(token))
    .execute();
}

export async function deleteSession(db: Kysely<Database>, token: string) {
  await db.deleteFrom('sessions').where('id', '=', hashToken(token)).execute();
}

export async function purgeExpiredSessions(db: Kysely<Database>) {
  await db.deleteFrom('sessions').where('expires_at', '<', nowIso()).execute();
}

// ── api tokens (free, scoped) ─────────────────────────────────────────────
export async function createApiToken(
  db: Kysely<Database>,
  input: {
    userId: string;
    name: string;
    scopes: string[];
    expiresInDays?: number | null;
    ownerRole: Role;
  },
): Promise<{ token: string; id: string; prefix: string; scopes: Scope[] }> {
  const allowed = new Set(scopesForRole(input.ownerRole));
  const scopes = input.scopes.filter((s): s is Scope => isScope(s));
  const denied = scopes.filter((s) => !allowed.has(s));
  if (denied.length) throw new Error(`Scopes exceed the owner's role: ${denied.join(', ')}`);
  const token =
    API_TOKEN_PREFIX +
    randomBytes(32)
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 40);
  const id = newId();
  await db
    .insertInto('api_tokens')
    .values({
      id,
      user_id: input.userId,
      name: input.name,
      token_prefix: token.slice(0, 12),
      hash: hashToken(token),
      scopes_json: enc.json(scopes),
      expires_at: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
        : null,
      last_used_at: null,
      revoked_at: null,
      created_at: nowIso(),
    })
    .execute();
  return { token, id, prefix: token.slice(0, 12), scopes };
}

/** Resolve a bearer token to its owner and effective scopes (intersection with the owner's current role). */
export async function resolveApiToken(db: Kysely<Database>, token: string) {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const row = await db
    .selectFrom('api_tokens')
    .selectAll()
    .where('hash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(String(row.expires_at)).getTime() < Date.now()) return null;
  const user = await getUserById(db, row.user_id);
  if (!user || !user.active) return null;
  const roleScopes = new Set(scopesForRole(user.role));
  const scopes = (readJson<string[]>(row.scopes_json) ?? []).filter(
    (s): s is Scope => isScope(s) && roleScopes.has(s),
  );
  const last = readTs(row.last_used_at);
  if (!last || Date.now() - new Date(last).getTime() > 5 * 60_000) {
    await db
      .updateTable('api_tokens')
      .set({ last_used_at: nowIso() })
      .where('id', '=', row.id)
      .execute();
  }
  return { tokenId: row.id, userId: user.id, username: user.username, role: user.role, scopes };
}

export async function listApiTokens(db: Kysely<Database>, userId?: string) {
  let q = db
    .selectFrom('api_tokens')
    .innerJoin('users', 'users.id', 'api_tokens.user_id')
    .selectAll('api_tokens')
    .select('users.username as username')
    .orderBy('api_tokens.created_at', 'desc');
  if (userId) q = q.where('api_tokens.user_id', '=', userId);
  const rows = await q.execute();
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    name: r.name,
    prefix: r.token_prefix,
    scopes: readJson<string[]>(r.scopes_json) ?? [],
    expiresAt: readTs(r.expires_at),
    lastUsedAt: readTs(r.last_used_at),
    revokedAt: readTs(r.revoked_at),
    createdAt: readTs(r.created_at),
  }));
}

/** True when a live token was revoked; false when the id is unknown or already revoked. */
export async function revokeApiToken(db: Kysely<Database>, id: string): Promise<boolean> {
  const res = await db
    .updateTable('api_tokens')
    .set({ revoked_at: nowIso() })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(res?.numUpdatedRows ?? 0) > 0;
}
