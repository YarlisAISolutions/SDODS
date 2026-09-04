import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { parse as parseYaml } from 'yaml';
import { WorkspaceFileSchema } from '@automax/contracts';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, out, table, warn } from '../ui.js';

async function loadDb() {
  return import('@automax/db');
}

export function register(program: Command) {
  const db = program
    .command('db')
    .description('Migrate, inspect and switch the platform database (DB_DRIVER=sqlite|postgres)');

  db.command('migrate')
    .description('Apply pending migrations (creates the SQLite file on first use)')
    .option('--to <name>', 'migrate up/down to a specific migration')
    .option('--down', 'roll back one migration')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const m = await loadDb();
      const adb = m.createDb();
      try {
        const results = opts.down
          ? await m.migrateDown(adb)
          : opts.to
            ? await m.migrateTo(adb, opts.to)
            : await m.migrateToLatest(adb);
        const rows = results.map((r) => ({
          migration: r.migrationName,
          direction: r.direction,
          status: r.status,
        }));
        if (ctx.opts.json) return json({ driver: adb.driver, results: rows });
        out(
          pc.dim(
            `driver: ${adb.driver}${adb.driver === 'sqlite' ? ` (${adb.config.sqlitePath})` : ''}`,
          ),
        );
        if (rows.length === 0) ok('Database is up to date');
        else table(rows);
      } finally {
        await adb.close();
      }
    });

  db.command('status')
    .description('Show applied and pending migrations')
    .action(async (_opts, cmd) => {
      const ctx = createContext(cmd);
      const m = await loadDb();
      const adb = m.createDb();
      try {
        const status = await m.migrationStatus(adb);
        if (ctx.opts.json)
          return json({
            driver: adb.driver,
            config: { ...adb.config, databaseUrl: redactUrl(adb.config.databaseUrl) },
            migrations: status,
          });
        out(
          pc.bold(`driver: ${adb.driver}`) +
            pc.dim(
              adb.driver === 'sqlite'
                ? `  ${adb.config.sqlitePath}`
                : `  ${redactUrl(adb.config.databaseUrl)}`,
            ),
        );
        table(
          status.map((s) => ({
            migration: s.name,
            applied: s.executedAt ? s.executedAt : pc.yellow('pending'),
          })),
        );
      } finally {
        await adb.close();
      }
    });

  db.command('reset')
    .description('Drop every AutoMax table (sqlite only)')
    .option('--yes', 'confirm')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      if (!opts.yes)
        throw new AutomaxError('NOT_SUPPORTED', 'db reset is destructive; pass --yes to confirm.', {
          exitCode: 2,
        });
      const m = await loadDb();
      const adb = m.createDb();
      try {
        await m.resetDatabase(adb);
        if (ctx.opts.json) return json({ ok: true });
        ok('Database reset');
      } finally {
        await adb.close();
      }
    });

  db.command('switch <target>')
    .description('Copy the database to sqlite|postgres, verify counts and update .env')
    .option('--target-url <url>', 'Postgres connection string for the target')
    .option('--target-path <path>', 'SQLite file for the target')
    .option('--dry-run', 'copy and verify, but do not rewrite .env')
    .option('--env-file <file>', 'dotenv file to update', '.env')
    .option('--yes', 'skip confirmation')
    .action(async (target: string, opts, cmd) => {
      const ctx = createContext(cmd);
      if (target !== 'sqlite' && target !== 'postgres') {
        throw new AutomaxError(
          'NOT_SUPPORTED',
          `Unknown target "${target}"; use sqlite or postgres.`,
          { exitCode: 2 },
        );
      }
      if (!opts.dryRun && !opts.yes) {
        throw new AutomaxError(
          'NOT_SUPPORTED',
          'db switch rewrites .env; pass --yes (or --dry-run to preview).',
          { exitCode: 2 },
        );
      }
      const m = await loadDb();
      const source = m.createDb();
      try {
        const result = await m.switchDriver({
          source,
          target,
          targetUrl: opts.targetUrl,
          targetPath: opts.targetPath,
          dryRun: Boolean(opts.dryRun),
          envFile: resolve(ctx.rootDir, opts.envFile),
        });
        if (ctx.opts.json) return json(result);
        table(
          result.tables.map((t) => ({
            table: t.table,
            source: t.source,
            target: t.target,
            ok: t.ok ? pc.green('ok') : pc.red('MISMATCH'),
          })),
        );
        if (!result.ok) {
          warn('Row counts do not match; .env was not changed.');
          process.exitCode = 1;
          return;
        }
        if (result.dryRun) ok(`Dry run: ${target} copy verified. Re-run with --yes to switch.`);
        else
          ok(`Switched to ${target}. Updated ${result.envFile}: ${result.envChanges?.join(', ')}`);
      } finally {
        await source.close();
      }
    });

  db.command('export <dir>')
    .description('Export every table to <dir>/<table>.jsonl')
    .action(async (dir: string, _opts, cmd) => {
      const ctx = createContext(cmd);
      const m = await loadDb();
      const adb = m.createDb();
      try {
        const res = await m.exportAll(adb, dir);
        if (ctx.opts.json) return json(res);
        table(res.tables.map((t) => ({ table: t.table, rows: t.rows })));
        ok(`Exported to ${res.dir}`);
      } finally {
        await adb.close();
      }
    });

  db.command('import <dir>')
    .description('Import <dir>/<table>.jsonl files (ON CONFLICT DO NOTHING)')
    .action(async (dir: string, _opts, cmd) => {
      const ctx = createContext(cmd);
      const m = await loadDb();
      const adb = m.createDb();
      try {
        await m.migrateToLatest(adb);
        const res = await m.importAll(adb, dir);
        if (ctx.opts.json) return json(res);
        table(res.tables.map((t) => ({ table: t.table, inserted: t.rows, skipped: t.skipped })));
      } finally {
        await adb.close();
      }
    });

  db.command('prune')
    .description('Delete old runs and their artifact directories')
    .option('--keep-runs <n>', 'runs to keep per project')
    .option('--keep-days <n>', 'delete runs older than n days')
    .option('-p, --project <slug>', 'limit to one project')
    .option('--dry-run', 'list what would be deleted')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      if (!opts.keepRuns && !opts.keepDays) {
        throw new AutomaxError('NOT_SUPPORTED', 'Pass --keep-runs and/or --keep-days.', {
          exitCode: 2,
        });
      }
      const m = await loadDb();
      const adb = m.createDb();
      try {
        const res = await m.prune(adb, {
          keepRuns: opts.keepRuns ? Number(opts.keepRuns) : undefined,
          keepDays: opts.keepDays ? Number(opts.keepDays) : undefined,
          projectSlug: opts.project,
          artifactsRoot: join(ctx.rootDir, process.env.AUTOMAX_ARTIFACTS_DIR ?? '.automax/runs'),
          dryRun: Boolean(opts.dryRun),
        });
        if (ctx.opts.json) return json(res);
        table(
          res.deleted.map((d) => ({ run: d.id, project: d.projectSlug, created: d.createdAt })),
        );
        ok(
          `${opts.dryRun ? 'Would delete' : 'Deleted'} ${res.deleted.length} run(s); kept ${res.kept}`,
        );
      } finally {
        await adb.close();
      }
    });

  db.command('sync')
    .description(
      'Upsert organization, workspaces, projects, modules and processes from the yaml files',
    )
    .action(async (_opts, cmd) => {
      const ctx = createContext(cmd);
      const m = await loadDb();
      const adb = m.createDb();
      try {
        await m.migrateToLatest(adb);
        const wsFile = join(ctx.rootDir, 'automax.workspace.yaml');
        const workspaceFile = existsSync(wsFile)
          ? WorkspaceFileSchema.parse(parseYaml(readFileSync(wsFile, 'utf8')))
          : null;
        const projects = ctx.registry
          .entriesList()
          .map((e) => ({ config: e.config, root: e.root }));
        const res = await m.syncHierarchy(adb.db, adb.driver, { workspaceFile, projects });
        if (ctx.opts.json) return json(res);
        ok(
          `Synced ${workspaceFile ? `organization ${workspaceFile.organization.slug}, ${Object.keys(res.workspaces).length} workspace(s), ` : ''}${Object.keys(res.projects).length} project(s), ${res.modules} module(s), ${res.processes} process(es)`,
        );
      } finally {
        await adb.close();
      }
    });
}

function redactUrl(url?: string): string {
  if (!url) return '';
  return url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}
