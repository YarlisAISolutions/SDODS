import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import { parse as parseYaml } from 'yaml';
import { projectRoot, readYaml, safeJoin } from '../fs.js';
import { defineTool, summarize } from '../registry/registry.js';

const SECRET_COL = /(password|secret|token|apikey|api_key)/i;

export function maskRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, SECRET_COL.test(k) && v ? '***' : v])),
  );
}

export function loadRows(file: string): Array<Record<string, unknown>> {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.csv'))
    return parseCsv(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Array<Record<string, unknown>>;
  if (file.endsWith('.json')) {
    const j = JSON.parse(text) as unknown;
    return Array.isArray(j)
      ? (j as Array<Record<string, unknown>>)
      : ((j as { rows?: Array<Record<string, unknown>> }).rows ?? []);
  }
  const y = parseYaml(text) as unknown;
  return Array.isArray(y)
    ? (y as Array<Record<string, unknown>>)
    : ((y as { rows?: Array<Record<string, unknown>> })?.rows ?? []);
}

/** Resolve a dataset file for an env with the AutoMax fallback chain. */
export function resolveDatasetFile(
  root: string,
  spec: { path?: string; fallback?: string },
  env?: string,
): string | undefined {
  const candidates: string[] = [];
  if (spec.path) {
    if (env) candidates.push(spec.path.replace('{env}', env));
    if (!spec.path.includes('{env}')) candidates.push(spec.path);
  }
  if (spec.fallback) candidates.push(spec.fallback);
  if (spec.path) {
    const base = spec.path.split('/').pop()!;
    candidates.push(`data/common/${base}`);
  }
  for (const c of candidates) {
    const f = safeJoin(root, c);
    if (existsSync(f)) return f;
  }
  return undefined;
}

export const dataTools = [
  defineTool({
    name: 'data_list_datasets',
    title: 'List datasets',
    description:
      'Datasets declared in a project yaml (type, path, fallback) and which file resolves for an environment.',
    shape: { project: z.string(), env: z.string().optional() },
    access: 'read',
    domain: 'datasets',
    capability: 'data',
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const yaml = readYaml<{
        data?: {
          sources?: Record<
            string,
            { type: string; path?: string; fallback?: string; table?: string }
          >;
          userPool?: unknown;
        };
      }>(join(root, 'automax.project.yaml'));
      const sources = yaml?.data?.sources ?? {};
      const rows = Object.entries(sources).map(([name, spec]) => ({
        name,
        ...spec,
        resolvedFile:
          spec.type === 'db' || spec.type === 'openapi'
            ? undefined
            : resolveDatasetFile(root, spec, args.env)?.replace(root + '/', ''),
      }));
      return {
        text: summarize(`Datasets of ${args.project}`, {
          sources: rows,
          userPool: yaml?.data?.userPool,
        }),
        data: { sources: rows, userPool: yaml?.data?.userPool },
      };
    },
  }),
  defineTool({
    name: 'data_preview',
    title: 'Preview dataset',
    description:
      'First N rows of a dataset (csv/json/yaml) for an environment; password-like columns are masked.',
    shape: {
      project: z.string(),
      dataset: z.string(),
      env: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    access: 'read',
    domain: 'datasets',
    capability: 'data',
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const yaml = readYaml<{
        data?: { sources?: Record<string, { type: string; path?: string; fallback?: string }> };
      }>(join(root, 'automax.project.yaml'));
      const spec = yaml?.data?.sources?.[args.dataset];
      if (!spec)
        throw Object.assign(new Error(`Unknown dataset ${args.dataset}`), {
          error: { code: 'DATASET_NOT_FOUND' },
        });
      if (spec.type === 'db' || spec.type === 'openapi')
        return {
          text: `Dataset ${args.dataset} is of type ${spec.type}; preview needs a database/spec (not available here).`,
          data: { note: `type ${spec.type}` },
        };
      const file = resolveDatasetFile(root, spec, args.env);
      if (!file)
        return {
          text: `No file resolves for ${args.dataset} (env ${args.env ?? 'default'}).`,
          data: { rows: [] },
          isError: true,
        };
      const rows = maskRows(loadRows(file)).slice(0, args.limit ?? 20);
      return {
        text: summarize(
          `${args.dataset} from ${file.replace(root + '/', '')} (${rows.length} rows)`,
          rows,
        ),
        data: { file: file.replace(root + '/', ''), rows },
      };
    },
  }),
  defineTool({
    name: 'data_pool_status',
    title: 'User pool status',
    description:
      'Pool users by role for an environment (from the pool dataset) and current lease lock files.',
    shape: { project: z.string(), env: z.string().optional() },
    access: 'read',
    domain: 'datasets',
    capability: 'data',
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const yaml = readYaml<{
        data?: {
          sources?: Record<string, { type: string; path?: string; fallback?: string }>;
          userPool?: { dataset: string; roleColumn?: string };
        };
      }>(join(root, 'automax.project.yaml'));
      const pool = yaml?.data?.userPool;
      if (!pool) return { text: 'No user pool configured.', data: { roles: {} } };
      const spec = yaml?.data?.sources?.[pool.dataset];
      const file = spec ? resolveDatasetFile(root, spec, args.env) : undefined;
      const rows = file ? loadRows(file) : [];
      const roleCol = pool.roleColumn ?? 'role';
      const roles: Record<string, number> = {};
      for (const r of rows)
        roles[String(r[roleCol] ?? 'unknown')] = (roles[String(r[roleCol] ?? 'unknown')] ?? 0) + 1;
      const leaseDir = join(ctx.rootDir, '.automax', 'leases', args.project, args.env ?? '');
      const leases = existsSync(leaseDir) ? (await import('node:fs')).readdirSync(leaseDir) : [];
      return {
        text: summarize(`Pool for ${args.project}`, { roles, leases }),
        data: { dataset: pool.dataset, file: file?.replace(root + '/', ''), roles, leases },
      };
    },
  }),
];
