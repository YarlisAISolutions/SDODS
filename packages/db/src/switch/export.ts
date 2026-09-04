import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { AutomaxDb } from '../create-db.js';
import { TABLES_IN_FK_ORDER } from '../schema.js';
import { listTdTables } from '../test-data.js';

export interface ExportResult {
  dir: string;
  tables: Array<{ table: string; rows: number; file: string }>;
}

/** Stream every platform table (+ td_* tables) to `<dir>/<table>.jsonl` in FK order. */
export async function exportAll(
  adb: AutomaxDb,
  dir: string,
  opts: { batch?: number } = {},
): Promise<ExportResult> {
  mkdirSync(dir, { recursive: true });
  const batch = opts.batch ?? 1000;
  const tables = [...TABLES_IN_FK_ORDER, ...(await listTdTables(adb.db as any, adb.driver))];
  const out: ExportResult = { dir, tables: [] };
  for (const table of tables) {
    const file = join(dir, `${table}.jsonl`);
    const stream = createWriteStream(file);
    let offset = 0;
    let count = 0;
    for (;;) {
      const rows = (await (adb.db as any)
        .selectFrom(table)
        .selectAll()
        .orderBy('id')
        .limit(batch)
        .offset(offset)
        .execute()
        .catch(async () => {
          // td_* tables have no id column
          const res =
            await sql`select * from ${sql.table(table)} limit ${batch} offset ${offset}`.execute(
              adb.db,
            );
          return res.rows;
        })) as Record<string, unknown>[];
      for (const row of rows) stream.write(JSON.stringify(normalizeRow(row)) + '\n');
      count += rows.length;
      offset += rows.length;
      if (rows.length < batch) break;
    }
    await new Promise<void>((resolve, reject) =>
      stream.end((e: unknown) => (e ? reject(e) : resolve())),
    );
    out.tables.push({ table, rows: count, file });
  }
  return out;
}

/** JSON columns decoded, Dates → ISO, Buffers → base64 so both dialects produce the same JSONL. */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (Buffer.isBuffer(v)) out[k] = { $base64: v.toString('base64') };
    else if (k.endsWith('_json') && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else out[k] = v;
  }
  return out;
}

export async function countRows(adb: AutomaxDb, table: string): Promise<number> {
  const res = await sql<{
    n: number | string;
  }>`select count(*) as n from ${sql.table(table)}`.execute(adb.db);
  return Number(res.rows[0]?.n ?? 0);
}
