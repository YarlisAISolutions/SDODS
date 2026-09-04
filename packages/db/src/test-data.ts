import { sql, type Kysely } from 'kysely';
import type { Driver } from './driver.js';

export type Row = Record<string, unknown>;

/** `td_<slug>_<name>` — user-defined test-data tables share the platform DB on both dialects. */
export function tdTableName(projectSlug: string, dataset: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  return `td_${clean(projectSlug)}_${clean(dataset)}`;
}

export function isTdTable(name: string): boolean {
  return /^td_[a-z0-9_]+$/.test(name);
}

/** Create (if needed) and fill a test-data table. Columns are text; `env` and `row_index` are always present. */
export async function importRowsToTable(
  db: Kysely<any>,
  driver: Driver,
  input: { projectSlug: string; dataset: string; env?: string; rows: Row[]; truncate?: boolean },
): Promise<{ table: string; inserted: number; columns: string[] }> {
  const table = tdTableName(input.projectSlug, input.dataset);
  const env = input.env ?? '*';
  const columns = [...new Set(input.rows.flatMap((r) => Object.keys(r)))].filter(
    (c) => c !== 'env' && c !== 'row_index',
  );
  const existing = await listTdColumns(db, driver, table);
  if (existing.length === 0) {
    let b = db.schema
      .createTable(table)
      .addColumn('row_index', 'integer', (cb) => cb.notNull())
      .addColumn('env', 'text', (cb) => cb.notNull().defaultTo('*'));
    for (const c of columns) b = b.addColumn(c, 'text');
    await b.execute();
    await db.schema
      .createIndex(`idx_${table}_env`)
      .on(table)
      .columns(['env', 'row_index'])
      .execute();
  } else {
    for (const c of columns)
      if (!existing.includes(c)) await db.schema.alterTable(table).addColumn(c, 'text').execute();
  }
  if (input.truncate) await db.deleteFrom(table).where('env', '=', env).execute();
  const values = input.rows.map((r, i) => {
    const out: Record<string, unknown> = { row_index: i, env };
    for (const c of columns)
      out[c] = r[c] == null ? null : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c]);
    return out;
  });
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insertInto(table)
      .values(values.slice(i, i + 500))
      .execute();
  }
  return { table, inserted: values.length, columns };
}

export async function readTableRows(db: Kysely<any>, table: string, env?: string): Promise<Row[]> {
  let q = db.selectFrom(table).selectAll().orderBy('row_index');
  if (env) q = q.where('env', 'in', [env, '*']);
  const rows = (await q.execute()) as Row[];
  return rows.map(({ row_index: _i, env: _e, ...rest }) => rest);
}

export async function listTdTables(db: Kysely<any>, driver: Driver): Promise<string[]> {
  if (driver === 'postgres') {
    const res = await sql<{
      table_name: string;
    }>`select table_name from information_schema.tables where table_schema = current_schema() and table_name like 'td\_%'`.execute(
      db,
    );
    return res.rows.map((r) => r.table_name).filter(isTdTable);
  }
  const res = await sql<{
    name: string;
  }>`select name from sqlite_master where type = 'table' and name like 'td\\_%' escape '\\'`.execute(
    db,
  );
  return res.rows.map((r) => r.name).filter(isTdTable);
}

export async function listTdColumns(
  db: Kysely<any>,
  driver: Driver,
  table: string,
): Promise<string[]> {
  if (!isTdTable(table)) return [];
  if (driver === 'postgres') {
    const res = await sql<{
      column_name: string;
    }>`select column_name from information_schema.columns where table_schema = current_schema() and table_name = ${table} order by ordinal_position`.execute(
      db,
    );
    return res.rows.map((r) => r.column_name);
  }
  const res = await sql<{ name: string }>`select name from pragma_table_info(${table})`.execute(db);
  return res.rows.map((r) => r.name);
}
