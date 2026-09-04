import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { sql } from 'kysely';
import type { AutomaxDb } from '../create-db.js';
import { TABLES_IN_FK_ORDER } from '../schema.js';
import { isTdTable, listTdColumns } from '../test-data.js';

export interface ImportResult {
  tables: Array<{ table: string; rows: number; skipped: number }>;
}

const BOOL_COLUMNS = new Set([
  'archived',
  'is_default',
  'flaky',
  'will_be_retried',
  'succeeded',
  'accepted',
  'quarantined',
  'enabled',
  'active',
  'catch_up',
]);

/**
 * Load `<dir>/<table>.jsonl` files in FK order inside one transaction, `ON CONFLICT DO NOTHING`.
 * td_* tables are created on the fly (text columns) when missing.
 */
export async function importAll(
  adb: AutomaxDb,
  dir: string,
  opts: { batch?: number } = {},
): Promise<ImportResult> {
  const batch = opts.batch ?? 500;
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const known = new Set(TABLES_IN_FK_ORDER as string[]);
  const ordered = [
    ...TABLES_IN_FK_ORDER.filter((t) => files.includes(`${t}.jsonl`)),
    ...files
      .map((f) => f.replace(/\.jsonl$/, ''))
      .filter((t) => !known.has(t) && isTdTable(t))
      .sort(),
  ];
  const result: ImportResult = { tables: [] };
  await adb.db.transaction().execute(async (trx) => {
    for (const table of ordered) {
      const file = join(dir, `${table}.jsonl`);
      if (!existsSync(file)) continue;
      const rows: Record<string, unknown>[] = [];
      let inserted = 0;
      let skipped = 0;
      const flush = async () => {
        if (rows.length === 0) return;
        const values = rows.map((r) => denormalizeRow(adb, r));
        if (isTdTable(table)) await ensureTdTable(trx, adb, table, Object.keys(values[0]!));
        const q = (trx as any).insertInto(table).values(values);
        const res = isTdTable(table)
          ? await q.execute()
          : await q.onConflict((oc: any) => oc.doNothing()).execute();
        const n = Number(res?.[0]?.numInsertedOrUpdatedRows ?? rows.length);
        inserted += n;
        skipped += rows.length - n;
        rows.length = 0;
      };
      const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        const t = line.trim();
        if (!t) continue;
        rows.push(JSON.parse(t));
        if (rows.length >= batch) await flush();
      }
      await flush();
      result.tables.push({ table, rows: inserted, skipped });
    }
  });
  return result;
}

function denormalizeRow(adb: AutomaxDb, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && '$base64' in (v as any))
      out[k] = Buffer.from((v as any).$base64, 'base64');
    else if (k.endsWith('_json')) out[k] = v == null ? null : JSON.stringify(v);
    else if (BOOL_COLUMNS.has(k) && v != null)
      out[k] = adb.driver === 'postgres' ? Boolean(v) : v ? 1 : 0;
    else out[k] = v;
  }
  return out;
}

async function ensureTdTable(trx: any, adb: AutomaxDb, table: string, columns: string[]) {
  const existing = await listTdColumns(trx, adb.driver, table);
  if (existing.length === 0) {
    let b = trx.schema
      .createTable(table)
      .addColumn('row_index', 'integer', (cb: any) => cb.notNull())
      .addColumn('env', 'text', (cb: any) => cb.notNull().defaultTo('*'));
    for (const c of columns) if (c !== 'row_index' && c !== 'env') b = b.addColumn(c, 'text');
    await b.execute();
  } else {
    for (const c of columns)
      if (!existing.includes(c)) await trx.schema.alterTable(table).addColumn(c, 'text').execute();
  }
  await sql`select 1`.execute(trx);
}
