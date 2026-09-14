import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { runFiles } from '@sdods/contracts';
import { SdodsError } from '@sdods/core';
import { createContext } from '../context.js';
import { json, ok, out, table, warn } from '../ui.js';

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
          existsSync(join(d.dir, runFiles.results))),
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
    .option('--open', 'open the HTML report and dashboard')
    .option('--html', 'open only the HTML report')
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
      const html = join(dir, runFiles.htmlReport, 'index.html');
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
    .description('Ingest cucumber messages NDJSON and runner JSON results into the database')
    .requiredOption('--run-id <id>', 'run id (directory name under the artifacts root)')
    .option('-p, --project <slug>', 'project slug when run.json is missing')
    .option('--manifest <file>', 'explicit run.json path')
    .option('--format <fmt>', 'auto|cucumber|runner-json (alias: pw-json)', 'auto')
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
        const runnerJson: string[] = [];
        for (const f of files) {
          const abs = resolve(ctx.rootDir, f);
          const fmt =
            opts.format === 'auto'
              ? abs.endsWith('.ndjson')
                ? 'cucumber'
                : 'runner-json'
              : // `pw-json` is the pre-1.0 name, still accepted
                opts.format === 'pw-json'
                ? 'runner-json'
                : opts.format;
          (fmt === 'cucumber' ? ndjson : runnerJson).push(abs);
        }
        const manifest = opts.manifest
          ? readJsonFile<any>(resolve(ctx.rootDir, opts.manifest))
          : undefined;
        const res = await m.ingestRun(adb, {
          runId: opts.runId,
          projectSlug: opts.project,
          manifest,
          ndjsonPaths: ndjson,
          runnerJsonPaths: runnerJson,
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

  report
    .command('merge <dirs...>')
    .description('Merge sharded run reports into one HTML report and JUnit file')
    .option('--run <id>', 'run id to write the merged report into (default: latest)')
    .option('--reporter <list>', 'reporters for the merged output', 'html,junit')
    .action(async (dirs: string[], opts, cmd) => {
      const ctx = createContext(cmd);
      const root = artifactsRoot(ctx.rootDir);
      // `report` defines --run too, and Commander hands it to the parent wherever it appears.
      const parent = (cmd.parent?.opts() ?? {}) as { run?: string };
      const runId: string | null = opts.run ?? parent.run ?? latestRunId(root);
      if (!runId) {
        throw new SdodsError('CONFIG_NOT_FOUND', 'No run to merge into.', {
          hint: 'Pass --run <id>, or run a suite first.',
          exitCode: 2,
        });
      }
      const runDir = join(root, runId);
      const missing = dirs.filter((d) => !existsSync(resolve(ctx.rootDir, d)));
      if (missing.length) {
        throw new SdodsError(
          'CONFIG_NOT_FOUND',
          `No such shard report directory: ${missing.join(', ')}`,
          {
            hint: 'Each argument is a directory of shard reports downloaded from CI.',
            exitCode: 2,
          },
        );
      }
      // Shard reports are produced by `sdods run --reporter blob --shard i/n`; merging them
      // rebuilds one HTML report and JUnit file for the whole matrix.
      const args = [
        'playwright',
        'merge-reports',
        '--reporter',
        opts.reporter,
        ...dirs.map((d) => resolve(ctx.rootDir, d)),
      ];
      const res = await execa('npx', args, {
        cwd: ctx.rootDir,
        reject: false,
        env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: join(runDir, runFiles.htmlReport) },
      });
      if (res.exitCode !== 0) {
        throw new SdodsError('RUN_FAILED', `Merging shard reports failed (exit ${res.exitCode}).`, {
          hint: res.stderr?.split('\n').slice(-3).join(' ') || undefined,
        });
      }
      if (ctx.opts.json)
        return json({ runId, merged: dirs.length, htmlReport: join(runDir, runFiles.htmlReport) });
      ok(`Merged ${dirs.length} shard report dir(s) into ${join(runDir, runFiles.htmlReport)}`);
    });

  report
    .command('traceability')
    .description(
      'Export requirement → scenario → result traceability for a run (@req:<id> tags), with an empty sign-off block',
    )
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'only consider runs against this environment')
    .option('--run <id>', 'run id (default: the latest run of the project)')
    .option('--last', 'use the latest run of the project; fail if there is none')
    .option(
      '--format <fmt>',
      'json|csv|md|html (default: from the -o extension, else json with --json, else md)',
    )
    .option('-o, --output <file>', 'write the export to a file instead of stdout')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      // `report` defines --run/--last itself, and Commander hands options it knows to the parent
      // wherever they appear, so read them from both.
      const parent = (cmd.parent?.opts() ?? {}) as { run?: string; last?: boolean };
      const runOpt: string | undefined = opts.run ?? parent.run;
      const last = Boolean(opts.last ?? parent.last);
      const {
        TRACEABILITY_FORMATS,
        buildTraceabilityReport,
        latestRunFor,
        readRunManifest,
        renderTraceability,
      } = await import('@sdods/core/analyze');

      const output: string | undefined = opts.output
        ? resolve(process.cwd(), opts.output)
        : undefined;
      const fromExt = output
        ? (
            {
              '.json': 'json',
              '.csv': 'csv',
              '.md': 'md',
              '.html': 'html',
              '.htm': 'html',
            } as const
          )[extname(output).toLowerCase() as '.json']
        : undefined;
      // -o's extension decides the file format; --json then only shapes the confirmation line.
      const format = (opts.format ?? fromExt ?? (ctx.opts.json ? 'json' : 'md')) as string;
      if (!(TRACEABILITY_FORMATS as readonly string[]).includes(format))
        throw new SdodsError('CONFIG_INVALID', `Unknown format "${format}".`, {
          hint: `Use one of: ${TRACEABILITY_FORMATS.join(', ')}.`,
          exitCode: 2,
        });

      const slug: string = opts.project;
      const project = { ...ctx.registry.get(slug), root: ctx.registry.rootOf(slug) };
      const root = artifactsRoot(ctx.rootDir);
      let run: { runId: string; dir: string } | undefined;
      if (runOpt) {
        const dir = join(root, runOpt);
        if (!existsSync(dir))
          throw new SdodsError('RUN_FAILED', `No run "${runOpt}" under ${root}.`, { exitCode: 2 });
        const m = readRunManifest(dir);
        if (m && m.projectSlug !== slug)
          throw new SdodsError(
            'CONFIG_INVALID',
            `Run ${runOpt} belongs to project "${m.projectSlug}", not "${slug}".`,
            { exitCode: 2 },
          );
        if (m && opts.env && m.env !== opts.env)
          throw new SdodsError(
            'CONFIG_INVALID',
            `Run ${runOpt} ran against "${m.env}", not "${opts.env}".`,
            { exitCode: 2 },
          );
        run = { runId: runOpt, dir };
      } else {
        run = latestRunFor(root, slug, opts.env) ?? undefined;
        if (!run && last)
          throw new SdodsError(
            'RUN_FAILED',
            `No runs of ${slug}${opts.env ? ` on ${opts.env}` : ''} under ${root}.`,
            {
              hint: `Run \`sdods run -p ${slug}\` first, or omit --last for a static matrix.`,
              exitCode: 2,
            },
          );
        if (!run)
          warn(
            `No runs of ${slug}${opts.env ? ` on ${opts.env}` : ''} found: every scenario is reported as not run.`,
          );
      }

      const traceReport = await buildTraceabilityReport({ project, run });
      const text = renderTraceability(traceReport, format as 'json');
      if (!output) return out(text);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, text);
      const s = traceReport.summary;
      if (ctx.opts.json)
        return json({ output, format, run: traceReport.run?.id ?? null, summary: s });
      ok(`Wrote ${format} traceability export to ${output}`);
      out(
        `${s.requirements} requirement(s): ${pc.green(`${s.passed} passed`)}  ${pc.red(`${s.failed} failed`)}  ${pc.yellow(`${s.notRun} not run`)}  ${s.notCovered == null ? pc.dim('not covered: unknown') : pc.magenta(`${s.notCovered} not covered`)}`,
      );
    });

  program
    .command('show-report')
    .description('Open the HTML report of a run')
    .option('--run <id>', 'run id (default: latest)')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const root = artifactsRoot(ctx.rootDir);
      const runId: string | null = opts.run ?? latestRunId(root);
      if (!runId)
        throw new SdodsError('RUN_FAILED', `No runs found under ${root}.`, { exitCode: 2 });
      const html = join(root, runId, runFiles.htmlReport, 'index.html');
      if (!existsSync(html))
        throw new SdodsError('RUN_FAILED', `No HTML report at ${html}.`, { exitCode: 2 });
      await execa('npx', ['playwright', 'show-report', join(root, runId, runFiles.htmlReport)], {
        stdio: 'inherit',
        cwd: ctx.rootDir,
      });
    });
}
