import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, type SdodsDb } from '../create-db.js';
import { DEFAULT_SQLITE_PATH, type Driver, type DriverConfig } from '../driver.js';
import { migrateToLatest } from '../migrate.js';
import { TABLES_IN_FK_ORDER } from '../schema.js';
import { listTdTables } from '../test-data.js';
import { countRows, exportAll } from './export.js';
import { importAll } from './import.js';

export interface SwitchOptions {
  source: SdodsDb;
  target: Driver;
  targetUrl?: string;
  targetPath?: string;
  dryRun?: boolean;
  /** clear the target's platform tables before importing (required when the target has data) */
  truncate?: boolean;
  envFile?: string;
  keepExport?: boolean;
}

export interface SwitchResult {
  target: DriverConfig;
  dryRun: boolean;
  tables: Array<{ table: string; source: number; target: number; ok: boolean }>;
  ok: boolean;
  envFile?: string;
  envChanges?: string[];
}

/**
 * Copy the platform database to the other driver: migrate target → export → import → verify counts →
 * (unless dry-run) rewrite DB_DRIVER/DATABASE_URL/SQLITE_PATH in `.env`.
 */
export async function switchDriver(opts: SwitchOptions): Promise<SwitchResult> {
  const targetCfg: DriverConfig =
    opts.target === 'postgres'
      ? { driver: 'postgres', databaseUrl: opts.targetUrl ?? process.env.DATABASE_URL }
      : {
          driver: 'sqlite',
          sqlitePath: opts.targetPath ?? process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH,
        };
  if (targetCfg.driver === 'postgres' && !targetCfg.databaseUrl)
    throw new Error('switch to postgres needs --target-url or DATABASE_URL');
  if (opts.source.driver === targetCfg.driver && sameLocation(opts.source.config, targetCfg)) {
    throw new Error(`Source and target are the same ${targetCfg.driver} database.`);
  }

  const target = createDb(targetCfg);
  const dir = mkdtempSync(join(tmpdir(), 'sdods-switch-'));
  try {
    await migrateToLatest(target);

    // A target that already holds platform rows cannot be merged safely: slug conflicts would keep
    // the target's ids while child rows reference the source's ids (foreign key failures).
    const occupied: string[] = [];
    for (const table of TABLES_IN_FK_ORDER) {
      const n = await countRows(target, table).catch(() => 0);
      if (n > 0) occupied.push(`${table} (${n})`);
    }
    if (occupied.length && !opts.truncate) {
      throw new Error(
        `Target ${targetCfg.driver} database already has data in ${occupied.join(', ')}. ` +
          'Point at an empty database, or pass --truncate to clear its platform tables first.',
      );
    }
    if (occupied.length && opts.truncate && !opts.dryRun) {
      for (const table of [...TABLES_IN_FK_ORDER].reverse()) {
        await target.db.deleteFrom(table as any).execute();
      }
    }

    const tables = [
      ...TABLES_IN_FK_ORDER,
      ...(await listTdTables(opts.source.db as any, opts.source.driver)),
    ];

    if (opts.dryRun) {
      // Verify without writing: report what would be copied and confirm the target is (or will be) empty.
      const rows: SwitchResult['tables'] = [];
      for (const table of tables) {
        const s = await countRows(opts.source, table);
        const t = await countRows(target, table).catch(() => 0);
        rows.push({
          table,
          source: s,
          target: opts.truncate ? 0 : t,
          ok: opts.truncate || t === 0,
        });
      }
      return { target: targetCfg, dryRun: true, tables: rows, ok: rows.every((r) => r.ok) };
    }

    await exportAll(opts.source, dir);
    await importAll(target, dir);
    const rows: SwitchResult['tables'] = [];
    for (const table of tables) {
      const s = await countRows(opts.source, table);
      const t = await countRows(target, table).catch(() => -1);
      rows.push({ table, source: s, target: t, ok: t >= s });
    }
    const ok = rows.every((r) => r.ok);
    const result: SwitchResult = {
      target: targetCfg,
      dryRun: false,
      tables: rows,
      ok,
    };
    if (!ok) return result;
    const envFile = resolve(opts.envFile ?? '.env');
    result.envFile = envFile;
    result.envChanges = rewriteEnv(envFile, targetCfg);
    return result;
  } finally {
    await target.close();
    if (!opts.keepExport) rmSync(dir, { recursive: true, force: true });
  }
}

function sameLocation(a: DriverConfig, b: DriverConfig): boolean {
  if (a.driver !== b.driver) return false;
  if (a.driver === 'postgres') return a.databaseUrl === b.databaseUrl;
  return resolve(a.sqlitePath ?? '') === resolve(b.sqlitePath ?? '');
}

/** Rewrite DB_DRIVER and the matching URL/path in a dotenv file, preserving other lines. */
export function rewriteEnv(envFile: string, cfg: DriverConfig): string[] {
  const lines = existsSync(envFile)
    ? readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .filter((l, i, arr) => !(i === arr.length - 1 && l === ''))
    : [];
  const set = (key: string, value: string | undefined) => {
    const idx = lines.findIndex((l) => new RegExp(`^\\s*#?\\s*${key}=`).test(l));
    if (value === undefined) {
      if (idx >= 0 && !lines[idx]!.trim().startsWith('#')) lines[idx] = `# ${lines[idx]}`;
      return `${key} commented out`;
    }
    const line = `${key}=${value}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    return line;
  };
  const changes = [set('DB_DRIVER', cfg.driver)];
  if (cfg.driver === 'postgres') {
    changes.push(set('DATABASE_URL', cfg.databaseUrl));
  } else {
    changes.push(set('SQLITE_PATH', cfg.sqlitePath));
  }
  writeFileSync(envFile, lines.join('\n').replace(/\n*$/, '\n'));
  return changes;
}
