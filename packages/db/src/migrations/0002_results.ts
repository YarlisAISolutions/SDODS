import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, stamps, table } from './helpers.js';

export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await stamps(
    fk(fk(table(db, 'runs', c), 'project_id', 'projects', c), 'environment_id', 'environments', c, {
      nullable: true,
      onDelete: 'set null',
    })
      .addColumn('env_name', 'text', (cb) => cb.notNull())
      .addColumn('trigger', 'text', (cb) => cb.notNull().defaultTo('cli'))
      .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('queued'))
      .addColumn('suite_tag', 'text')
      .addColumn('tags_expr', 'text')
      .addColumn('layers_json', c.json, (cb) => cb.notNull())
      .addColumn('browsers_json', c.json, (cb) => cb.notNull())
      .addColumn('shard_total', c.int)
      .addColumn('shards_ingested', c.int, (cb) => cb.notNull().defaultTo(0))
      .addColumn('git_sha', 'text')
      .addColumn('git_branch', 'text')
      .addColumn('ci_provider', 'text')
      .addColumn('ci_run_id', 'text')
      .addColumn('ci_url', 'text')
      .addColumn('started_by', 'text')
      .addColumn('command', 'text')
      .addColumn('started_at', c.ts)
      .addColumn('finished_at', c.ts)
      .addColumn('duration_ms', c.int)
      .addColumn('totals_json', c.json, (cb) => cb.notNull())
      .addColumn('artifacts_dir', 'text')
      .addColumn('pw_report_rel', 'text')
      .addColumn('exit_code', c.int)
      .addColumn('error_text', 'text'),
    c,
  ).execute();
  await index(db, 'idx_runs_project_started', 'runs', ['project_id', 'started_at']);
  await index(db, 'idx_runs_status', 'runs', ['status']);
  await index(db, 'idx_runs_ci_run', 'runs', ['ci_run_id']);

  await stamps(
    fk(fk(table(db, 'scenarios', c), 'run_id', 'runs', c), 'project_id', 'projects', c)
      .addColumn('natural_key', 'text', (cb) => cb.notNull())
      .addColumn('fingerprint', 'text', (cb) => cb.notNull())
      .addColumn('source', 'text', (cb) => cb.notNull().defaultTo('gherkin'))
      .addColumn('feature_uri', 'text', (cb) => cb.notNull())
      .addColumn('feature_name', 'text')
      .addColumn('scenario_name', 'text', (cb) => cb.notNull())
      .addColumn('examples_row', c.int)
      .addColumn('pw_project', 'text', (cb) => cb.notNull())
      .addColumn('layer', 'text', (cb) => cb.notNull())
      .addColumn('browser', 'text')
      .addColumn('suite_tag', 'text')
      .addColumn('tags_json', c.json, (cb) => cb.notNull())
      .addColumn('jira_keys_json', c.json, (cb) => cb.notNull())
      .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('unknown'))
      .addColumn('attempts_count', c.int, (cb) => cb.notNull().defaultTo(0))
      .addColumn('flaky', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0))
      .addColumn('duration_ms', c.int)
      .addColumn('error_message', 'text')
      .addColumn('error_stack', 'text')
      .addColumn('started_at', c.ts)
      .addColumn('finished_at', c.ts),
    c,
  ).execute();
  await index(db, 'uq_scenarios_run_natural', 'scenarios', ['run_id', 'natural_key'], true);
  await index(db, 'idx_scenarios_fingerprint', 'scenarios', ['fingerprint']);
  await index(db, 'idx_scenarios_run_status', 'scenarios', ['run_id', 'status']);
  await index(db, 'idx_scenarios_project_fp', 'scenarios', ['project_id', 'fingerprint']);

  await fk(
    fk(table(db, 'scenario_attempts', c), 'scenario_id', 'scenarios', c),
    'run_id',
    'runs',
    c,
  )
    .addColumn('attempt', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('test_case_started_id', 'text', (cb) => cb.notNull())
    .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('unknown'))
    .addColumn('duration_ms', c.int)
    .addColumn('error_message', 'text')
    .addColumn('error_stack', 'text')
    .addColumn('will_be_retried', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0))
    .addColumn('worker_index', c.int)
    .addColumn('started_at', c.ts)
    .addColumn('finished_at', c.ts)
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(
    db,
    'uq_attempts_run_tcs',
    'scenario_attempts',
    ['run_id', 'test_case_started_id'],
    true,
  );
  await index(db, 'idx_attempts_scenario', 'scenario_attempts', ['scenario_id', 'attempt']);

  await fk(
    fk(
      fk(table(db, 'steps', c), 'attempt_id', 'scenario_attempts', c),
      'scenario_id',
      'scenarios',
      c,
    ),
    'run_id',
    'runs',
    c,
  )
    .addColumn('step_index', c.int, (cb) => cb.notNull())
    .addColumn('kind', 'text', (cb) => cb.notNull().defaultTo('step'))
    .addColumn('hook_type', 'text')
    .addColumn('keyword', 'text')
    .addColumn('text', 'text', (cb) => cb.notNull())
    .addColumn('argument_json', c.json)
    .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('unknown'))
    .addColumn('duration_ms', c.int)
    .addColumn('error_message', 'text')
    .addColumn('error_stack', 'text')
    .addColumn('definition_location', 'text')
    .addColumn('test_step_id', 'text', (cb) => cb.notNull())
    .addColumn('pickle_step_id', 'text')
    .addColumn('layer_hint', 'text')
    .addColumn('api_snapshot_json', c.json)
    .addColumn('perf_json', c.json)
    .addColumn('started_at', c.ts)
    .addColumn('finished_at', c.ts)
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'uq_steps_attempt_test_step', 'steps', ['attempt_id', 'test_step_id'], true);
  await index(db, 'idx_steps_scenario_index', 'steps', ['scenario_id', 'step_index']);

  await fk(
    fk(
      fk(fk(table(db, 'artifacts', c), 'run_id', 'runs', c), 'scenario_id', 'scenarios', c, {
        nullable: true,
      }),
      'attempt_id',
      'scenario_attempts',
      c,
      { nullable: true },
    ),
    'step_id',
    'steps',
    c,
    { nullable: true, onDelete: 'set null' },
  )
    .addColumn('step_index', c.int)
    .addColumn('kind', 'text', (cb) => cb.notNull())
    .addColumn('phase', 'text')
    .addColumn('media_type', 'text', (cb) => cb.notNull().defaultTo('application/octet-stream'))
    .addColumn('file_name', 'text', (cb) => cb.notNull())
    .addColumn('rel_path', 'text', (cb) => cb.notNull().unique())
    .addColumn('size_bytes', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('sha256', 'text')
    .addColumn('width', c.int)
    .addColumn('height', c.int)
    .addColumn('meta_json', c.json)
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'idx_artifacts_attempt_step_phase', 'artifacts', [
    'attempt_id',
    'step_index',
    'phase',
  ]);
  await index(db, 'idx_artifacts_scenario_kind', 'artifacts', ['scenario_id', 'kind']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, ['artifacts', 'steps', 'scenario_attempts', 'scenarios', 'runs']);
}
