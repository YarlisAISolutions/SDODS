import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { col, enc, readBool, readJson } from '../src/col.js';
import { createMemoryDb } from '../src/create-db.js';
import {
  MIGRATION_NAMES,
  adoptLegacyLedger,
  migrateDown,
  migrateTo,
  migrateToLatest,
  migrationStatus,
  resetDatabase,
} from '../src/migrate.js';
import { MIGRATION_LOCK_TABLE, MIGRATION_TABLE, TABLES_IN_FK_ORDER } from '../src/schema.js';
import { resolveDriverConfig } from '../src/driver.js';

describe('driver config', () => {
  it('defaults to sqlite and validates postgres', () => {
    // The default is anchored to the workspace root, so it is absolute whenever one is found
    // above the current directory (see packages/db/test/driver-root.test.ts).
    const dflt = resolveDriverConfig({} as any);
    expect(dflt.driver).toBe('sqlite');
    expect(dflt.sqlitePath?.endsWith('.sdods/sdods.db')).toBe(true);
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

describe('0008_runner_naming carries existing rows through the rename', () => {
  const adb = createMemoryDb();
  afterAll(() => adb.close());

  /** Minimal project/run/scenario/flaky rows written with the pre-rename column names. */
  async function seedLegacyRows() {
    const json = '{}';
    await sql`insert into projects
      (id, slug, name, config_json, layers_json, browsers_json, tags_policy_json, screenshot_policy_json)
      values ('p1', 'demo-shop', 'Demo Shop', ${json}, ${json}, ${json}, ${json}, ${json})`.execute(
      adb.db,
    );
    await sql`insert into runs
      (id, project_id, env_name, layers_json, browsers_json, totals_json, pw_report_rel)
      values ('r1', 'p1', 'staging', ${json}, ${json}, ${json}, 'playwright-report')`.execute(
      adb.db,
    );
    await sql`insert into scenarios
      (id, run_id, project_id, natural_key, fingerprint, source, feature_uri, scenario_name,
       pw_project, layer, tags_json, jira_keys_json)
      values ('s1', 'r1', 'p1', 'nk1', 'fp1', 'pw-json', 'recorded/checkout.spec.ts',
              'checkout happy path', 'demo-shop--recorded--chromium', 'recorded', ${json}, ${json})`.execute(
      adb.db,
    );
    await sql`insert into scenarios
      (id, run_id, project_id, natural_key, fingerprint, source, feature_uri, scenario_name,
       pw_project, layer, tags_json, jira_keys_json)
      values ('s2', 'r1', 'p1', 'nk2', 'fp2', 'gherkin', 'features/ui/login.feature',
              'Successful login', 'demo-shop--ui--chromium', 'ui', ${json}, ${json})`.execute(
      adb.db,
    );
    await sql`insert into flaky_stats
      (id, project_id, fingerprint, pw_project, runs_count, flaky_count, flaky_rate)
      values ('f1', 'p1', 'fp2', 'demo-shop--ui--chromium', 9, 3, 0.33)`.execute(adb.db);
  }

  it('renames columns, rewrites the source value, and leaves other data intact', async () => {
    await migrateTo(adb, '0007_hierarchy');
    await seedLegacyRows();
    await migrateToLatest(adb);

    const scenarios = await sql<{
      id: string;
      source: string;
      runner_project: string;
    }>`select id, source, runner_project from scenarios order by id`.execute(adb.db);
    expect(scenarios.rows).toEqual([
      { id: 's1', source: 'runner-json', runner_project: 'demo-shop--recorded--chromium' },
      { id: 's2', source: 'gherkin', runner_project: 'demo-shop--ui--chromium' },
    ]);

    const runs = await sql<{
      html_report_rel: string;
    }>`select html_report_rel from runs`.execute(adb.db);
    expect(runs.rows[0]?.html_report_rel).toBe('playwright-report');

    const flaky = await sql<{
      runner_project: string;
      runs_count: number;
      flaky_count: number;
    }>`select runner_project, runs_count, flaky_count from flaky_stats`.execute(adb.db);
    expect(flaky.rows[0]).toMatchObject({
      runner_project: 'demo-shop--ui--chromium',
      runs_count: 9,
      flaky_count: 3,
    });

    const idx = await sql<{
      name: string;
    }>`select name from sqlite_master where type='index' and tbl_name='flaky_stats'`.execute(
      adb.db,
    );
    const idxNames = idx.rows.map((r) => r.name);
    expect(idxNames).toContain('uq_flaky_project_fp_runner');
    expect(idxNames).not.toContain('uq_flaky_project_fp_pw');
  });

  it('reverts cleanly on rollback', async () => {
    // Roll back to the migration before this one, not one step: later migrations sit on top.
    await migrateTo(adb, '0007_hierarchy');
    const scenarios = await sql<{
      id: string;
      source: string;
      pw_project: string;
    }>`select id, source, pw_project from scenarios order by id`.execute(adb.db);
    expect(scenarios.rows).toEqual([
      { id: 's1', source: 'pw-json', pw_project: 'demo-shop--recorded--chromium' },
      { id: 's2', source: 'gherkin', pw_project: 'demo-shop--ui--chromium' },
    ]);
    const runs = await sql<{
      pw_report_rel: string;
    }>`select pw_report_rel from runs`.execute(adb.db);
    expect(runs.rows[0]?.pw_report_rel).toBe('playwright-report');
    const flaky = await sql<{
      pw_project: string;
    }>`select pw_project from flaky_stats`.execute(adb.db);
    expect(flaky.rows[0]?.pw_project).toBe('demo-shop--ui--chromium');
    await migrateToLatest(adb);
  });
});

describe('adopting a database created before the rename', () => {
  it('renames the legacy ledger instead of replaying every migration', async () => {
    const adb = createMemoryDb();
    await migrateToLatest(adb);
    const before = (await migrationStatus(adb)).filter((m) => m.executedAt).length;
    expect(before).toBe(MIGRATION_NAMES.length);

    // Put the database back into the shape it had under the old name.
    await sql`alter table ${sql.ref(MIGRATION_TABLE)} rename to ${sql.ref('automax_migrations')}`.execute(
      adb.db,
    );
    await sql`alter table ${sql.ref(MIGRATION_LOCK_TABLE)} rename to ${sql.ref('automax_migrations_lock')}`.execute(
      adb.db,
    );

    const renamed = await adoptLegacyLedger(adb);
    expect(renamed).toEqual([
      `automax_migrations -> ${MIGRATION_TABLE}`,
      `automax_migrations_lock -> ${MIGRATION_LOCK_TABLE}`,
    ]);

    // Every migration is still recorded, so migrating again is a no-op rather than a replay.
    expect((await migrationStatus(adb)).filter((m) => m.executedAt).length).toBe(before);
    await expect(migrateToLatest(adb)).resolves.toEqual([]);

    // Calling it again on an adopted database does nothing.
    expect(await adoptLegacyLedger(adb)).toEqual([]);
    await adb.db.destroy();
  });

  it('adopts implicitly, so an existing deployment starts without intervention', async () => {
    const adb = createMemoryDb();
    await migrateToLatest(adb);
    await sql`alter table ${sql.ref(MIGRATION_TABLE)} rename to ${sql.ref('automax_migrations')}`.execute(
      adb.db,
    );
    await sql`alter table ${sql.ref(MIGRATION_LOCK_TABLE)} rename to ${sql.ref('automax_migrations_lock')}`.execute(
      adb.db,
    );
    // Without adoption this throws: the ledger looks empty and migration 0001 recreates `roles`.
    await expect(migrateToLatest(adb)).resolves.toEqual([]);
    await adb.db.destroy();
  });

  it('adopts even after a failed start left an empty ledger behind', async () => {
    const adb = createMemoryDb();
    await migrateToLatest(adb);
    await sql`alter table ${sql.ref(MIGRATION_TABLE)} rename to ${sql.ref('automax_migrations')}`.execute(
      adb.db,
    );
    await sql`alter table ${sql.ref(MIGRATION_LOCK_TABLE)} rename to ${sql.ref('automax_migrations_lock')}`.execute(
      adb.db,
    );
    // What a start that failed this way leaves behind: the ledger exists but records nothing.
    await sql`create table ${sql.ref(MIGRATION_TABLE)} (name varchar(255) primary key, timestamp varchar(255) not null)`.execute(
      adb.db,
    );

    expect(await adoptLegacyLedger(adb)).toEqual([
      `automax_migrations -> ${MIGRATION_TABLE}`,
      `automax_migrations_lock -> ${MIGRATION_LOCK_TABLE}`,
    ]);
    expect((await migrationStatus(adb)).filter((m) => m.executedAt).length).toBe(
      MIGRATION_NAMES.length,
    );
    await adb.db.destroy();
  });

  it('declines to adopt when the current ledger already records migrations', async () => {
    const adb = createMemoryDb();
    await migrateToLatest(adb);
    // A stray legacy table next to a live ledger must not displace it.
    await sql`create table automax_migrations (name varchar(255) primary key, timestamp varchar(255) not null)`.execute(
      adb.db,
    );
    await sql`insert into automax_migrations (name, timestamp) values ('0001_init', '2020-01-01')`.execute(
      adb.db,
    );
    expect(await adoptLegacyLedger(adb)).toEqual([]);
    expect((await migrationStatus(adb)).filter((m) => m.executedAt).length).toBe(
      MIGRATION_NAMES.length,
    );
    await adb.db.destroy();
  });

  it('leaves a fresh database alone', async () => {
    const adb = createMemoryDb();
    expect(await adoptLegacyLedger(adb)).toEqual([]);
    await migrateToLatest(adb);
    expect(await adoptLegacyLedger(adb)).toEqual([]);
    await adb.db.destroy();
  });
});
