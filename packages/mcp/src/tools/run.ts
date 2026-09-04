import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { runFiles } from '@automax/contracts';
import { AutomaxCliError, automaxCli } from '../cli.js';
import {
  getRun,
  lastRun,
  listRuns,
  listScenarioDirs,
  readScenarioDir,
  screenshotUri,
  type ScenarioAttemptFiles,
} from '../fs.js';
import { defineTool, summarize } from '../registry/registry.js';

const runArgs = {
  project: z.string(),
  env: z.string().optional(),
  tags: z.string().optional().describe('Cucumber tag expression, e.g. "@smoke and not @mock"'),
  layers: z.array(z.enum(['ui', 'api', 'hybrid', 'recorded'])).optional(),
  browsers: z
    .array(z.enum(['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari']))
    .optional(),
  process: z
    .string()
    .optional()
    .describe('named process (pr-check, nightly-regression, release-gate …)'),
  modules: z.array(z.string()).optional(),
  harMode: z.enum(['off', 'update', 'replay']).optional(),
  workers: z.number().int().positive().optional(),
  retries: z.number().int().min(0).optional(),
  grep: z.string().optional(),
  headed: z.boolean().optional(),
  strict: z.boolean().optional().describe('with harMode replay: abort on any un-recorded request'),
  runId: z.string().optional(),
};

function buildRunCli(a: z.infer<z.ZodObject<typeof runArgs>>): string[] {
  const cli = ['run', '-p', a.project];
  if (a.env) cli.push('-e', a.env);
  if (a.tags) cli.push('-t', a.tags);
  for (const l of a.layers ?? []) cli.push('-l', l);
  for (const b of a.browsers ?? []) cli.push('-b', b);
  if (a.process) cli.push('--process', a.process);
  for (const m of a.modules ?? []) cli.push('--module', m);
  if (a.harMode === 'replay') cli.push('--har-replay');
  if (a.harMode === 'update') cli.push('--har-update');
  if (a.strict) cli.push('--strict');
  if (a.workers) cli.push('-w', String(a.workers));
  if (a.retries !== undefined) cli.push('--retries', String(a.retries));
  if (a.grep) cli.push('--grep', a.grep);
  if (a.headed) cli.push('--headed');
  if (a.runId) cli.push('--run-id', a.runId);
  return cli;
}

function scenarioView(runId: string, s: ScenarioAttemptFiles) {
  return {
    fingerprint: s.fingerprint,
    retry: s.retry,
    meta: s.meta,
    screenshots: s.screenshots.map((sh) => ({
      ...sh,
      uri: screenshotUri(runId, s.fingerprint, s.retry, sh.file),
    })),
    apiSnapshots: s.apiSnapshots,
    healEvents: s.healEvents,
  };
}

function summaryText(runId: string, summary: unknown, exitCode: number) {
  const s = summary as { totals?: Record<string, number>; failed?: unknown[] } | undefined;
  const t = s?.totals;
  const head = t
    ? `Run ${runId}: ${t.passed ?? 0} passed, ${t.failed ?? 0} failed, ${t.skipped ?? 0} skipped, ${t.flaky ?? 0} flaky (exit ${exitCode})`
    : `Run ${runId} finished with exit code ${exitCode}`;
  return summarize(head, summary ?? { runId, exitCode });
}

export const runTools = [
  defineTool({
    name: 'run_tests',
    title: 'Run tests',
    description:
      'Run a project slice through `automax run` (lint → bddgen → Playwright). Streams progress lines; returns the run id, totals, failed scenarios and report paths. Test failures are returned as data, not as a tool error.',
    shape: runArgs,
    access: 'run',
    domain: 'runs',
    capability: 'run',
    annotations: { openWorldHint: true },
    docsPath: '/docs/reference/cli-commands/run',
    handler: async (args, ctx) => {
      const cli = buildRunCli(args);
      let runId = args.runId;
      const onLine = (line: string) => {
        const m = /run[- ]?id[:=]\s*([0-9a-f-]{20,})/i.exec(line);
        if (m && !runId) runId = m[1];
        const p = /\[(\d+)\/(\d+)\]/.exec(line);
        ctx.onProgress?.({
          message: line.slice(0, 200),
          current: p ? Number(p[1]) : undefined,
          total: p ? Number(p[2]) : undefined,
        });
      };
      let exitCode = 0;
      let json: unknown;
      try {
        const r = await automaxCli(cli, {
          cwd: ctx.rootDir,
          signal: ctx.signal,
          onLine,
          timeoutMs: 60 * 60_000,
        });
        json = r.json;
      } catch (e) {
        if (!(e instanceof AutomaxCliError)) throw e;
        if (e.notSupported)
          return {
            text: 'automax run is not available in this build.',
            data: { note: 'command not available in this build' },
          };
        if (e.exitCode !== 1) throw e; // config/lint errors are real errors
        exitCode = 1;
        json = safeJson(e.stderr) ?? safeJson(e.message);
      }
      const summaryObj = (json as { runId?: string }) ?? {};
      runId = runId ?? summaryObj.runId ?? lastRun(ctx.rootDir)?.runId;
      const run = runId ? getRun(ctx.rootDir, runId) : undefined;
      const summary = run?.summary ?? json;
      return {
        text: summaryText(runId ?? '?', summary, exitCode),
        data: { runId, exitCode, summary, manifest: run?.manifest },
      };
    },
  }),
  defineTool({
    name: 'run_tests_async',
    title: 'Start a run (async)',
    description:
      'Start `automax run` in the background and return immediately with the run id; poll with run_get.',
    shape: runArgs,
    access: 'run',
    domain: 'runs',
    capability: 'run',
    annotations: { openWorldHint: true },
    handler: async (args, ctx) => {
      const { newRunId } = await import('@automax/contracts');
      const runId = args.runId ?? newRunId();
      const cli = buildRunCli({ ...args, runId });
      void automaxCli(cli, { cwd: ctx.rootDir, timeoutMs: 60 * 60_000 }).catch(() => undefined);
      return {
        text: `Run ${runId} started. Poll with run_get { runId: "${runId}" }.`,
        data: { runId, status: 'running' },
      };
    },
  }),
  defineTool({
    name: 'run_list',
    title: 'List runs',
    description:
      'Recent runs from the artifacts directory (newest first) with manifest and totals.',
    shape: {
      limit: z.number().int().positive().max(200).optional(),
      project: z.string().optional(),
    },
    access: 'read',
    domain: 'runs',
    capability: 'run',
    handler: async (args, ctx) => {
      const runs = listRuns(ctx.rootDir, args.limit ?? 20)
        .filter((r) => (args.project ? r.manifest?.projectSlug === args.project : true))
        .map((r) => ({
          runId: r.runId,
          project: r.manifest?.projectSlug,
          env: r.manifest?.env,
          startedAt: r.manifest?.startedAt,
          status: r.summary?.status ?? (r.summary ? 'finished' : 'running'),
          totals: r.summary?.totals,
          process: (r.manifest as { process?: string } | undefined)?.process,
        }));
      return { text: summarize(`Runs (${runs.length})`, runs), data: runs };
    },
  }),
  defineTool({
    name: 'run_get',
    title: 'Get run',
    description:
      'Manifest, summary, report paths and the scenario list of a run (use "last" for the latest).',
    shape: { runId: z.string() },
    access: 'read',
    domain: 'runs',
    capability: 'run',
    handler: async (args, ctx) => {
      const run = args.runId === 'last' ? lastRun(ctx.rootDir) : getRun(ctx.rootDir, args.runId);
      if (!run)
        throw Object.assign(new Error(`Unknown run ${args.runId}`), {
          error: { code: 'NOT_FOUND' },
        });
      const scenarios = listScenarioDirs(run.dir, run.manifest?.projectSlug).map((s) => ({
        fingerprint: s.fingerprint,
        retry: s.retry,
        name: s.meta?.scenarioName,
        feature: s.meta?.featureUri,
        status: s.meta?.status,
        durationMs: s.meta?.durationMs,
        screenshots: s.screenshots.length,
        apiCalls: s.apiSnapshots.length / 2,
        heals: s.healEvents.length,
      }));
      const data = {
        runId: run.runId,
        dir: run.dir,
        status:
          run.summary?.status ??
          (existsSync(join(run.dir, runFiles.summary)) ? 'finished' : 'running'),
        manifest: run.manifest,
        summary: run.summary,
        reports: {
          html: join(run.dir, runFiles.pwReport),
          dashboard: join(run.dir, runFiles.dashboard),
          messages: join(run.dir, runFiles.messages),
        },
        scenarios,
      };
      return {
        text: summarize(`Run ${run.runId}`, { ...data, scenarios: scenarios.slice(0, 50) }),
        data,
      };
    },
  }),
  defineTool({
    name: 'run_get_scenario',
    title: 'Get scenario result',
    description:
      'One scenario of a run: meta, steps, before/after screenshot URIs (automax://screenshot/…), API request/response snapshots and heal events.',
    shape: {
      runId: z.string(),
      fingerprint: z.string(),
      retry: z.number().int().min(0).optional(),
    },
    access: 'read',
    domain: 'runs',
    capability: 'run',
    handler: async (args, ctx) => {
      const run = args.runId === 'last' ? lastRun(ctx.rootDir) : getRun(ctx.rootDir, args.runId);
      if (!run)
        throw Object.assign(new Error(`Unknown run ${args.runId}`), {
          error: { code: 'NOT_FOUND' },
        });
      const all = listScenarioDirs(run.dir, run.manifest?.projectSlug).filter(
        (s) => s.fingerprint === args.fingerprint || s.meta?.scenarioName === args.fingerprint,
      );
      if (!all.length)
        throw Object.assign(
          new Error(`Scenario ${args.fingerprint} not found in run ${run.runId}`),
          { error: { code: 'NOT_FOUND' } },
        );
      const pick =
        args.retry !== undefined
          ? all.find((s) => s.retry === args.retry)
          : all.sort((a, b) => b.retry - a.retry)[0];
      const s = pick ?? all[0]!;
      const data = {
        runId: run.runId,
        ...scenarioView(run.runId, readScenarioDir(s.dir, s.fingerprint, s.retry)),
        attempts: all.map((a) => a.retry),
      };
      return {
        text: summarize(
          `Scenario ${s.meta?.scenarioName ?? s.fingerprint} (retry ${s.retry})`,
          data,
        ),
        data,
      };
    },
  }),
  defineTool({
    name: 'run_last_failed',
    title: 'Last failed scenarios',
    description:
      'Failed scenarios of the latest run (or a given run) with error messages and failure screenshots.',
    shape: { runId: z.string().optional(), project: z.string().optional() },
    access: 'read',
    domain: 'runs',
    capability: 'run',
    handler: async (args, ctx) => {
      const run = args.runId
        ? getRun(ctx.rootDir, args.runId)
        : listRuns(ctx.rootDir, 50).find((r) =>
            args.project ? r.manifest?.projectSlug === args.project : true,
          );
      if (!run) return { text: 'No runs found.', data: { failed: [] } };
      const failed = listScenarioDirs(run.dir, run.manifest?.projectSlug)
        .filter((s) => s.meta?.status && s.meta.status !== 'passed' && s.meta.status !== 'skipped')
        .map((s) => ({
          fingerprint: s.fingerprint,
          retry: s.retry,
          name: s.meta?.scenarioName,
          feature: s.meta?.featureUri,
          status: s.meta?.status,
          error: s.meta?.errorMessage,
          failureShot: s.screenshots.find((x) => x.phase === 'failure')
            ? screenshotUri(run.runId, s.fingerprint, s.retry, 'scenario-failure.png')
            : undefined,
        }));
      const fromSummary = run.summary?.failed ?? [];
      return {
        text: summarize(
          `Failed in ${run.runId}: ${failed.length || fromSummary.length}`,
          failed.length ? failed : fromSummary,
        ),
        data: { runId: run.runId, failed: failed.length ? failed : fromSummary },
      };
    },
  }),
  defineTool({
    name: 'heal_events',
    title: 'Heal events',
    description:
      'Self-healing locator events of a run (or the last run): original selector, chosen strategy, candidates and scores.',
    shape: { runId: z.string().optional(), project: z.string().optional() },
    access: 'read',
    domain: 'runs',
    capability: 'run',
    handler: async (args, ctx) => {
      const run = args.runId
        ? getRun(ctx.rootDir, args.runId)
        : listRuns(ctx.rootDir, 50).find((r) =>
            args.project ? r.manifest?.projectSlug === args.project : true,
          );
      if (!run) return { text: 'No runs found.', data: { events: [] } };
      const events = listScenarioDirs(run.dir, run.manifest?.projectSlug).flatMap((s) =>
        s.healEvents.map((e) => ({
          fingerprint: s.fingerprint,
          retry: s.retry,
          scenario: s.meta?.scenarioName,
          ...(e as Record<string, unknown>),
        })),
      );
      return {
        text: summarize(`Heal events in ${run.runId}: ${events.length}`, events),
        data: { runId: run.runId, events },
      };
    },
  }),
  defineTool({
    name: 'heal_locator_stats',
    title: 'Locator stats',
    description:
      'Aggregate heal events across recent runs per original selector: occurrences, winning strategies, suggested selector.',
    shape: {
      project: z.string().optional(),
      runs: z.number().int().positive().max(200).optional(),
    },
    access: 'read',
    domain: 'runs',
    capability: 'run',
    handler: async (args, ctx) => {
      const stats = new Map<
        string,
        {
          selector: string;
          description?: string;
          occurrences: number;
          strategies: Record<string, number>;
          suggested?: string;
          lastRun: string;
        }
      >();
      for (const run of listRuns(ctx.rootDir, args.runs ?? 30).filter((r) =>
        args.project ? r.manifest?.projectSlug === args.project : true,
      )) {
        for (const s of listScenarioDirs(run.dir, run.manifest?.projectSlug)) {
          for (const raw of s.healEvents as Array<Record<string, unknown>>) {
            const key = String(raw.originalSelector ?? raw.original ?? '?');
            const entry = stats.get(key) ?? {
              selector: key,
              description: raw.description as string | undefined,
              occurrences: 0,
              strategies: {},
              lastRun: run.runId,
            };
            entry.occurrences++;
            const strategy = String(
              raw.strategyUsed ??
                (raw.chosen as { strategy?: string } | undefined)?.strategy ??
                'none',
            );
            entry.strategies[strategy] = (entry.strategies[strategy] ?? 0) + 1;
            entry.suggested =
              (raw.healedSelector as string | undefined) ??
              (raw.chosen as { selector?: string } | undefined)?.selector ??
              entry.suggested;
            stats.set(key, entry);
          }
        }
      }
      const rows = [...stats.values()].sort((a, b) => b.occurrences - a.occurrences);
      return { text: summarize(`Locator stats (${rows.length} selectors)`, rows), data: rows };
    },
  }),
];

function safeJson(s: string | undefined): unknown {
  if (!s) return undefined;
  const m = /\{[\s\S]*\}$/m.exec(s.trim());
  if (!m) return undefined;
  try {
    return JSON.parse(m[0]);
  } catch {
    return undefined;
  }
}

export function readRunLog(dir: string): string | undefined {
  const f = join(dir, runFiles.log);
  return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
}
