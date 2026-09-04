import { sql, type Kysely } from 'kysely';
import {
  Migrator,
  type Migration,
  type MigrationProvider,
  type MigrationResultSet,
} from 'kysely/migration';
import { col, type Col } from './col.js';
import type { Driver } from './driver.js';
import type { SdodsDb } from './create-db.js';
import { MIGRATIONS } from './migrations/index.js';
import { MIGRATION_LOCK_TABLE, MIGRATION_TABLE } from './schema.js';

export interface SdodsMigration {
  up(db: Kysely<any>, c: Col, driver: Driver): Promise<void>;
  down?(db: Kysely<any>, c: Col, driver: Driver): Promise<void>;
}

/** Binds the driver into every migration so one file serves both dialects. */
class DriverBoundProvider implements MigrationProvider {
  constructor(private readonly driver: Driver) {}
  async getMigrations(): Promise<Record<string, Migration>> {
    const c = col(this.driver);
    const out: Record<string, Migration> = {};
    for (const [name, m] of Object.entries(MIGRATIONS)) {
      out[name] = {
        up: (db) => m.up(db, c, this.driver),
        down: m.down ? (db) => m.down!(db, c, this.driver) : undefined,
      };
    }
    return out;
  }
}

/**
 * Ledger tables the platform used before it was renamed. A database created under the old
 * name is fully migrated, but the migrator cannot see its ledger, so it would replay every
 * migration and fail on the first CREATE TABLE. Renaming the ledger adopts the database.
 */
const LEGACY_TABLES: ReadonlyArray<readonly [string, string]> = [
  ['automax_migrations', MIGRATION_TABLE],
  ['automax_migrations_lock', MIGRATION_LOCK_TABLE],
];

async function tableExists(db: Kysely<any>, name: string): Promise<boolean> {
  const tables = await db.introspection.getTables();
  return tables.some((t) => t.name === name);
}

/**
 * Rename a pre-rename ledger into place, once, before the migrator reads it. Skipped when the
 * current ledger already exists, so it is safe to call on every start.
 */
export async function adoptLegacyLedger({ db }: SdodsDb): Promise<string[]> {
  const renamed: string[] = [];
  for (const [legacy, current] of LEGACY_TABLES) {
    if (await tableExists(db, current)) continue;
    if (!(await tableExists(db, legacy))) continue;
    await sql`alter table ${sql.ref(legacy)} rename to ${sql.ref(current)}`.execute(db);
    renamed.push(`${legacy} -> ${current}`);
  }
  return renamed;
}

export function createMigrator({ db, driver }: SdodsDb): Migrator {
  return new Migrator({
    db,
    provider: new DriverBoundProvider(driver),
    migrationTableName: MIGRATION_TABLE,
    migrationLockTableName: MIGRATION_LOCK_TABLE,
  });
}

function assertOk(result: MigrationResultSet) {
  if (result.error)
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  return result.results ?? [];
}

export async function migrateToLatest(adb: SdodsDb) {
  await adoptLegacyLedger(adb);
  return assertOk(await createMigrator(adb).migrateToLatest());
}

export async function migrateDown(adb: SdodsDb) {
  await adoptLegacyLedger(adb);
  return assertOk(await createMigrator(adb).migrateDown());
}

export async function migrateTo(adb: SdodsDb, name: string) {
  await adoptLegacyLedger(adb);
  return assertOk(await createMigrator(adb).migrateTo(name));
}

export async function migrationStatus(adb: SdodsDb) {
  await adoptLegacyLedger(adb);
  const list = await createMigrator(adb).getMigrations();
  return list.map((m) => ({
    name: m.name,
    executedAt: m.executedAt ? m.executedAt.toISOString() : null,
  }));
}

/** Drop every SDODS table (sqlite only, guarded by the CLI `--yes`). */
export async function resetDatabase(adb: SdodsDb) {
  if (adb.driver !== 'sqlite')
    throw new Error('reset is only supported on sqlite; drop the Postgres database yourself.');
  const migrator = createMigrator(adb);
  const applied = (await migrator.getMigrations()).filter((m) => m.executedAt);
  for (let i = 0; i < applied.length; i++) assertOk(await migrator.migrateDown());
}

export const MIGRATION_NAMES = Object.keys(MIGRATIONS);
