import type { Kysely } from 'kysely';
import type { Col } from '../col.js';

/**
 * The full selection a run was started with (feature, scenario, workers, headed, HAR mode…), so
 * Rerun can replay it exactly. The existing columns only cover env/tags/layers/browsers, and
 * `command` is an argv joined on spaces that cannot be split back once a scenario name has one.
 * Nullable: runs started before this, and runs from the CLI, fall back to those columns.
 */
export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await db.schema.alterTable('runs').addColumn('params_json', c.json).execute();
}

export async function down(db: Kysely<any>, _c: Col): Promise<void> {
  await db.schema.alterTable('runs').dropColumn('params_json').execute();
}
