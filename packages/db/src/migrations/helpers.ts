import type { CreateTableBuilder, Kysely } from 'kysely';
import type { Col } from '../col.js';

type Builder = CreateTableBuilder<string, string>;

/** Start a table with the `id text primary key` column. */
export function table(db: Kysely<any>, name: string, c: Col): Builder {
  return db.schema.createTable(name).addColumn('id', c.id, (cb) => cb.primaryKey());
}

/** Append `created_at` (+ optional `updated_at`) with a `now()` default. */
export function stamps(b: Builder, c: Col, withUpdated = true): Builder {
  let out = b.addColumn('created_at', c.ts, (cb) => cb.notNull().defaultTo(c.now));
  if (withUpdated) out = out.addColumn('updated_at', c.ts, (cb) => cb.notNull().defaultTo(c.now));
  return out;
}

export function fk(
  b: Builder,
  column: string,
  refTable: string,
  c: Col,
  opts: { nullable?: boolean; onDelete?: 'cascade' | 'set null' | 'restrict' } = {},
): Builder {
  return b.addColumn(column, c.id, (cb) => {
    let x = cb.references(`${refTable}.id`).onDelete(opts.onDelete ?? 'cascade');
    if (!opts.nullable) x = x.notNull();
    return x;
  });
}

export async function index(
  db: Kysely<any>,
  name: string,
  on: string,
  columns: string[],
  unique = false,
): Promise<void> {
  let b = db.schema.createIndex(name).on(on).columns(columns);
  if (unique) b = b.unique();
  await b.execute();
}

export async function dropTables(db: Kysely<any>, names: string[]): Promise<void> {
  for (const n of names) await db.schema.dropTable(n).ifExists().execute();
}
