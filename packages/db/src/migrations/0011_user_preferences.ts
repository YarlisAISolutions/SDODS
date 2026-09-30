import type { Kysely } from 'kysely';
import type { Col } from '../col.js';
import { dropTables, fk, index, stamps, table } from './helpers.js';

/**
 * Per-user UI preferences, such as the last run selection for a project (`runForm:<ws>:<project>`).
 *
 * Server-side because browser storage is per origin, and the desktop app's origin is
 * `http://127.0.0.1:<port>`: when its preferred port is taken it binds another, and everything
 * the browser had stored is gone. It also carries a preference from the desktop app to the web UI.
 */
export async function up(db: Kysely<any>, c: Col): Promise<void> {
  await stamps(
    fk(table(db, 'user_preferences', c), 'user_id', 'users', c)
      .addColumn('key', 'text', (cb) => cb.notNull())
      .addColumn('value_json', c.json, (cb) => cb.notNull()),
    c,
  ).execute();
  await index(db, 'uq_user_preferences_user_key', 'user_preferences', ['user_id', 'key'], true);
}

export async function down(db: Kysely<any>, _c: Col): Promise<void> {
  await dropTables(db, ['user_preferences']);
}
