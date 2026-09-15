import { relative, resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  DEFAULT_ARTIFACTS_DIR,
  SdodsError,
  acceptVisualFailures,
  listVisualFailures,
  selectVisualFailures,
} from '@sdods/core';
import type { VisualFailure } from '@sdods/contracts';
import { createContext, type CliContext } from '../context.js';
import { heading, json, ok, out, table } from '../ui.js';
import { listRuns } from './trace.js';

function artifactsDirOf(ctx: CliContext, flag?: string): string {
  return resolvePath(ctx.rootDir, flag ?? process.env.SDODS_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR);
}

function findRun(ctx: CliContext, opts: { run?: string; artifactsDir?: string }) {
  const artifactsDir = artifactsDirOf(ctx, opts.artifactsDir);
  const runs = listRuns(artifactsDir);
  const run = opts.run ? runs.find((r) => r.runId === opts.run) : runs[0];
  if (!run)
    throw new SdodsError(
      'CONFIG_NOT_FOUND',
      opts.run
        ? `Run ${opts.run} not found under ${artifactsDir}.`
        : `No runs under ${artifactsDir}.`,
      {
        hint: 'Run `sdods run -t @visual …` first, or download the CI run into .sdods/runs/<id>.',
        exitCode: 2,
      },
    );
  return run;
}

const pct = (r?: number) => (r === undefined ? '' : `${(r * 100).toFixed(2)}%`);

export function register(program: Command) {
  const baselines = program
    .command('baselines')
    .description('Review failed visual baseline checks of a run and accept the new screenshots');

  baselines
    .command('diff')
    .description('List the visual checks that failed in a run: expected, actual and diff images')
    .option('--run <id>', 'run id (default: the most recent run)')
    .option('--artifacts-dir <dir>', `artifacts directory (default: ${DEFAULT_ARTIFACTS_DIR})`)
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const run = findRun(ctx, opts);
      const failures = listVisualFailures(run.dir);
      const abs = (p?: string) => (p ? resolvePath(run.dir, p) : undefined);
      if (ctx.opts.json)
        return json({
          runId: run.runId,
          failures: failures.map((f) => ({
            ...f,
            actual: abs(f.actual),
            expected: abs(f.expected),
            diff: abs(f.diff),
          })),
        });
      if (!failures.length) {
        ok(`No failed visual checks in run ${run.runId}.`);
        return;
      }
      heading(`${failures.length} failed visual check(s) in run ${run.runId}`);
      const rel = (p?: string) => (p ? relative(ctx.rootDir, p) : '—');
      for (const f of failures) {
        out('');
        out(`${pc.bold(`${f.runnerProject}/${f.name}`)}  ${pc.dim(f.platform)}  ${reasonLabel(f)}`);
        out(`  scenario  ${f.scenarioName} ${pc.dim(`(${f.featureUri})`)}`);
        out(`  baseline  ${f.baseline}`);
        table([
          { image: 'expected', path: rel(abs(f.expected)) },
          { image: 'actual', path: rel(abs(f.actual)) },
          { image: 'diff', path: rel(abs(f.diff)) },
        ]);
      }
      out('');
      out(
        pc.dim(
          `Accept after reviewing the diff: sdods baselines accept <name…> --run ${run.runId}  (or --all)`,
        ),
      );
    });

  baselines
    .command('accept [names...]')
    .description(
      'Copy the actual screenshot of failed visual checks over their baselines (writes to the project tree)',
    )
    .requiredOption('--run <id>', 'run id the screenshots come from (required)')
    .option('--all', 'accept every failed visual check of the run')
    .option('--artifacts-dir <dir>', `artifacts directory (default: ${DEFAULT_ARTIFACTS_DIR})`)
    .action(async (names: string[], opts, cmd) => {
      const ctx = createContext(cmd);
      if (opts.all && names.length)
        throw new SdodsError('CONFIG_INVALID', 'Pass baseline names or --all, not both.', {
          exitCode: 2,
        });
      const run = findRun(ctx, opts);
      const failures = listVisualFailures(run.dir);
      if (!failures.length)
        throw new SdodsError('CONFIG_NOT_FOUND', `No failed visual checks in run ${run.runId}.`, {
          hint: 'Nothing to accept. `sdods baselines diff --run <id>` lists what failed.',
          exitCode: 2,
        });
      const picked = selectVisualFailures(failures, { names, all: opts.all });
      const accepted = acceptVisualFailures({
        runDir: run.dir,
        failures: picked,
        projectRoot: (slug) => ctx.registry.rootOf(slug),
      });
      if (ctx.opts.json) return json({ runId: run.runId, accepted });
      for (const a of accepted) {
        ok(
          `${a.created ? 'created' : 'updated'} ${relative(ctx.rootDir, a.to)}  ${pc.dim(
            `${a.runnerProject}/${a.name} · ${a.platform} · ${reasonLabel(a)}`,
          )}`,
        );
        out(pc.dim(`  from ${relative(ctx.rootDir, a.from)}`));
        if (a.diff) out(pc.dim(`  diff ${relative(ctx.rootDir, a.diff)}`));
      }
      out(
        pc.dim(
          'Review the PNGs with `git diff --stat` and commit them with the change that moved the pixels.',
        ),
      );
    });
}

function reasonLabel(f: Pick<VisualFailure, 'reason' | 'diffRatio'>): string {
  if (f.reason === 'missing') return pc.cyan('new baseline');
  if (f.reason === 'size') return pc.yellow('size changed');
  return pc.yellow(`changed ${pct(f.diffRatio)}`.trim());
}
