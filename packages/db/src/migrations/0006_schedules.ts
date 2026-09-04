import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, stamps, table } from './helpers.js';

export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await stamps(
    fk(
      fk(table(db, 'schedules', c), 'project_id', 'projects', c),
      'environment_id',
      'environments',
      c,
      {
        nullable: true,
        onDelete: 'set null',
      },
    )
      .addColumn('name', 'text', (cb) => cb.notNull())
      .addColumn('cron_expr', 'text', (cb) => cb.notNull())
      .addColumn('timezone', 'text', (cb) => cb.notNull().defaultTo('UTC'))
      .addColumn('run_input_json', c.json, (cb) => cb.notNull())
      .addColumn('overlap_policy', 'text', (cb) => cb.notNull().defaultTo('skip'))
      .addColumn('jitter_seconds', c.int, (cb) => cb.notNull().defaultTo(0))
      .addColumn('catch_up', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? false : 0))
      .addColumn('enabled', c.bool, (cb) => cb.notNull().defaultTo(c.pg ? true : 1))
      .addColumn('notify_json', c.json, (cb) => cb.notNull())
      .addColumn('retention_runs', c.int)
      .addColumn('next_run_at', c.ts)
      .addColumn('last_run_id', 'text')
      .addColumn('last_status', 'text')
      .addColumn('created_by', 'text'),
    c,
  ).execute();
  await index(db, 'uq_schedules_project_name', 'schedules', ['project_id', 'name'], true);
  await index(db, 'idx_schedules_next_run', 'schedules', ['enabled', 'next_run_at']);

  await fk(table(db, 'schedule_runs', c), 'schedule_id', 'schedules', c)
    .addColumn('run_id', 'text')
    .addColumn('fired_at', c.ts, (cb) => cb.notNull().defaultTo(c.now))
    .addColumn('status', 'text', (cb) => cb.notNull().defaultTo('fired'))
    .addColumn('note', 'text')
    .execute();
  await index(db, 'idx_schedule_runs_schedule', 'schedule_runs', ['schedule_id', 'fired_at']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, ['schedule_runs', 'schedules']);
}
