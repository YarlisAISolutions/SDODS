import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { parse as parseYaml } from 'yaml';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, out, table } from '../ui.js';

type Row = Record<string, unknown>;

/** CSV/JSON/YAML → rows (CSV via csv-parse, loaded lazily). */
export async function readRows(file: string): Promise<Row[]> {
  const abs = resolve(file);
  const text = readFileSync(abs, 'utf8');
  const ext = extname(abs).toLowerCase();
  if (ext === '.json') {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [data];
  }
  if (ext === '.yaml' || ext === '.yml') {
    const data = parseYaml(text);
    return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [data];
  }
  const { parse } = await import('csv-parse/sync');
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    cast: true,
    cast_date: false,
  }) as Row[];
}

export function register(program: Command) {
  const data = program
    .command('data')
    .description('Import, preview and seed test data (CSV, JSON, YAML)');

  data
    .command('preview <file>')
    .description('Show the first rows and inferred columns of a data file')
    .option('--limit <n>', 'rows to show', '10')
    .action(async (file: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const rows = await readRows(file);
      const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const head = rows.slice(0, Number(opts.limit));
      if (ctx.opts.json) return json({ file, rows: rows.length, columns, sample: head });
      out(pc.dim(`${rows.length} row(s), columns: ${columns.join(', ')}`));
      table(head.map((r) => Object.fromEntries(columns.map((c) => [c, String(r[c] ?? '')]))));
    });

  data
    .command('import <dataset> <file>')
    .description(
      'Import a data file into the database (datasets table or a td_<project>_<dataset> table)',
    )
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment key (default: * = every environment)')
    .option('--to <target>', 'db (datasets/dataset_rows) or table (td_* table)', 'db')
    .option('--truncate', 'replace existing rows for this env when --to table')
    .action(async (dataset: string, file: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const entry = ctx.registry.entry(opts.project);
      const rows = await readRows(file);
      const m = await import('@automax/db');
      const adb = m.createDb();
      try {
        await m.migrateToLatest(adb);
        const projectId = await m.ensureProject(adb.db, adb.driver, entry.slug, entry.config.name);
        if (opts.to === 'table') {
          const res = await m.importRowsToTable(adb.db, adb.driver, {
            projectSlug: entry.slug,
            dataset,
            env: opts.env ?? '*',
            rows,
            truncate: Boolean(opts.truncate),
          });
          if (ctx.opts.json) return json(res);
          ok(`Imported ${res.inserted} row(s) into ${res.table} (${res.columns.join(', ')})`);
          return;
        }
        if (opts.to !== 'db')
          throw new AutomaxError('NOT_SUPPORTED', `--to must be db or table (got ${opts.to}).`, {
            exitCode: 2,
          });
        const res = await m.upsertDataset(adb.db, adb.driver, {
          projectId,
          envKey: opts.env ?? '*',
          name: dataset,
          kind: extname(file).slice(1) || 'json',
          storage: 'db',
          sourcePath: resolve(file),
          rows,
        });
        if (ctx.opts.json) return json(res);
        ok(
          `Imported dataset ${dataset} (${res.rowCount} row(s)) for ${entry.slug} [${opts.env ?? '*'}]`,
        );
      } finally {
        await adb.close();
      }
    });

  data
    .command('list')
    .description('List datasets stored in the database for a project')
    .requiredOption('-p, --project <slug>', 'project slug')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const m = await import('@automax/db');
      const adb = m.createDb();
      try {
        await m.migrateToLatest(adb);
        const project = await m.getProjectBySlug(adb.db, opts.project);
        const rows = project ? await m.listDatasets(adb.db, project.id) : [];
        const tables = (await m.listTdTables(adb.db as any, adb.driver)).filter((t) =>
          t.startsWith(`td_${opts.project.replace(/[^a-z0-9]+/g, '_')}_`),
        );
        if (ctx.opts.json) return json({ datasets: rows, tables });
        table(
          rows.map((d) => ({
            name: d.name,
            env: d.envKey,
            kind: d.kind,
            rows: d.rowCount,
            columns: d.columns.join(','),
          })),
        );
        if (tables.length) out(pc.dim(`td tables: ${tables.join(', ')}`));
      } finally {
        await adb.close();
      }
    });

  data
    .command('seed')
    .description(
      'Import every file under projects/<slug>/data/<env>/ and data/common/ into the database',
    )
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment (default: project default)')
    .option('--to <target>', 'db or table', 'db')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const entry = ctx.registry.entry(opts.project);
      const env = opts.env ?? entry.config.envs.default;
      const { existsSync, readdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const m = await import('@automax/db');
      const adb = m.createDb();
      const imported: Array<{ dataset: string; env: string; rows: number }> = [];
      try {
        await m.migrateToLatest(adb);
        const projectId = await m.ensureProject(adb.db, adb.driver, entry.slug, entry.config.name);
        for (const [envKey, dir] of [
          ['*', join(entry.root, 'data', 'common')],
          [env, join(entry.root, 'data', env)],
        ] as const) {
          if (!existsSync(dir)) continue;
          for (const f of readdirSync(dir)) {
            if (!/\.(csv|json|ya?ml)$/i.test(f)) continue;
            const dataset = f.replace(/\.(csv|json|ya?ml)$/i, '');
            const rows = await readRows(join(dir, f));
            if (opts.to === 'table')
              await m.importRowsToTable(adb.db, adb.driver, {
                projectSlug: entry.slug,
                dataset,
                env: envKey,
                rows,
                truncate: true,
              });
            else
              await m.upsertDataset(adb.db, adb.driver, {
                projectId,
                envKey,
                name: dataset,
                kind: f.split('.').pop()!,
                storage: 'db',
                sourcePath: join(dir, f),
                rows,
              });
            imported.push({ dataset, env: envKey, rows: rows.length });
          }
        }
        if (ctx.opts.json) return json(imported);
        table(imported);
        ok(`Seeded ${imported.length} dataset(s) for ${entry.slug}`);
      } finally {
        await adb.close();
      }
    });
}
