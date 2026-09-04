import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { col, enc, readBool, readJson } from '../src/col.js';
import { createMemoryDb } from '../src/create-db.js';
import {
  MIGRATION_NAMES,
  migrateDown,
  migrateToLatest,
  migrationStatus,
  resetDatabase,
} from '../src/migrate.js';
import { TABLES_IN_FK_ORDER } from '../src/schema.js';
import { resolveDriverConfig } from '../src/driver.js';

describe('driver config', () => {
  it('defaults to sqlite and validates postgres', () => {
    expect(resolveDriverConfig({} as any)).toEqual({
      driver: 'sqlite',
      sqlitePath: '.sdods/sdods.db',
    });
    expect(
      resolveDriverConfig({ DB_DRIVER: 'sqlite', SQLITE_PATH: '/tmp/x.db' } as any).sqlitePath,
    ).toBe('/tmp/x.db');
    expect(() => resolveDriverConfig({ DB_DRIVER: 'postgres' } as any)).toThrow(/DATABASE_URL/);
    expect(
      resolveDriverConfig({ DB_DRIVER: 'postgres', DATABASE_URL: 'postgres://x' } as any).driver,
    ).toBe('postgres');
    expect(() => resolveDriverConfig({ DB_DRIVER: 'mysql' } as any)).toThrow(/Unknown DB_DRIVER/);
  });
});

describe('col helper', () => {
  it('maps types per dialect and encodes values', () => {
    const s = col('sqlite');
    const p = col('postgres');
    expect(s.ts).toBe('text');
    expect(p.ts).toBe('timestamptz');
    expect(s.json).toBe('text');
    expect(p.json).toBe('jsonb');
    expect(s.bool).toBe('integer');
    expect(p.bool).toBe('boolean');
    expect(enc.bool('sqlite', true)).toBe(1);
    expect(enc.bool('postgres', true)).toBe(true);
    expect(enc.json({ a: 1 })).toBe('{"a":1}');
    expect(readBool(1)).toBe(true);
    expect(readBool('t')).toBe(true);
    expect(readBool(0)).toBe(false);
    expect(readJson('{"x":2}')).toEqual({ x: 2 });
    expect(readJson({ y: 3 })).toEqual({ y: 3 });
  });
});

describe('migrations (sqlite in-memory)', () => {
  const adb = createMemoryDb();
  afterAll(() => adb.close());

  it('applies every migration, creates all tables, and reports status', async () => {
    const results = await migrateToLatest(adb);
    expect(results.map((r) => r.migrationName)).toEqual(MIGRATION_NAMES);
    expect(results.every((r) => r.status === 'Success')).toBe(true);
    const tables = await sql<{
      name: string;
    }>`select name from sqlite_master where type='table'`.execute(adb.db);
    const names = new Set(tables.rows.map((r) => r.name));
    for (const t of TABLES_IN_FK_ORDER) expect(names.has(t), t).toBe(true);
    const status = await migrationStatus(adb);
    expect(status.every((s) => s.executedAt)).toBe(true);
    // idempotent
    expect(await migrateToLatest(adb)).toEqual([]);
  });

  it('rolls back one migration and re-applies', async () => {
    const down = await migrateDown(adb);
    expect(down[0]?.migrationName).toBe(MIGRATION_NAMES[MIGRATION_NAMES.length - 1]);
    const status = await migrationStatus(adb);
    expect(status[status.length - 1]?.executedAt).toBeNull();
    await migrateToLatest(adb);
  });

  it('reset drops everything', async () => {
    await resetDatabase(adb);
    const tables = await sql<{
      name: string;
    }>`select name from sqlite_master where type='table' and name not like 'sdods_migrations%'`.execute(
      adb.db,
    );
    expect(tables.rows.length).toBe(0);
    await migrateToLatest(adb);
  });
});
