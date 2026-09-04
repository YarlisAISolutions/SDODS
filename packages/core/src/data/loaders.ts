import { readFileSync, statSync } from 'node:fs';
import { parse as parseCsv } from 'csv-parse/sync';
import { parse as parseYaml } from 'yaml';
import type { DataSource } from '@sdods/contracts';
import type * as DbModule from '@sdods/db';
import { SdodsError } from '../errors.js';
import { interpolateString } from '../config/interpolate.js';
import type { ResolvedConfig } from '../config/resolve.js';
import type { Row } from './types.js';
import { resolveDataPath } from './resolve-path.js';

const cache = new Map<string, { mtimeMs: number; rows: Row[] }>();

function readCached(file: string, parse: (text: string) => Row[]): Row[] {
  const mtimeMs = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.rows;
  const rows = parse(readFileSync(file, 'utf8'));
  cache.set(file, { mtimeMs, rows });
  return rows;
}

function normalizeRows(raw: unknown, file: string): Row[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).rows)
      ? (raw as any).rows
      : undefined;
  if (!arr)
    throw new SdodsError(
      'CONFIG_INVALID',
      `${file} must contain an array of rows (or { rows: [...] }).`,
    );
  return arr as Row[];
}

/** `${VAR}` inside cell values resolves against dotenv + process env (passwords in CSV stay out of git). */
function interpolateRows(rows: Row[], vars: Record<string, string | undefined>): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r))
      out[k] =
        typeof v === 'string' && v.includes('${')
          ? interpolateString(v, { vars, onUnresolved: 'keep' })
          : v;
    return out;
  });
}

export async function loadFileSource(
  config: ResolvedConfig,
  spec: DataSource,
  vars: Record<string, string | undefined>,
): Promise<Row[]> {
  switch (spec.type) {
    case 'csv': {
      const file = resolveDataPath(config.project.root, spec, config.env.name);
      return interpolateRows(
        readCached(
          file,
          (text) =>
            parseCsv(text, {
              columns: true,
              cast: true,
              cast_date: false,
              skip_empty_lines: true,
              trim: true,
              bom: true,
            }) as Row[],
        ),
        vars,
      );
    }
    case 'json': {
      const file = resolveDataPath(config.project.root, spec, config.env.name);
      return interpolateRows(
        readCached(file, (text) => normalizeRows(JSON.parse(text), file)),
        vars,
      );
    }
    case 'yaml': {
      const file = resolveDataPath(config.project.root, spec, config.env.name);
      return interpolateRows(
        readCached(file, (text) => normalizeRows(parseYaml(text), file)),
        vars,
      );
    }
    case 'openapi': {
      const { loadOpenApi, openApiComponentSchema } = await import('../api/validate.js');
      const doc = await loadOpenApi(config, spec.spec);
      const schema = openApiComponentSchema(doc, spec.schema) as
        { example?: unknown; examples?: unknown[] } | undefined;
      if (!schema)
        throw new SdodsError(
          'DATASET_NOT_FOUND',
          `OpenAPI component schema "${spec.schema}" not found in ${spec.spec}.`,
        );
      const examples = schema.examples ?? (schema.example !== undefined ? [schema.example] : []);
      return examples as Row[];
    }
    case 'db': {
      if (!config.env.db)
        throw new SdodsError(
          'DB_REQUIRED',
          `Dataset table "${spec.table}" needs env.db in envs/${config.env.name}.yaml.`,
        );
      let mod: typeof DbModule;
      try {
        mod = await import('@sdods/db');
      } catch {
        throw new SdodsError(
          'DB_REQUIRED',
          `Dataset uses type "db" but @sdods/db is not available.`,
          { hint: 'Install @sdods/db and configure env.db in envs/<env>.yaml.' },
        );
      }
      const adb = mod.createDb(
        config.env.db.driver === 'postgres'
          ? { driver: 'postgres', databaseUrl: config.env.db.url }
          : { driver: 'sqlite', sqlitePath: config.env.db.url.replace(/^file:/, '') },
      );
      try {
        const rows = await mod.readTableRows(adb.db as any, spec.table, config.env.name);
        return rows.map(
          (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== spec.envColumn)) as Row,
        );
      } finally {
        await adb.close();
      }
    }
  }
}
