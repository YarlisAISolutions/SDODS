import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { enc, nowIso, readBool, readJson, readTs } from '../col.js';
import type { Driver } from '../driver.js';
import { newId } from '../ids.js';
import type { Database } from '../schema.js';

type Row = Record<string, unknown>;

export async function upsertDataset(
  db: Kysely<Database>,
  _driver: Driver,
  input: {
    projectId: string;
    envKey?: string;
    name: string;
    kind: string;
    storage?: 'db' | 'file';
    sourcePath?: string | null;
    rows?: Row[];
    createdBy?: string | null;
  },
): Promise<{ id: string; rowCount: number }> {
  const envKey = input.envKey ?? '*';
  const rows = input.rows ?? [];
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const contentHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  const existing = await db
    .selectFrom('datasets')
    .select(['id'])
    .where('project_id', '=', input.projectId)
    .where('env_key', '=', envKey)
    .where('name', '=', input.name)
    .executeTakeFirst();
  const values = {
    kind: input.kind,
    storage: input.storage ?? 'db',
    source_path: input.sourcePath ?? null,
    columns_json: enc.json(columns),
    row_count: rows.length,
    content_hash: contentHash,
    updated_at: nowIso(),
  };
  let id: string;
  if (existing) {
    id = existing.id;
    await db.updateTable('datasets').set(values).where('id', '=', id).execute();
    await db.deleteFrom('dataset_rows').where('dataset_id', '=', id).execute();
  } else {
    id = newId();
    await db
      .insertInto('datasets')
      .values({
        id,
        project_id: input.projectId,
        env_key: envKey,
        name: input.name,
        created_by: input.createdBy ?? null,
        created_at: nowIso(),
        ...values,
      })
      .execute();
  }
  if (rows.length) {
    const batch = rows.map((r, i) => ({
      id: newId(),
      dataset_id: id,
      row_index: i,
      data_json: enc.json(r),
      tags_json: enc.json([]),
      created_at: nowIso(),
    }));
    for (let i = 0; i < batch.length; i += 500) {
      await db
        .insertInto('dataset_rows')
        .values(batch.slice(i, i + 500))
        .execute();
    }
  }
  return { id, rowCount: rows.length };
}

export async function listDatasets(db: Kysely<Database>, projectId: string) {
  const rows = await db
    .selectFrom('datasets')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('name')
    .execute();
  return rows.map((d) => ({
    id: d.id,
    envKey: d.env_key,
    name: d.name,
    kind: d.kind,
    storage: d.storage,
    sourcePath: d.source_path,
    columns: readJson<string[]>(d.columns_json) ?? [],
    rowCount: d.row_count,
    contentHash: d.content_hash,
    updatedAt: readTs(d.updated_at),
  }));
}

export async function getDatasetRows(
  db: Kysely<Database>,
  datasetId: string,
  opts: { offset?: number; limit?: number } = {},
) {
  const rows = await db
    .selectFrom('dataset_rows')
    .selectAll()
    .where('dataset_id', '=', datasetId)
    .orderBy('row_index')
    .offset(opts.offset ?? 0)
    .limit(opts.limit ?? 100)
    .execute();
  return rows.map((r) => ({ index: r.row_index, data: readJson<Row>(r.data_json) ?? {} }));
}

/** Resolve a dataset for an env: exact env first, then `*`. */
export async function loadDatasetRows(
  db: Kysely<Database>,
  projectId: string,
  name: string,
  env: string,
): Promise<Row[] | null> {
  for (const envKey of [env, '*']) {
    const ds = await db
      .selectFrom('datasets')
      .select(['id'])
      .where('project_id', '=', projectId)
      .where('env_key', '=', envKey)
      .where('name', '=', name)
      .executeTakeFirst();
    if (ds) {
      const rows = await db
        .selectFrom('dataset_rows')
        .select(['data_json'])
        .where('dataset_id', '=', ds.id)
        .orderBy('row_index')
        .execute();
      return rows.map((r) => readJson<Row>(r.data_json) ?? {});
    }
  }
  return null;
}

export async function upsertPoolUser(
  db: Kysely<Database>,
  driver: Driver,
  input: {
    projectId: string;
    environmentId?: string | null;
    envName: string;
    poolName?: string;
    username: string;
    secretRef?: string | null;
    role?: string;
    storageStateRel?: string | null;
    attributes?: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<string> {
  const poolName = input.poolName ?? 'default';
  const existing = await db
    .selectFrom('user_pool')
    .select(['id'])
    .where('project_id', '=', input.projectId)
    .where('env_name', '=', input.envName)
    .where('pool_name', '=', poolName)
    .where('username', '=', input.username)
    .executeTakeFirst();
  const values = {
    environment_id: input.environmentId ?? null,
    secret_ref: input.secretRef ?? null,
    role: input.role ?? 'standard',
    storage_state_rel: input.storageStateRel ?? null,
    attributes_json: enc.json(input.attributes ?? {}),
    enabled: enc.bool(driver, input.enabled ?? true) as number,
    updated_at: nowIso(),
  };
  if (existing) {
    await db.updateTable('user_pool').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const id = newId();
  await db
    .insertInto('user_pool')
    .values({
      id,
      project_id: input.projectId,
      env_name: input.envName,
      pool_name: poolName,
      username: input.username,
      created_at: nowIso(),
      ...values,
    })
    .execute();
  return id;
}

/**
 * Lease one enabled user of `role` that has no active lease. Single conditional insert per candidate;
 * on both dialects the unique-ish check is enforced by re-reading after insert.
 */
export async function leasePoolUser(
  db: Kysely<Database>,
  input: {
    projectId: string;
    envName: string;
    poolName?: string;
    role: string;
    holder: string;
    runId?: string;
    workerIndex?: number;
    ttlMs: number;
  },
): Promise<{
  leaseId: string;
  userId: string;
  username: string;
  secretRef: string | null;
  role: string;
  attributes: Record<string, unknown>;
} | null> {
  const now = nowIso();
  const poolName = input.poolName ?? 'default';
  // expire stale leases
  await db
    .updateTable('user_leases')
    .set({ released_at: now })
    .where('released_at', 'is', null)
    .where('expires_at', '<', now)
    .execute();
  const candidates = await db
    .selectFrom('user_pool')
    .selectAll()
    .where('project_id', '=', input.projectId)
    .where('env_name', '=', input.envName)
    .where('pool_name', '=', poolName)
    .where('role', '=', input.role)
    .orderBy('username')
    .execute();
  for (const u of candidates) {
    if (!readBool(u.enabled)) continue;
    const active = await db
      .selectFrom('user_leases')
      .select(['id', 'holder'])
      .where('pool_user_id', '=', u.id)
      .where('released_at', 'is', null)
      .executeTakeFirst();
    if (active && active.holder !== input.holder) continue;
    if (active) {
      return {
        leaseId: active.id,
        userId: u.id,
        username: u.username,
        secretRef: u.secret_ref,
        role: u.role,
        attributes: readJson<Record<string, unknown>>(u.attributes_json) ?? {},
      };
    }
    const leaseId = newId();
    await db
      .transaction()
      .execute(async (trx) => {
        const again = await trx
          .selectFrom('user_leases')
          .select(['id'])
          .where('pool_user_id', '=', u.id)
          .where('released_at', 'is', null)
          .executeTakeFirst();
        if (again) throw new Error('taken');
        await trx
          .insertInto('user_leases')
          .values({
            id: leaseId,
            pool_user_id: u.id,
            run_id: input.runId ?? null,
            worker_index: input.workerIndex ?? null,
            holder: input.holder,
            leased_at: now,
            expires_at: new Date(Date.now() + input.ttlMs).toISOString(),
            released_at: null,
          })
          .execute();
      })
      .then(
        () => undefined,
        (e) => {
          if ((e as Error).message !== 'taken') throw e;
        },
      );
    const mine = await db
      .selectFrom('user_leases')
      .select(['id'])
      .where('id', '=', leaseId)
      .executeTakeFirst();
    if (mine) {
      return {
        leaseId,
        userId: u.id,
        username: u.username,
        secretRef: u.secret_ref,
        role: u.role,
        attributes: readJson<Record<string, unknown>>(u.attributes_json) ?? {},
      };
    }
  }
  return null;
}

export async function releaseLease(db: Kysely<Database>, leaseId: string): Promise<void> {
  await db
    .updateTable('user_leases')
    .set({ released_at: nowIso() })
    .where('id', '=', leaseId)
    .where('released_at', 'is', null)
    .execute();
}

export async function releaseLeasesByHolder(db: Kysely<Database>, holder: string): Promise<number> {
  const res = await db
    .updateTable('user_leases')
    .set({ released_at: nowIso() })
    .where('holder', '=', holder)
    .where('released_at', 'is', null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0);
}

export async function poolStatus(db: Kysely<Database>, projectId: string, envName: string) {
  const users = await db
    .selectFrom('user_pool')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('env_name', '=', envName)
    .orderBy('role')
    .orderBy('username')
    .execute();
  const leases = await db
    .selectFrom('user_leases')
    .selectAll()
    .where('released_at', 'is', null)
    .execute();
  return users.map((u) => {
    const lease = leases.find((l) => l.pool_user_id === u.id);
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      enabled: readBool(u.enabled),
      leased: Boolean(lease),
      holder: lease?.holder ?? null,
      expiresAt: lease ? readTs(lease.expires_at) : null,
    };
  });
}
