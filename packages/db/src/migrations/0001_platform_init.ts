import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, stamps, table } from './helpers.js';

export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await stamps(
    table(db, 'roles', c)
      .addColumn('name', 'text', (cb) => cb.notNull().unique())
      .addColumn('permissions_json', c.json, (cb) => cb.notNull()),
    c,
    false,
  ).execute();

  await stamps(
    fk(
      table(db, 'users', c)
        .addColumn('username', 'text', (cb) => cb.notNull().unique())
        .addColumn('email', 'text')
        .addColumn('password_hash', 'text', (cb) => cb.notNull()),
      'role_id',
      'roles',
      c,
      { onDelete: 'restrict' },
    )
      .addColumn('active', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? true : 1))
      .addColumn('auth_provider', 'text', (cb) => cb.notNull().defaultTo('local'))
      .addColumn('external_id', 'text')
      .addColumn('last_login_at', c.ts),
    c,
  ).execute();

  await fk(table(db, 'sessions', c), 'user_id', 'users', c)
    .addColumn('csrf_token', 'text', (cb) => cb.notNull())
    .addColumn('ip', 'text')
    .addColumn('user_agent', 'text')
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .addColumn('expires_at', c.ts, (cb) => cb.notNull())
    .addColumn('last_seen_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'idx_sessions_user', 'sessions', ['user_id']);
  await index(db, 'idx_sessions_expires', 'sessions', ['expires_at']);

  await stamps(
    table(db, 'projects', c)
      .addColumn('slug', 'text', (cb) => cb.notNull().unique())
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('description', 'text')
      .addColumn('root_path', 'text')
      .addColumn('config_json', c.json, (cb) => cb.notNull())
      .addColumn('config_hash', 'text')
      .addColumn('layers_json', c.json, (cb) => cb.notNull())
      .addColumn('browsers_json', c.json, (cb) => cb.notNull())
      .addColumn('tags_policy_json', c.json, (cb) => cb.notNull())
      .addColumn('screenshot_policy_json', c.json, (cb) => cb.notNull())
      .addColumn('archived', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0)),
    c,
  ).execute();

  await stamps(
    fk(table(db, 'environments', c), 'project_id', 'projects', c)
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('base_url', 'text')
      .addColumn('api_base_url', 'text')
      .addColumn('config_json', c.json, (cb) => cb.notNull())
      .addColumn('secret_keys_json', c.json, (cb) => cb.notNull())
      .addColumn('is_default', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0)),
    c,
  ).execute();
  await index(db, 'uq_environments_project_name', 'environments', ['project_id', 'name'], true);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, ['environments', 'projects', 'sessions', 'users', 'roles']);
}
