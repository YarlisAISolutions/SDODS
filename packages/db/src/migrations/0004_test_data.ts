import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, stamps, table } from './helpers.js';

export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await stamps(
    fk(table(db, 'datasets', c), 'project_id', 'projects', c)
      .addColumn('env_key', 'text', (cb) => cb.notNull().defaultTo('*'))
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('kind', 'text', (cb) => cb.notNull())
      .addColumn('storage', 'text', (cb) => cb.notNull().defaultTo('db'))
      .addColumn('source_path', 'text')
      .addColumn('columns_json', c.json, (cb) => cb.notNull())
      .addColumn('row_count', c.int, (cb) => cb.notNull().defaultTo(0))
      .addColumn('content_hash', 'text')
      .addColumn('created_by', 'text'),
    c,
  ).execute();
  await index(
    db,
    'uq_datasets_project_env_name',
    'datasets',
    ['project_id', 'env_key', 'name'],
    true,
  );

  await fk(table(db, 'dataset_rows', c), 'dataset_id', 'datasets', c)
    .addColumn('row_index', c.int, (cb) => cb.notNull())
    .addColumn('data_json', c.json, (cb) => cb.notNull())
    .addColumn('tags_json', c.json, (cb) => cb.notNull())
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(
    db,
    'uq_dataset_rows_dataset_index',
    'dataset_rows',
    ['dataset_id', 'row_index'],
    true,
  );

  await stamps(
    fk(
      fk(table(db, 'user_pool', c), 'project_id', 'projects', c),
      'environment_id',
      'environments',
      c,
      {
        nullable: true,
        onDelete: 'set null',
      },
    )
      .addColumn('env_name', 'text', (cb) => cb.notNull())
      .addColumn('pool_name', 'text', (cb) => cb.notNull().defaultTo('default'))
      .addColumn('username', 'text', (cb) => cb.notNull())
      .addColumn('secret_ref', 'text')
      .addColumn('role', 'text', (cb) => cb.notNull().defaultTo('standard'))
      .addColumn('storage_state_rel', 'text')
      .addColumn('attributes_json', c.json, (cb) => cb.notNull())
      .addColumn('enabled', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? true : 1)),
    c,
  ).execute();
  await index(
    db,
    'uq_user_pool_identity',
    'user_pool',
    ['project_id', 'env_name', 'pool_name', 'username'],
    true,
  );

  await fk(table(db, 'user_leases', c), 'pool_user_id', 'user_pool', c)
    .addColumn('run_id', 'text')
    .addColumn('worker_index', c.int)
    .addColumn('holder', 'text', (cb) => cb.notNull())
    .addColumn('leased_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .addColumn('expires_at', c.ts, (cb) => cb.notNull())
    .addColumn('released_at', c.ts)
    .execute();
  await index(db, 'idx_user_leases_user_released', 'user_leases', ['pool_user_id', 'released_at']);
  await index(db, 'idx_user_leases_expires', 'user_leases', ['expires_at']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, ['user_leases', 'user_pool', 'dataset_rows', 'datasets']);
}
