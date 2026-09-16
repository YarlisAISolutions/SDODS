import type { Kysely } from 'kysely';
import type { Col } from '../col.js';

/**
 * Self-service profile: a free-text display name next to the immutable username. Nullable, so
 * existing users keep showing their username until they set one.
 */
export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await db.schema.alterTable('users').addColumn('display_name', c.text).execute();
}

export async function down(db: Kysely<any>, _c: Col): Promise<void> {
  await db.schema.alterTable('users').dropColumn('display_name').execute();
}
