import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { runFiles } from '@sdods/contracts';
import { SdodsError } from '@sdods/core';
import { createContext } from '../context.js';
import { json, ok, out, table } from '../ui.js';

function artifactsRoot(rootDir: string): string {
  return resolve(rootDir, process.env.SDODS_ARTIFACTS_DIR ?? '.sdods/runs');
}

function latestRunId(root: string): string | null {
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .map((name) => ({ name, dir: join(root, name) }))
    .filter(
      (d) =>
        statSync(d.dir).isDirectory() &&
        (existsSync(join(d.dir, runFiles.manifest)) ||
          existsSync(join(d.dir, runFiles.messages)) ||
          existsSync(join(d.dir, runFiles.pwResults))),
    )
    .sort((a, b) => statSync(b.dir).mtimeMs - statSync(a.dir).mtimeMs);
  return dirs[0]?.name ?? null;
}

function readJsonFile<T = unknown>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function openPath(p: string) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  await execa(cmd, [p], { shell: process.platform === 'win32' }).catch(() => undefined);
}

export function register(program: Command) {
  const report = program
    .command('report')
    .description('Open reports of a run, ingest results into the database, render dashboards')
    .option('--last', 'use the most recent run')
    .option('--run <id>', 'run id')
    .option('--open', 'open the Playwright HTML report and dashboard')
    .option('--html', 'open only the Playwright HTML report')
    .option('--dashboard', 'open only the SDODS dashboard')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const root = artifactsRoot(ctx.rootDir);
      const runId: string | null = opts.run ?? latestRunId(root);
      if (!runId)
        throw new SdodsError('RUN_FAILED', `No runs found under ${root}.`, {
          hint: 'Run `sdods run -p <slug>` first.',
          exitCode: 2,
        });
      const dir = join(root, runId);
      const manifest = readJsonFile<Record<string, unknown>>(join(dir, runFiles.manifest));
      const summary = readJsonFile<Record<string, unknown>>(join(dir, runFiles.summary));
      const html = join(dir, runFiles.pwReport, 'index.html');
      const dashboard = join(dir, runFiles.dashboard, 'index.html');
      const info = {
        runId,
        dir,
        manifest,
        summary,
        reports: {
          html: existsSync(html) ? html : null,
          dashboard: existsSync(dashboard) ? dashboard : null,
          messages: existsSync(join(dir, runFiles.messages)) ? join(dir, runFiles.messages) : null,
        },
      };
      if (ctx.opts.json) return json(info);
      out(pc.bold(`Run ${runId}`) + pc.dim(`  ${dir}`));
      if (manifest)
        out(
          pc.dim(`project ${manifest.projectSlug} · env ${manifest.env} · ${manifest.startedAt}`),
        );
      if (summary?.totals) {
        const t = summary.totals as Record<string, number>;
        out(
          `${pc.green(`${t.passed ?? 0} passed`)}  ${pc.red(`${t.failed ?? 0} failed`)}  ${pc.yellow(`${t.flaky ?? 0} flaky`)}  ${pc.dim(`${t.skipped ?? 0} skipped`)}`,
        );
      }
      table(
        Object.entries(info.reports).map(([k, v]) => ({
          report: k,
          path: v ?? pc.dim('(missing)'),
        })),
      );
      if (opts.open || opts.html) if (info.reports.html) await openPath(info.reports.html);
      if (opts.open || opts.dashboard)
        if (info.reports.dashboard) await openPath(info.reports.dashboard);
    });

  report
    .command('ingest [files...]')
    .description('Ingest cucumber messages NDJSON and Playwright JSON results into the database')
    .requiredOption('--run-id <id>', 'run id (directory name under the artifacts root)')
    .option('-p, --project <slug>', 'project slug when run.json is missing')
    .option('--manifest <file>', 'explicit run.json path')
    .option('--format <fmt>', 'auto|cucumber|pw-json', 'auto')
    .option('--artifacts-dir <dir>', 'artifacts root (default .sdods/runs)')
    .option('--replace', 'delete previously ingested rows of this run first')
    .option('-e, --env <name>', 'environment name when run.json is missing')
    .option(
      '--server <url>',
      'upload to an SDODS server (POST /api/runs/:id/ingest) instead of writing to a local database',
    )
    .option('--token <token>', 'API token for --server (or SDODS_TOKEN)')
    .action(async (files: string[], opts, cmd) => {
      const ctx = createContext(cmd);
      const serverUrl: string | undefined = opts.server ?? process.env.SDODS_SERVER_URL;
      if (serverUrl) {
        // CI path: no DB credentials on the runner; the server ingests with a scoped token.
        const token: string | undefined = opts.token ?? process.env.SDODS_TOKEN;
        if (!token)
          throw new SdodsError('AUTH_FAILED', '--server needs --token (or SDODS_TOKEN).', {
            exitCode: 2,
          });
        const { readFileSync, existsSync } = await import('node:fs');
        const { basename } = await import('node:path');
        const form = new FormData();
        let count = 0;
        for (const f of files) {
          const abs = resolve(ctx.rootDir, f);
          if (!existsSync(abs)) continue;
          form.append('files', new Blob([readFileSync(abs)]), basename(abs));
          count++;
        }
        if (!count)
          throw new SdodsError('CONFIG_INVALID', 'No existing files to upload.', { exitCode: 2 });
        const url = `${serverUrl.replace(/\/$/, '')}/api/runs/${encodeURIComponent(opts.runId)}/ingest`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: form,
        });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok)
          throw new SdodsError(
            'RUN_FAILED',
            `Server ingest failed (${res.status}): ${JSON.stringify(body)}`,
            {
              exitCode: 1,
            },
          );
        if (ctx.opts.json) return json(body);
        return ok(`Uploaded ${count} file(s) for run ${opts.runId} to ${serverUrl}`);
      }
      const m = await import('@sdods/db');
      const adb = m.createDb();
      try {
        await m.migrateToLatest(adb);
        const root = opts.artifactsDir
          ? resolve(ctx.rootDir, opts.artifactsDir)
          : artifactsRoot(ctx.rootDir);
        const ndjson: string[] = [];
        const pwJson: string[] = [];
        for (const f of files) {
          const abs = resolve(ctx.rootDir, f);
          const fmt =
            opts.format === 'auto'
              ? abs.endsWith('.ndjson')
                ? 'cucumber'
                : 'pw-json'
              : opts.format;
          (fmt === 'cucumber' ? ndjson : pwJson).push(abs);
        }
        const manifest = opts.manifest
          ? readJsonFile<any>(resolve(ctx.rootDir, opts.manifest))
          : undefined;
        const res = await m.ingestRun(adb, {
          runId: opts.runId,
          projectSlug: opts.project,
          manifest,
          ndjsonPaths: ndjson,
          pwJsonPaths: pwJson,
          artifactsRoot: root,
          replace: Boolean(opts.replace),
          env: opts.env,
        });
        if (ctx.opts.json) return json(res);
        ok(
          `Ingested run ${res.runId} (${res.projectSlug}): ${res.scenarios} scenario(s), ${res.attempts} attempt(s), ${res.steps} step(s), ${res.artifacts} artifact(s), ${res.healEvents} heal event(s)`,
        );
        const t = res.totals;
        out(
          `${pc.green(`${t.passed} passed`)}  ${pc.red(`${t.failed} failed`)}  ${pc.yellow(`${t.flaky} flaky`)}  ${pc.dim(`${t.skipped} skipped`)}  → ${res.status}`,
        );
        if (res.filesSkipped.length)
          out(pc.dim(`skipped (already ingested): ${res.filesSkipped.join(', ')}`));
        if (res.parseErrors) out(pc.yellow(`${res.parseErrors} unparsable line(s) skipped`));
      } finally {
        await adb.close();
      }
    });

  program
    .command('show-report')
    .description('Open the Playwright HTML report of a run')
    .option('--run <id>', 'run id (default: latest)')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const root = artifactsRoot(ctx.rootDir);
      const runId: string | null = opts.run ?? latestRunId(root);
      if (!runId)
        throw new SdodsError('RUN_FAILED', `No runs found under ${root}.`, { exitCode: 2 });
      const html = join(root, runId, runFiles.pwReport, 'index.html');
      if (!existsSync(html))
        throw new SdodsError('RUN_FAILED', `No HTML report at ${html}.`, { exitCode: 2 });
      await execa('npx', ['playwright', 'show-report', join(root, runId, runFiles.pwReport)], {
        stdio: 'inherit',
        cwd: ctx.rootDir,
      });
    });
}
