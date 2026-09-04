import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, stamps, table } from './helpers.js';

export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await fk(table(db, 'api_tokens', c), 'user_id', 'users', c)
    .addColumn('name', 'text', (cb) => cb.notNull())
    .addColumn('token_prefix', 'text', (cb) => cb.notNull())
    .addColumn('hash', 'text', (cb) => cb.notNull().unique())
    .addColumn('scopes_json', c.json, (cb) => cb.notNull())
    .addColumn('expires_at', c.ts)
    .addColumn('last_used_at', c.ts)
    .addColumn('revoked_at', c.ts)
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'idx_api_tokens_user', 'api_tokens', ['user_id']);
  await index(db, 'idx_api_tokens_expires', 'api_tokens', ['expires_at']);

  await stamps(
    fk(table(db, 'integrations', c), 'project_id', 'projects', c)
      .addColumn('provider', 'text', (cb) => cb.notNull())
      .addColumn('config_json', c.json, (cb) => cb.notNull())
      .addColumn('secret_env_json', c.json, (cb) => cb.notNull())
      .addColumn('enabled', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0))
      .addColumn('last_sync_at', c.ts),
    c,
  ).execute();
  await index(
    db,
    'uq_integrations_project_provider',
    'integrations',
    ['project_id', 'provider'],
    true,
  );

  await stamps(
    fk(
      fk(table(db, 'issue_links', c), 'project_id', 'projects', c),
      'integration_id',
      'integrations',
      c,
      {
        nullable: true,
        onDelete: 'set null',
      },
    )
      .addColumn('provider', 'text', (cb) => cb.notNull())
      .addColumn('fingerprint', 'text', (cb) => cb.notNull())
      .addColumn('scenario_name', 'text')
      .addColumn('external_key', 'text', (cb) => cb.notNull())
      .addColumn('external_url', 'text')
      .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('unknown'))
      .addColumn('source', 'text', (cb) => cb.notNull().defaultTo('auto'))
      .addColumn('last_run_id', 'text')
      .addColumn('last_synced_at', c.ts),
    c,
  ).execute();
  await index(
    db,
    'uq_issue_links_identity',
    'issue_links',
    ['project_id', 'provider', 'fingerprint', 'external_key'],
    true,
  );
  await index(db, 'idx_issue_links_fingerprint', 'issue_links', ['fingerprint']);

  await fk(table(db, 'proposals', c), 'project_id', 'projects', c)
    .addColumn('role', 'text', (cb) => cb.notNull())
    .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('pending'))
    .addColumn('summary', 'text')
    .addColumn('manifest_json', c.json, (cb) => cb.notNull())
    .addColumn('cost_usd', c.real)
    .addColumn('model', 'text')
    .addColumn('created_by', 'text')
    .addColumn('reviewed_by', 'text')
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .addColumn('reviewed_at', c.ts)
    .execute();
  await index(db, 'idx_proposals_project_status', 'proposals', ['project_id', 'status']);

  await fk(
    fk(table(db, 'agent_jobs', c), 'project_id', 'projects', c),
    'proposal_id',
    'proposals',
    c,
    {
      nullable: true,
      onDelete: 'set null',
    },
  )
    .addColumn('kind', 'text', (cb) => cb.notNull())
    .addColumn('goal', 'text')
    .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('queued'))
    .addColumn('input_json', c.json, (cb) => cb.notNull())
    .addColumn('output_json', c.json)
    .addColumn('diff_text', 'text')
    .addColumn('log_rel', 'text')
    .addColumn('provider', 'text')
    .addColumn('model', 'text')
    .addColumn('tokens_in', c.int)
    .addColumn('tokens_out', c.int)
    .addColumn('cost_usd', c.real)
    .addColumn('turns', c.int)
    .addColumn('started_by', 'text')
    .addColumn('reviewed_by', 'text')
    .addColumn('started_at', c.ts)
    .addColumn('finished_at', c.ts)
    .addColumn('reviewed_at', c.ts)
    .addColumn('error', 'text')
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'idx_agent_jobs_project_created', 'agent_jobs', ['project_id', 'created_at']);
  await index(db, 'idx_agent_jobs_status', 'agent_jobs', ['status']);

  await table(db, 'audit_log', c)
    .addColumn('actor_user_id', 'text')
    .addColumn('actor_type', 'text', (cb) => cb.notNull().defaultTo('system'))
    .addColumn('action', 'text', (cb) => cb.notNull())
    .addColumn('target_type', 'text')
    .addColumn('target_id', 'text')
    .addColumn('details_json', c.json)
    .addColumn('ip', 'text')
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'idx_audit_created', 'audit_log', ['created_at']);
  await index(db, 'idx_audit_target', 'audit_log', ['target_type', 'target_id']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, [
    'audit_log',
    'agent_jobs',
    'proposals',
    'issue_links',
    'integrations',
    'api_tokens',
  ]);
}
