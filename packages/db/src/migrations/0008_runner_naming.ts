import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { index } from './helpers.js';

/**
 * Engine-neutral column names: `pw_project` → `runner_project`, `pw_report_rel` →
 * `html_report_rel`, and the stored `scenarios.source` value `pw-json` → `runner-json`.
 *
 * Renames are in-place (`ALTER TABLE … RENAME COLUMN`, supported by SQLite ≥ 3.25 and Postgres),
 * so no data is copied. The unique index on flaky_stats names one of the renamed columns and has
 * to be dropped and recreated; SQLite carries the rename into the index definition but the index
 * name itself still mentions the old column, so it is replaced for clarity on both drivers.
 */
export async function up(db: Kysely<any>, _c: Col): Promise<void> {
  await db.schema.alterTable('runs').renameColumn('pw_report_rel', 'html_report_rel').execute();
  await db.schema.alterTable('scenarios').renameColumn('pw_project', 'runner_project').execute();

  await db.schema.dropIndex('uq_flaky_project_fp_pw').ifExists().execute();
  await db.schema.alterTable('flaky_stats').renameColumn('pw_project', 'runner_project').execute();
  await index(
    db,
    'uq_flaky_project_fp_runner',
    'flaky_stats',
    ['project_id', 'fingerprint', 'runner_project'],
    true,
  );

  await db
    .updateTable('scenarios')
    .set({ source: 'runner-json' })
    .where('source', '=', 'pw-json')
    .execute();
}

export async function down(db: Kysely<any>, _c: Col): Promise<void> {
  await db
    .updateTable('scenarios')
    .set({ source: 'pw-json' })
    .where('source', '=', 'runner-json')
    .execute();

  await db.schema.dropIndex('uq_flaky_project_fp_runner').ifExists().execute();
  await db.schema.alterTable('flaky_stats').renameColumn('runner_project', 'pw_project').execute();
  await index(
    db,
    'uq_flaky_project_fp_pw',
    'flaky_stats',
    ['project_id', 'fingerprint', 'pw_project'],
    true,
  );

  await db.schema.alterTable('scenarios').renameColumn('runner_project', 'pw_project').execute();
  await db.schema.alterTable('runs').renameColumn('html_report_rel', 'pw_report_rel').execute();
}
