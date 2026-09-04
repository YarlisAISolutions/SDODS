import { sql, type RawBuilder } from 'kysely';
import type { Driver } from './driver.js';

/**
 * Dialect helper used by migrations and repos. All primary keys are app-generated UUIDv7 text,
 * so nothing here deals with autoincrement and `db switch` is a plain row copy.
 */
export function col(driver: Driver) {
  const pg = driver === 'postgres';
  return {
    pg,
    id: 'text' as const,
    text: 'text' as const,
    ts: (pg ? 'timestamptz' : 'text') as 'timestamptz' | 'text',
    json: (pg ? 'jsonb' : 'text') as 'jsonb' | 'text',
    bool: (pg ? 'boolean' : 'integer') as 'boolean' | 'integer',
    int: 'integer' as const,
    big: (pg ? 'bigint' : 'integer') as 'bigint' | 'integer',
    real: (pg ? 'double precision' : 'real') as 'double precision' | 'real',
    now: (pg ? sql`now()` : sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`) as RawBuilder<string>,
  };
}

export type Col = ReturnType<typeof col>;

/** Write-side codecs (reads are normalised by the driver: JSON plugin on sqlite, type parsers on pg). */
export const enc = {
  json: (v: unknown): string => JSON.stringify(v ?? null),
  bool: (driver: Driver, v: boolean | null | undefined): boolean | number | null =>
    v == null ? null : driver === 'postgres' ? Boolean(v) : v ? 1 : 0,
  ts: (v: Date | string | null | undefined): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString(),
};

/** JSON value for a jsonb column on Postgres; plain JSON string on sqlite. */
export function jsonVal(driver: Driver, v: unknown): RawBuilder<unknown> | string {
  const text = JSON.stringify(v ?? null);
  return driver === 'postgres' ? sql`${text}::jsonb` : text;
}

export function readBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 't';
}

export function readJson<T = unknown>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

export function readTs(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function nowIso(): string {
  return new Date().toISOString();
}
