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
const LEGACY_MIGRATION_TABLE = 'automax_migrations';
const LEGACY_LOCK_TABLE = 'automax_migrations_lock';

async function tableExists(db: Kysely<any>, name: string): Promise<boolean> {
  const tables = await db.introspection.getTables();
  return tables.some((t) => t.name === name);
}

async function rowCount(db: Kysely<any>, name: string): Promise<number> {
  const rows = await sql<{
    n: number | string;
  }>`select count(*) as n from ${sql.ref(name)}`.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

/**
 * Move a pre-rename ledger into place before the migrator reads it. Safe to call on every
 * start: it does nothing unless the old ledger exists and actually records migrations.
 *
 * A start that already failed this way leaves an empty ledger under the current name behind,
 * so an empty one is dropped rather than treated as authoritative. An empty ledger records
 * nothing, so nothing is lost; a non-empty one is left untouched and adoption is declined.
 */
export async function adoptLegacyLedger({ db }: SdodsDb): Promise<string[]> {
  if (!(await tableExists(db, LEGACY_MIGRATION_TABLE))) return [];
  if ((await rowCount(db, LEGACY_MIGRATION_TABLE)) === 0) return [];

  if (await tableExists(db, MIGRATION_TABLE)) {
    if ((await rowCount(db, MIGRATION_TABLE)) > 0) return [];
    await sql`drop table ${sql.ref(MIGRATION_TABLE)}`.execute(db);
  }
  await sql`alter table ${sql.ref(LEGACY_MIGRATION_TABLE)} rename to ${sql.ref(MIGRATION_TABLE)}`.execute(
    db,
  );
  const renamed = [`${LEGACY_MIGRATION_TABLE} -> ${MIGRATION_TABLE}`];

  // The lock table holds no history, so whichever one is in place will do.
  if (await tableExists(db, LEGACY_LOCK_TABLE)) {
    if (await tableExists(db, MIGRATION_LOCK_TABLE)) {
      await sql`drop table ${sql.ref(LEGACY_LOCK_TABLE)}`.execute(db);
    } else {
      await sql`alter table ${sql.ref(LEGACY_LOCK_TABLE)} rename to ${sql.ref(MIGRATION_LOCK_TABLE)}`.execute(
        db,
      );
      renamed.push(`${LEGACY_LOCK_TABLE} -> ${MIGRATION_LOCK_TABLE}`);
    }
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
