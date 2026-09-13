import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { enc, nowIso, readBool, readJson } from '../col.js';
import type { Driver } from '../driver.js';
import { newId } from '../ids.js';
import type { Database } from '../schema.js';

export interface ProjectUpsert {
  slug: string;
  name: string;
  workspaceId?: string | null;
  description?: string | null;
  rootPath?: string | null;
  config: Record<string, unknown>;
  layers: string[];
  browsers: string[];
  tagsPolicy?: Record<string, unknown>;
  screenshotPolicy?: Record<string, unknown>;
}

export function configHash(config: unknown): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16);
}

/** Insert or update a project by slug; returns its id. */
export async function upsertProject(
  db: Kysely<Database>,
  driver: Driver,
  p: ProjectUpsert,
): Promise<string> {
  const existing = await db
    .selectFrom('projects')
    .select(['id'])
    .where('slug', '=', p.slug)
    .executeTakeFirst();
  const values = {
    name: p.name,
    workspace_id: p.workspaceId ?? null,
    description: p.description ?? null,
    root_path: p.rootPath ?? null,
    config_json: enc.json(p.config),
    config_hash: configHash(p.config),
    layers_json: enc.json(p.layers),
    browsers_json: enc.json(p.browsers),
    tags_policy_json: enc.json(p.tagsPolicy ?? {}),
    screenshot_policy_json: enc.json(p.screenshotPolicy ?? {}),
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('projects').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('projects')
    .values({
      id,
      slug: p.slug,
      archived: enc.bool(driver, false) as number,
      created_at: nowIso(),
      ...values,
    })
    .execute();
  return id;
}

/**
 * Flag a project as archived (or bring it back).
 *
 * Deleting a project removes its directory but keeps this row: runs, results and insights all
 * reference `project_id`, so dropping it would erase the history the user came to the dashboard
 * for. `upsertProject` only writes `archived` on insert, so an existing row keeps whatever flag it
 * has -- which means re-creating a deleted slug has to clear it explicitly.
 */
export async function setProjectArchived(
  db: Kysely<Database>,
  driver: Driver,
  id: string,
  archived: boolean,
): Promise<void> {
  await db
    .updateTable('projects')
    .set({ archived: enc.bool(driver, archived) as number, updated_at: nowIso() })
    .where('id', '=', id)
    .execute();
}

/** Ensure a minimal project row exists (used by ingest when the registry is unavailable). */
export async function ensureProject(
  db: Kysely<Database>,
  driver: Driver,
  slug: string,
  name = slug,
): Promise<string> {
  const existing = await db
    .selectFrom('projects')
    .select(['id'])
    .where('slug', '=', slug)
    .executeTakeFirst();
  if (existing) return existing.id;
  return upsertProject(db, driver, { slug, name, config: {}, layers: [], browsers: [] });
}

export async function getProjectBySlug(db: Kysely<Database>, slug: string) {
  const row = await db
    .selectFrom('projects')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst();
  return row ? mapProject(row) : null;
}

export async function listProjects(db: Kysely<Database>) {
  const rows = await db.selectFrom('projects').selectAll().orderBy('slug').execute();
  return rows.map(mapProject);
}

export function mapProject(row: any) {
  return {
    id: row.id as string,
    workspaceId: (row.workspace_id ?? null) as string | null,
    slug: row.slug as string,
    name: row.name as string,
    description: row.description as string | null,
    rootPath: row.root_path as string | null,
    config: readJson<Record<string, unknown>>(row.config_json) ?? {},
    configHash: row.config_hash as string | null,
    layers: readJson<string[]>(row.layers_json) ?? [],
    browsers: readJson<string[]>(row.browsers_json) ?? [],
    archived: readBool(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function upsertEnvironment(
  db: Kysely<Database>,
  driver: Driver,
  input: {
    projectId: string;
    name: string;
    baseUrl?: string | null;
    apiBaseUrl?: string | null;
    config?: Record<string, unknown>;
    secretKeys?: string[];
    isDefault?: boolean;
  },
): Promise<string> {
  const existing = await db
    .selectFrom('environments')
    .select(['id'])
    .where('project_id', '=', input.projectId)
    .where('name', '=', input.name)
    .executeTakeFirst();
  const values = {
    base_url: input.baseUrl ?? null,
    api_base_url: input.apiBaseUrl ?? null,
    config_json: enc.json(input.config ?? {}),
    secret_keys_json: enc.json(input.secretKeys ?? []),
    is_default: enc.bool(driver, input.isDefault ?? false) as number,
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('environments').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('environments')
    .values({ id, project_id: input.projectId, name: input.name, created_at: nowIso(), ...values })
    .execute();
  return id;
}

export async function getEnvironment(db: Kysely<Database>, projectId: string, name: string) {
  return db
    .selectFrom('environments')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('name', '=', name)
    .executeTakeFirst();
}
