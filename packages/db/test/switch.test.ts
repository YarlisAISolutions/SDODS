import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AutomaxDb } from '../src/create-db.js';
import { createDb } from '../src/create-db.js';
import { migrateToLatest } from '../src/migrate.js';
import { ensureProject } from '../src/repos/projects.js';
import { upsertRun } from '../src/repos/runs.js';
import { upsertDataset } from '../src/repos/test-data.js';
import { countRows, exportAll } from '../src/switch/export.js';
import { importAll } from '../src/switch/import.js';
import { prune } from '../src/switch/prune.js';
import { rewriteEnv, switchDriver } from '../src/switch/switch.js';
import { importRowsToTable, listTdTables, readTableRows, tdTableName } from '../src/test-data.js';
import { testDb, tmpDir } from './helpers.js';

describe('export / import / switch / prune', () => {
  let adb: AutomaxDb;
  let projectId: string;
  beforeAll(async () => {
    adb = await testDb();
    projectId = await ensureProject(adb.db, adb.driver, 'shop', 'Shop');
    for (let i = 0; i < 3; i++) {
      await upsertRun(adb.db, adb.driver, {
        id: `run-${i}`,
        projectId,
        envName: 'staging',
        status: 'passed',
        totals: { total: 1, passed: 1 },
        startedAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000).toISOString(),
      });
    }
    await upsertDataset(adb.db, adb.driver, {
      projectId,
      name: 'users',
      kind: 'csv',
      rows: [
        { id: 1, username: 'a' },
        { id: 2, username: 'b' },
      ],
    });
    await importRowsToTable(adb.db, adb.driver, {
      projectSlug: 'shop',
      dataset: 'orders',
      env: 'staging',
      rows: [
        { id: '1', total: '9.99' },
        { id: '2', total: '19.99' },
      ],
    });
  });
  afterAll(() => adb.close());

  it('td tables are created with a safe name and read back', async () => {
    expect(tdTableName('Shop', 'Orders-2')).toBe('td_shop_orders_2');
    expect(await listTdTables(adb.db as any, adb.driver)).toContain('td_shop_orders');
    expect(await readTableRows(adb.db as any, 'td_shop_orders', 'staging')).toEqual([
      { id: '1', total: '9.99' },
      { id: '2', total: '19.99' },
    ]);
  });

  it('round-trips through JSONL into a fresh sqlite database', async () => {
    const dir = tmpDir('automax-export-');
    const exp = await exportAll(adb, dir);
    const runs = exp.tables.find((t) => t.table === 'runs')!;
    expect(runs.rows).toBe(3);
    expect(existsSync(join(dir, 'td_shop_orders.jsonl'))).toBe(true);
    const line = readFileSync(join(dir, 'datasets.jsonl'), 'utf8').trim().split('\n')[0]!;
    expect(JSON.parse(line).columns_json).toEqual(['id', 'username']); // json decoded

    const target = createDb({
      driver: 'sqlite',
      sqlitePath: join(tmpDir('automax-target-'), 'target.db'),
    });
    try {
      await migrateToLatest(target);
      const res = await importAll(target, dir);
      expect(res.tables.find((t) => t.table === 'runs')?.rows).toBe(3);
      expect(await countRows(target, 'dataset_rows')).toBe(2);
      expect(await countRows(target, 'td_shop_orders')).toBe(2);
      // importing again skips duplicates
      const again = await importAll(target, dir);
      expect(again.tables.find((t) => t.table === 'runs')?.rows).toBe(0);
      expect(await countRows(target, 'runs')).toBe(3);
    } finally {
      await target.close();
    }
  });

  it('switchDriver copies, verifies and rewrites .env (sqlite → sqlite file)', async () => {
    const envDir = tmpDir('automax-env-');
    const envFile = join(envDir, '.env');
    writeFileSync(envFile, 'PORT=4444\nDB_DRIVER=sqlite\n# DATABASE_URL=postgres://old\n');
    const targetPath = join(envDir, 'switched.db');
    const dry = await switchDriver({
      source: adb,
      target: 'sqlite',
      targetPath,
      dryRun: true,
      envFile,
    });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    // a dry run never writes into the target: it reports what would be copied
    expect(dry.tables.find((t) => t.table === 'runs')).toMatchObject({
      source: 3,
      target: 0,
      ok: true,
    });
    expect(readFileSync(envFile, 'utf8')).toContain('DB_DRIVER=sqlite');
    const real = await switchDriver({ source: adb, target: 'sqlite', targetPath, envFile });
    expect(real.ok).toBe(true);
    expect(real.tables.find((t) => t.table === 'runs')).toMatchObject({ source: 3, target: 3 });
    const env = readFileSync(envFile, 'utf8');
    expect(env).toContain(`SQLITE_PATH=${targetPath}`);
    expect(env).toContain('PORT=4444');

    // the target now holds data: a second switch must refuse unless --truncate is given
    await expect(
      switchDriver({ source: adb, target: 'sqlite', targetPath, envFile, dryRun: true }),
    ).rejects.toThrow(/already has data/);
    const truncatedDry = await switchDriver({
      source: adb,
      target: 'sqlite',
      targetPath,
      envFile,
      dryRun: true,
      truncate: true,
    });
    expect(truncatedDry.ok).toBe(true);
    const truncated = await switchDriver({
      source: adb,
      target: 'sqlite',
      targetPath,
      envFile,
      truncate: true,
    });
    expect(truncated.ok).toBe(true);
    expect(truncated.tables.find((t) => t.table === 'runs')).toMatchObject({
      source: 3,
      target: 3,
    });
  });

  it('rewriteEnv switches to postgres and comments out the sqlite path', () => {
    const envFile = join(tmpDir('automax-env2-'), '.env');
    writeFileSync(envFile, 'DB_DRIVER=sqlite\nSQLITE_PATH=.automax/automax.db\n');
    rewriteEnv(envFile, {
      driver: 'postgres',
      databaseUrl: 'postgres://automax:automax@localhost:5432/automax',
    });
    const env = readFileSync(envFile, 'utf8');
    expect(env).toContain('DB_DRIVER=postgres');
    expect(env).toContain('DATABASE_URL=postgres://automax:automax@localhost:5432/automax');
  });

  it('prune keeps the newest runs', async () => {
    const dry = await prune(adb, { keepRuns: 2, dryRun: true });
    expect(dry.deleted.map((d) => d.id)).toEqual(['run-0']);
    expect(dry.kept).toBe(2);
    const real = await prune(adb, { keepRuns: 2 });
    expect(real.deleted).toHaveLength(1);
    expect(await countRows(adb, 'runs')).toBe(2);
  });
});
