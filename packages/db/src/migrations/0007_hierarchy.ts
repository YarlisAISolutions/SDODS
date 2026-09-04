import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, stamps, table } from './helpers.js';

export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await stamps(
    table(db, 'organizations', c)
      .addColumn('slug', 'text', (cb) => cb.notNull().unique())
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('description', 'text')
      .addColumn('url', 'text'),
    c,
  ).execute();

  await stamps(
    fk(table(db, 'workspaces', c), 'organization_id', 'organizations', c)
      .addColumn('slug', 'text', (cb) => cb.notNull())
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('description', 'text'),
    c,
  ).execute();
  await index(db, 'uq_workspaces_org_slug', 'workspaces', ['organization_id', 'slug'], true);

  await fk(
    fk(table(db, 'org_members', c), 'organization_id', 'organizations', c),
    'user_id',
    'users',
    c,
  )
    .addColumn('role', 'text', (cb) => cb.notNull().defaultTo('member'))
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'uq_org_members_org_user', 'org_members', ['organization_id', 'user_id'], true);

  await fk(
    fk(table(db, 'workspace_members', c), 'workspace_id', 'workspaces', c),
    'user_id',
    'users',
    c,
  )
    .addColumn('role', 'text', (cb) => cb.notNull().defaultTo('viewer'))
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(
    db,
    'uq_workspace_members_ws_user',
    'workspace_members',
    ['workspace_id', 'user_id'],
    true,
  );

  // sqlite cannot DROP a column that carries a REFERENCES clause, so the FK is declared on Postgres only.
  await db.schema
    .alterTable('projects')
    .addColumn('workspace_id', c.id, (cb) =>
      c.pg ? cb.references('workspaces.id').onDelete('set null') : cb,
    )
    .execute();
  await index(db, 'uq_projects_workspace_slug', 'projects', ['workspace_id', 'slug'], true);

  await stamps(
    fk(table(db, 'modules', c), 'project_id', 'projects', c)
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('title', 'text')
      .addColumn('description', 'text')
      .addColumn('path', 'text')
      .addColumn('layers_json', c.json, (cb) => cb.notNull())
      .addColumn('testing_types_json', c.json, (cb) => cb.notNull())
      .addColumn('tags_json', c.json, (cb) => cb.notNull())
      .addColumn('owner', 'text')
      .addColumn('jira_component', 'text')
      .addColumn('routes_json', c.json, (cb) => cb.notNull())
      .addColumn('endpoints_json', c.json, (cb) => cb.notNull()),
    c,
  ).execute();
  await index(db, 'uq_modules_project_name', 'modules', ['project_id', 'name'], true);

  await stamps(
    fk(
      fk(table(db, 'processes', c), 'project_id', 'projects', c, { nullable: true }),
      'workspace_id',
      'workspaces',
      c,
      {
        nullable: true,
      },
    )
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('title', 'text')
      .addColumn('description', 'text')
      .addColumn('trigger', 'text', (cb) => cb.notNull().defaultTo('manual'))
      .addColumn('config_json', c.json, (cb) => cb.notNull())
      .addColumn('enabled', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? true : 1))
      .addColumn('last_run_id', 'text')
      .addColumn('last_status', 'text'),
    c,
  ).execute();
  await index(db, 'uq_processes_project_name', 'processes', ['project_id', 'name'], true);
  await index(db, 'idx_processes_workspace', 'processes', ['workspace_id', 'name']);

  await db.schema.alterTable('scenarios').addColumn('module', 'text').execute();
  await index(db, 'idx_scenarios_module', 'scenarios', ['project_id', 'module']);
  await db.schema.alterTable('runs').addColumn('process', 'text').execute();
  await db.schema
    .alterTable('runs')
    .addColumn('workspace_id', c.id, (cb) =>
      c.pg ? cb.references('workspaces.id').onDelete('set null') : cb,
    )
    .execute();
  await index(db, 'idx_runs_process', 'runs', ['project_id', 'process']);
}

export async function down(db: Kysely<any>, c: Col): Promise<void> {
  await dropTables(db, ['processes', 'modules', 'workspace_members', 'org_members']);
  await db.schema.dropIndex('uq_projects_workspace_slug').ifExists().execute();
  await db.schema.dropIndex('idx_scenarios_module').ifExists().execute();
  await db.schema.dropIndex('idx_runs_process').ifExists().execute();
  await db.schema.alterTable('runs').dropColumn('workspace_id').execute();
  await db.schema.alterTable('runs').dropColumn('process').execute();
  await db.schema.alterTable('scenarios').dropColumn('module').execute();
  await db.schema.alterTable('projects').dropColumn('workspace_id').execute();
  await dropTables(db, ['workspaces', 'organizations']);
  void c;
}
