import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, table } from './helpers.js';

export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await fk(
    fk(
      fk(
        fk(fk(table(db, 'heal_events', c), 'project_id', 'projects', c), 'run_id', 'runs', c),
        'scenario_id',
        'scenarios',
        c,
        { nullable: true },
      ),
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
    .addColumn('page_url', 'text')
    .addColumn('original_selector', 'text', (cb) => cb.notNull())
    .addColumn('context_json', c.json, (cb) => cb.notNull())
    .addColumn('strategy_used', 'text')
    .addColumn('healed_selector', 'text')
    .addColumn('candidates_json', c.json, (cb) => cb.notNull())
    .addColumn('succeeded', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0))
    .addColumn('duration_ms', c.int)
    .addColumn('source', 'text', (cb) => cb.notNull().defaultTo('runtime'))
    .addColumn('accepted', c.bool)
    .addColumn('accepted_by', 'text')
    .addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(db, 'idx_heal_project_selector', 'heal_events', ['project_id', 'original_selector']);
  await index(db, 'idx_heal_scenario', 'heal_events', ['scenario_id']);

  await fk(table(db, 'locator_stats', c), 'project_id', 'projects', c)
    .addColumn('selector', 'text', (cb) => cb.notNull())
    .addColumn('page_hint', 'text')
    .addColumn('fail_count', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('heal_count', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('use_count', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('last_failed_at', c.ts)
    .addColumn('last_healed_at', c.ts)
    .addColumn('last_strategy', 'text')
    .addColumn('suggested_selector', 'text')
    .addColumn('updated_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(
    db,
    'uq_locator_stats_project_selector',
    'locator_stats',
    ['project_id', 'selector'],
    true,
  );

  await fk(table(db, 'flaky_stats', c), 'project_id', 'projects', c)
    .addColumn('fingerprint', 'text', (cb) => cb.notNull())
    .addColumn('pw_project', 'text', (cb) => cb.notNull())
    .addColumn('feature_uri', 'text')
    .addColumn('scenario_name', 'text')
    .addColumn('window_size', c.int, (cb) => cb.notNull().defaultTo(20))
    .addColumn('runs_count', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('pass_count', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('fail_count', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('flaky_count', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('flaky_rate', c.real, (cb) => cb.notNull().defaultTo(0))
    .addColumn('fail_streak', c.int, (cb) => cb.notNull().defaultTo(0))
    .addColumn('last_status', 'text')
    .addColumn('last_run_id', 'text')
    .addColumn('last_failed_at', c.ts)
    .addColumn('quarantined', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0))
    .addColumn('updated_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .execute();
  await index(
    db,
    'uq_flaky_project_fp_pw',
    'flaky_stats',
    ['project_id', 'fingerprint', 'pw_project'],
    true,
  );
  await index(db, 'idx_flaky_project_rate', 'flaky_stats', ['project_id', 'flaky_rate']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, ['flaky_stats', 'locator_stats', 'heal_events']);
}
