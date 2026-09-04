import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { SdodsError } from '@sdods/core';
import { createContext } from '../context.js';
import { json, ok, out, table } from '../ui.js';

/**
 * `sdods insights compute|show` — flakiness, locator fragility, environment stability and
 * suite health over the last N ingested runs (needs a database with ingested results).
 */
export function register(program: Command) {
  const insights = program
    .command('insights')
    .description('Flakiness, locator fragility, environment stability and suite health');

  insights
    .command('compute')
    .description('Compute insights from ingested runs and store the result under .sdods/insights/')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('--window <n>', 'number of most recent runs to consider', '30')
    .option('--flaky-threshold <r>', 'quarantine candidate when flakiness ≥ r', '0.2')
    .option('--fragility-threshold <r>', 'hot locator when fragility ≥ r', '0.1')
    .option('--min-runs <n>', 'minimum runs before a scenario can be flagged', '10')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      ctx.registry.entry(opts.project);
      const m = await loadDb();
      const adb = m.createDb();
      try {
        await m.migrateToLatest(adb);
        const result = await m.computeInsights(adb.db, {
          projectSlug: opts.project,
          window: Number(opts.window),
          flakyThreshold: Number(opts.flakyThreshold),
          fragilityThreshold: Number(opts.fragilityThreshold),
          minRuns: Number(opts.minRuns),
        });
        const file = resultFile(ctx.rootDir, opts.project);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify(result, null, 2));
        if (ctx.opts.json) return json(result);
        render(result);
        ok(`Saved ${file}`);
      } finally {
        await adb.close();
      }
    });

  insights
    .command('show')
    .description('Show the last computed insights for a project')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('--top <n>', 'rows per table', '10')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const file = resultFile(ctx.rootDir, opts.project);
      if (!existsSync(file)) {
        throw new SdodsError('CONFIG_NOT_FOUND', `No insights computed yet for ${opts.project}.`, {
          hint: `Run \`sdods insights compute -p ${opts.project}\` after ingesting some runs.`,
          exitCode: 2,
        });
      }
      const result = JSON.parse(readFileSync(file, 'utf8'));
      if (ctx.opts.json) return json(result);
      render(result, Number(opts.top));
    });
}

function resultFile(rootDir: string, slug: string): string {
  return join(rootDir, '.sdods', 'insights', `${slug}.json`);
}

async function loadDb() {
  try {
    return await import('@sdods/db');
  } catch (e) {
    throw new SdodsError(
      'DB_REQUIRED',
      'Insights need the @sdods/db package and a configured database.',
      {
        hint: 'Set DB_DRIVER=sqlite (default), run `sdods db migrate`, and ingest runs with `sdods run --ingest`.',
        cause: e,
      },
    );
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function render(r: any, top = 10) {
  out(
    `${pc.bold(`Insights for ${r.projectSlug}`)} · window ${r.window} · runs considered ${r.runsConsidered} · pass rate ${pct(r.passRate)} · suite health ${pc.bold(pct(r.suiteHealth))}`,
  );
  if (Array.isArray(r.suiteHealthTrend) && r.suiteHealthTrend.length) {
    out(pc.dim(`trend: ${r.suiteHealthTrend.map((v: number) => pct(v)).join(' → ')}`));
  }
  out(pc.bold('\nScenarios by flakiness'));
  table(
    [...r.scenarios]
      .sort((a: any, b: any) => b.flakinessScore - a.flakinessScore)
      .slice(0, top)
      .map((s: any) => ({
        scenario: s.scenarioName,
        module: s.module ?? '',
        browser: String(s.runnerProject).split('--').pop(),
        runs: s.runs,
        failed: s.failed,
        flaky: s.flaky,
        flakiness: pct(s.flakinessScore),
        p95ms: s.p95DurationMs ?? '',
        quarantine: s.quarantineCandidate ? pc.yellow('candidate') : '',
      })),
  );
  out(pc.bold('\nLocators by fragility'));
  table(
    [...r.locators]
      .sort((a: any, b: any) => b.fragility - a.fragility)
      .slice(0, top)
      .map((l: any) => ({
        selector: l.selector,
        page: l.pageHint ?? '',
        fails: l.fails,
        heals: l.heals,
        fragility: pct(l.fragility),
        hot: l.hot ? pc.red('hot') : '',
        suggestion: l.suggestedSelector ?? '',
      })),
  );
  out(pc.bold('\nEnvironments'));
  table(
    r.envs.map((e: any) => ({
      env: e.env,
      runs: e.runs,
      envFailures: e.envAttributedFailures,
      stability: pct(e.stability),
    })),
  );
}
