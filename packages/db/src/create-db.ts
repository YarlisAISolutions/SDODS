import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import type { Database } from './schema.js';
import { resolveDriverConfig, type Driver, type DriverConfig } from './driver.js';

export interface SdodsDb {
  db: Kysely<Database>;
  driver: Driver;
  config: DriverConfig;
  close(): Promise<void>;
}

/** Open the platform database for the resolved driver. Callers own `close()`. */
export function createDb(cfg: DriverConfig = resolveDriverConfig()): SdodsDb {
  if (cfg.driver === 'postgres') {
    return createPostgres(cfg);
  }
  return createSqlite(cfg);
}

function createSqlite(cfg: DriverConfig): SdodsDb {
  // Lazy require keeps `pg` out of the sqlite path and vice versa.
  const path = cfg.sqlitePath ?? ':memory:';
  const SqliteCtor = loadBetterSqlite();
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const database = new SqliteCtor(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database }),
  });
  return {
    db,
    driver: 'sqlite',
    config: { ...cfg, sqlitePath: path },
    close: () => db.destroy(),
  };
}

function createPostgres(cfg: DriverConfig): SdodsDb {
  const { Pool, types } = loadPg();
  // Return timestamptz/timestamp/date as ISO strings so both dialects look identical to callers.
  const toIso = (v: string | null) => (v == null ? v : new Date(v).toISOString());
  types.setTypeParser(1184, toIso); // timestamptz
  types.setTypeParser(1114, toIso); // timestamp
  types.setTypeParser(20, (v: string) => Number(v)); // int8 → number
  types.setTypeParser(1700, (v: string) => Number(v)); // numeric → number
  const pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return { db, driver: 'postgres', config: cfg, close: () => db.destroy() };
}

function loadBetterSqlite(): any {
  const mod = require('better-sqlite3');
  return mod.default ?? mod;
}

function loadPg(): any {
  const mod = require('pg');
  return mod.default ?? mod;
}

/** In-memory sqlite, used by tests and `--isolated` modes. */
export function createMemoryDb(): SdodsDb {
  return createSqlite({ driver: 'sqlite', sqlitePath: ':memory:' });
}
