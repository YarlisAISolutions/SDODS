import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import {
  legacyRunFiles,
  runFiles,
  type GateResult,
  type ProcessConfig,
  type RunManifest,
  type RunSummary,
} from '@sdods/contracts';
import {
  SdodsError,
  collectGateEvidence,
  evaluateGates,
  gateReportsFromRunnerJson,
  gateTotalsFromRunnerStats,
  hasGates,
  ingestGateJudge,
} from '@sdods/core';
import { createContext } from '../context.js';
import { gateFailedError, printGates } from '../gates.js';
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

/**
 * The process `report merge` judges: `--process` (with `-p`, or the project in a run.json), or the
 * process a run.json names when it declares gates. `undefined` when there is nothing to judge.
 */
function resolveMergeProcess(
  ctx: ReturnType<typeof createContext>,
  input: { process?: string; project?: string; manifestDirs: string[] },
): { slug: string; process: ProcessConfig } | undefined {
  const manifest = input.manifestDirs
    .map((d) => readJsonFile<Partial<RunManifest>>(join(d, runFiles.manifest)))
    .find(Boolean);
  const name = input.process ?? manifest?.process;
  if (!name) return undefined;
  const slug = input.project ?? manifest?.projectSlug;
  if (!slug)
    throw new SdodsError(
      'CONFIG_INVALID',
      `--process ${name} needs the project that defines it, and no run.json names one.`,
      {
        hint: `Pass -p <slug>: sdods report merge --process ${name} -p <slug> <dirs...>`,
        exitCode: 2,
      },
    );
  let proc: ProcessConfig;
  try {
    proc = ctx.registry.processOf(slug, name);
  } catch (e) {
    // Named explicitly, an unknown process is an error. Inferred from a run.json this checkout
    // cannot resolve, it only means there is nothing here to judge it by; the merge still runs.
    if (input.process) throw e;
    warn(
      `run.json names process "${name}" of ${slug}, which this checkout does not define: gates not judged.`,
    );
    return undefined;
  }
  if (!hasGates(proc.gates)) {
    // Named explicitly, a process without gates is a mistake worth saying; inferred, it is not.
    if (input.process)
      warn(`process "${name}" of ${slug} declares no gates, so there is nothing to judge.`);
    return undefined;
  }
  return { slug, process: proc };
}

/**
 * A merge workspace for `playwright merge-reports`: the blob reports of every directory copied into
 * one (it reads exactly one directory; prefixed, because two runs' shard 1 carry the same file
 * name), and a merge config that pins the root the report paths are relative to. Blobs recorded
 * under different checkouts, such as CI's Playwright container (`/__w/…`) and its bare runner
 * (`/home/runner/work/…`), otherwise refuse to merge ("recorded with different test directories").
 */
function mergeWorkspace(
  dirs: string[],
  rootDir: string,
): { reports: string; config: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-merge-'));
  const reports = join(dir, 'reports');
  mkdirSync(reports);
  dirs.forEach((from, i) => {
    for (const name of readdirSync(from))
      if (name.endsWith('.zip')) copyFileSync(join(from, name), join(reports, `${i + 1}-${name}`));
  });
  const config = join(dir, 'merge.config.mjs');
  writeFileSync(config, `export default ${JSON.stringify({ testDir: rootDir })};\n`);
  return { reports, config, dir };
}

/** The error Playwright printed, rather than the last lines of its stack. */
function mergeFailureHint(stderr: string | undefined): string | undefined {
  const lines = (stderr ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*Error\b/.test(l));
  const picked =
    at >= 0 ? lines.slice(at, at + 12).filter((l) => !/^\s+at /.test(l)) : lines.slice(-3);
  return picked.join(' ').replace(/\s+/g, ' ').trim() || undefined;
}

/** Writes the merged verdict where `sdods run --process` writes one, so ingest records it the same way. */
function recordMergedGates(runDir: string, gates: GateResult): void {
  writeFileSync(join(runDir, runFiles.gates), JSON.stringify(gates, null, 2));
  const manifestFile = join(runDir, runFiles.manifest);
  const manifest = readJsonFile<RunManifest>(manifestFile);
  if (manifest)
    writeFileSync(
      manifestFile,
      JSON.stringify({ ...manifest, gatesPassed: gates.passed }, null, 2),
    );
  const summaryFile = join(runDir, runFiles.summary);
  const summary = readJsonFile<RunSummary>(summaryFile);
  if (summary) writeFileSync(summaryFile, JSON.stringify({ ...summary, gates }, null, 2));
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
          // A run with no gates.json whose process declares gates is judged here, as the run would have been.
          gates: ingestGateJudge({
            manifest: manifest ?? m.readManifest(join(root, opts.runId)),
            runDir: join(root, opts.runId),
            processOf: (slug, name) => ctx.registry.processOf(slug, name),
          }),
        });
        if (ctx.opts.json) return json(res);
        ok(
          `Ingested run ${res.runId} (${res.projectSlug}): ${res.scenarios} scenario(s), ${res.attempts} attempt(s), ${res.steps} step(s), ${res.artifacts} artifact(s), ${res.healEvents} heal event(s)`,
        );
        const t = res.totals;
        out(
          `${pc.green(`${t.passed} passed`)}  ${pc.red(`${t.failed} failed`)}  ${pc.yellow(`${t.flaky} flaky`)}  ${pc.dim(`${t.skipped} skipped`)}  → ${res.status}`,
        );
        if (res.gates)
          out(
            `gates · process ${res.gates.process}: ${
              res.gates.passed
                ? pc.green('passed')
                : pc.red(
                    `FAILED (${res.gates.rows
                      .filter((r) => !r.passed)
                      .map((r) => r.gate)
                      .join(', ')})`,
                  )
            }`,
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
    .description(
      'Merge sharded run reports into one HTML report and JUnit file, and judge process gates on the whole run',
    )
    .option('--run <id>', 'run id to write the merged report into (default: latest)')
    .option('--reporter <list>', 'reporters for the merged output', 'html,junit')
    .option(
      '--process <name>',
      "evaluate this process's gates over the merged shards; exit 1 when one is not met (default: the process in run.json, when it declares gates)",
    )
    .option('-p, --project <slug>', 'project that defines --process (default: from run.json)')
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
      const shardDirs = dirs.map((d) => resolve(ctx.rootDir, d));

      // The run directory each shard report sits in (`<run>/shard-reports`) holds that shard's
      // @a11y and @perf scenario reports, which is the gate evidence the merged report lacks.
      const shardRunDirs = shardDirs
        .filter((d) =>
          ([runFiles.shardReports, legacyRunFiles.shardReports] as string[]).includes(basename(d)),
        )
        .map((d) => dirname(d));
      const gated = resolveMergeProcess(ctx, {
        process: opts.process,
        project: opts.project,
        manifestDirs: [runDir, ...shardRunDirs],
      });

      const reporters = String(opts.reporter)
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const mergedJson = join(runDir, runFiles.mergedResults);
      if (gated && !reporters.includes('json')) reporters.push('json');
      if (gated) mkdirSync(runDir, { recursive: true });

      // Shard reports are produced by `sdods run --reporter blob --shard i/n`; merging them
      // rebuilds one HTML report and JUnit file for the whole matrix.
      const workspace = mergeWorkspace(shardDirs, ctx.rootDir);
      const args = [
        'playwright',
        'merge-reports',
        '--config',
        workspace.config,
        '--reporter',
        reporters.join(','),
        workspace.reports,
      ];
      const res = await execa('npx', args, {
        cwd: ctx.rootDir,
        reject: false,
        env: {
          ...process.env,
          PLAYWRIGHT_HTML_OUTPUT_DIR: join(runDir, runFiles.htmlReport),
          ...(gated ? { PLAYWRIGHT_JSON_OUTPUT_FILE: mergedJson } : {}),
        },
      });

      let gates: GateResult | undefined;
      try {
        if (res.exitCode !== 0) {
          throw new SdodsError(
            'RUN_FAILED',
            `Merging shard reports failed (exit ${res.exitCode}).`,
            { hint: mergeFailureHint(res.stderr) },
          );
        }
        if (gated) {
          const merged = readJsonFile<{ stats?: Parameters<typeof gateTotalsFromRunnerStats>[0] }>(
            mergedJson,
          );
          gates = evaluateGates({
            process: gated.process.name,
            gates: gated.process.gates,
            totals: gateTotalsFromRunnerStats(merged?.stats),
            // The shards' run directories, and the reports attached in the blobs themselves: a
            // download of the shard reports alone still carries its evidence.
            evidence: collectGateEvidence(
              [runDir, ...shardRunDirs],
              gateReportsFromRunnerJson(merged),
            ),
          });
          recordMergedGates(runDir, gates);
        }
      } finally {
        rmSync(workspace.dir, { recursive: true, force: true });
      }

      if (ctx.opts.json)
        json({
          runId,
          merged: dirs.length,
          htmlReport: join(runDir, runFiles.htmlReport),
          ...(gates ? { gates } : {}),
        });
      else {
        ok(`Merged ${dirs.length} shard report dir(s) into ${join(runDir, runFiles.htmlReport)}`);
        if (gates) printGates(gates);
      }
      if (gates && !gates.passed) throw gateFailedError(gates, join(runDir, runFiles.gates));
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
