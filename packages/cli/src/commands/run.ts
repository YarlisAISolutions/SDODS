import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import {
  newRunId,
  runFiles,
  type BrowserName,
  type Layer,
  type RunManifest,
  type RunSummary,
} from '@sdods/contracts';
import {
  SdodsError,
  CLI_OVERRIDES_ENV,
  VERSION,
  formatFindings,
  lintProject,
  listGeneratedProjects,
  moduleByName,
  moduleDir,
  normalizeTagExpr,
  parseTagExpr,
  serializeCliOverrides,
  type CliOverrides,
  type RunnerSelection,
} from '@sdods/core';
import { analyzeChangeImpact } from '@sdods/mcp';
import { createContext } from '../context.js';
import { browserStatuses } from './browsers.js';
import { installedPlaywrightVersion, stepResultsWarning } from '../runner-compat.js';
import { collect, json, out, parseIntFlag, warn } from '../ui.js';

export interface RunFlags {
  project?: string;
  env?: string;
  tags?: string;
  layer: string[];
  browser: string[];
  module: string[];
  process?: string;
  headed?: boolean;
  workers?: number;
  shard?: string;
  retries?: number;
  grep?: string;
  feature?: string;
  since?: string;
  scenario?: string;
  runId?: string;
  artifactsDir?: string;
  lint: boolean;
  ingest?: boolean;
  allure?: boolean;
  harUpdate?: boolean;
  harReplay?: boolean;
  strict?: boolean;
  updateSnapshots?: boolean;
  ui?: boolean;
  debug?: boolean;
  list?: boolean;
  repeatEach?: number;
  failOnFlaky?: boolean;
  maxFailures?: number;
  timeout?: number;
  reporter: string[];
  projectMatrix?: boolean;
  device?: string;
  reporterMode?: string;
  trigger?: string;
  allowEmpty?: boolean;
}

function addRunOptions(cmd: Command): Command {
  return cmd
    .option('-p, --project <slug>', 'project slug (default: the only project, else required)')
    .option('-e, --env <name>', 'environment name')
    .option(
      '-t, --tags <expr>',
      'Cucumber tag expression, e.g. "@smoke and not @mock" (comma list = OR)',
    )
    .option('-l, --layer <layer>', 'ui | api | hybrid | recorded (repeatable)', collect, [])
    .option(
      '-b, --browser <name>',
      'chromium | edge | firefox | webkit | mobile-chrome | mobile-safari (repeatable)',
      collect,
      [],
    )
    .option('-m, --module <name>', 'restrict to a module (repeatable)', collect, [])
    .option('--process <name>', 'run a named process (recipe) from the project or workspace')
    .option('--project-matrix', 'run every browser declared in the project yaml')
    .option('--device <name>', 'device name for mobile emulation, e.g. "iPhone 15"')
    .option('--headed', 'run headed')
    .option('-w, --workers <n>', 'parallel workers', parseIntFlag('workers'))
    .option('--shard <i/n>', 'shard, e.g. 1/3')
    .option('--retries <n>', 'retries per test', parseIntFlag('retries'))
    .option('--grep <pattern>', 'filter tests by title (regular expression)')
    .option('--feature <path>', 'only this feature file (relative to features/)')
    .option(
      '--since <range>',
      'only features impacted by a git range, e.g. main..HEAD (test-impact analysis)',
    )
    .option('--scenario <name>', 'only scenarios whose title contains this text')
    .option('--run-id <id>', 'run id (default: uuid v7)')
    .option('--artifacts-dir <dir>', 'artifacts root (default: .sdods/runs)')
    .option('--no-lint', 'skip feature lint before running')
    .option('--ingest', 'ingest results into the database after the run')
    .option('--no-ingest', 'do not ingest even when a database is configured')
    .option('--allure', 'also produce allure-results')
    .option('--har-update', 'record/refresh HAR files for @har scenarios')
    .option('--har-replay', 'replay HAR files for @har scenarios')
    .option('--strict', 'with --har-replay: abort on any request not in the HAR (offline)')
    .option('--update-snapshots', 'update visual baselines')
    .option('--ui', 'interactive UI mode')
    .option('--debug', 'step debugger')
    .option('--list', 'list the run targets and tests that would run')
    .option('--repeat-each <n>', 'repeat each test n times', parseIntFlag('repeat-each'))
    .option('--fail-on-flaky', 'exit 1 when any test is flaky')
    .option('--max-failures <n>', 'stop after n failures', parseIntFlag('max-failures'))
    .option('--timeout <ms>', 'per-test timeout override', parseIntFlag('timeout'))
    .option('--reporter <name>', 'reporter override (repeatable, name=outputFile)', collect, [])
    .option('--reporter-mode <mode>', 'default | server | quiet')
    .option('--trigger <kind>', 'cli | ui | ci | agent | mcp | schedule', 'cli')
    .option(
      '--allow-empty',
      'exit 0 when the selection matches no scenario (by default that is exit 2)',
    );
}

export function register(program: Command) {
  const run = addRunOptions(
    program
      .command('run')
      .description('Generate BDD specs and run them for a project (alias: test)'),
  );
  run.action(async (flags: RunFlags, cmd: Command) => {
    process.exitCode = await runCommand(flags, cmd);
  });
  const test = addRunOptions(program.command('test').description('Alias of run'));
  test.action(async (flags: RunFlags, cmd: Command) => {
    process.exitCode = await runCommand(flags, cmd);
  });
}

export async function runCommand(flags: RunFlags, cmd: Command): Promise<number> {
  const ctx = createContext(cmd);
  const entry = ctx.registry.pick(flags.project);
  const projectCfg = entry.config;

  // process → defaults for flags not given explicitly
  const proc = flags.process ? ctx.registry.processOf(entry.slug, flags.process) : undefined;
  const envName = flags.env ?? proc?.env;
  const tags = normalizeTagExpr(flags.tags ?? proc?.tags);
  // Fail on a malformed expression here, as a config error, rather than inside bddgen.
  if (tags) parseTagExpr(tags);
  const layers = (flags.layer.length ? flags.layer : (proc?.layers ?? [])) as Layer[];
  const browsers = (
    flags.projectMatrix
      ? projectCfg.browsers
      : flags.browser.length
        ? flags.browser
        : (proc?.browsers ?? [])
  ) as BrowserName[];
  const modules = flags.module.length ? flags.module : (proc?.modules ?? []);
  const retries = flags.retries ?? proc?.retries;
  const harMode = flags.harUpdate ? 'update' : flags.harReplay ? 'replay' : proc?.harMode;
  // Recording writes each HAR file when its context closes, so parallel workers sharing a
  // `@har:<name>` fixture overwrite one another and the file ends up missing entries.
  // Recording is a one-off authoring step, so serialise it instead of losing requests.
  const workers = harMode === 'update' ? 1 : (flags.workers ?? proc?.workers);
  if (harMode === 'update' && (flags.workers ?? proc?.workers ?? 0) > 1) {
    warn('Recording HAR fixtures runs with a single worker so shared files keep every request.');
  }
  const failOnFlaky = flags.failOnFlaky ?? proc?.failOnFlaky ?? false;

  for (const l of layers) {
    if (!projectCfg.layers.includes(l)) {
      throw new SdodsError(
        'CONFIG_INVALID',
        `Layer "${l}" is not enabled for project ${entry.slug} (layers: ${projectCfg.layers.join(', ')}).`,
        { exitCode: 2 },
      );
    }
  }
  for (const b of browsers) {
    if (!projectCfg.browsers.includes(b)) {
      throw new SdodsError(
        'CONFIG_INVALID',
        `Browser "${b}" is not enabled for project ${entry.slug} (browsers: ${projectCfg.browsers.join(', ')}).`,
        { exitCode: 2 },
      );
    }
  }
  for (const m of modules) moduleByName(projectCfg, m);

  // Stop before generating specs when a CHANNEL browser is missing. Playwright's own error for a
  // missing engine is already actionable ("Run npx playwright install"), but for a channel it
  // reports a name the user never typed and no way forward — and unlike an engine, the fix is a
  // system install rather than a download.
  //
  // Deliberately narrow. Selecting a browser is not the same as using one: `--project-matrix -l api`
  // fills `browsers` from the project yaml for a run that never opens a browser, so checking every
  // selected browser here would fail runs that would have worked.
  const usesBrowser = !layers.length || layers.some((l) => l !== 'api');
  const missing = usesBrowser
    ? (await browserStatuses(browsers)).filter((s) => s.channel && !s.installed)
    : [];
  if (missing.length) {
    const names = missing.map((s) => s.name);
    throw new SdodsError(
      'NOT_SUPPORTED',
      `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} not installed.`,
      {
        hint:
          `Run \`sdods browsers install ${names.map((n) => `-b ${n}`).join(' ')}\`. ` +
          `${names.length > 1 ? 'They are system browsers' : 'It is a system browser'}: Playwright runs the vendor installer rather than downloading a build.`,
        exitCode: 2,
      },
    );
  }

  const stepResults = stepResultsWarning(installedPlaywrightVersion(ctx.rootDir));
  if (stepResults) warn(stepResults);

  const runId = flags.runId ?? newRunId();
  const cli: CliOverrides = {
    env: envName,
    headed: flags.headed,
    workers,
    shard: flags.shard,
    retries,
    runId,
    artifactsDir: flags.artifactsDir,
    harMode: harMode as CliOverrides['harMode'],
    offline: flags.strict && harMode === 'replay' ? true : undefined,
    updateSnapshots: flags.updateSnapshots,
  };
  const cfg = ctx.registry.resolve(entry.slug, envName, cli);
  const runDir = cfg.runtime.runDir;
  const featureRel = flags.feature
    ? projectFeaturePath(cfg.project.root, ctx.rootDir, flags.feature)
    : undefined;
  mkdirSync(runDir, { recursive: true });

  const manifest: RunManifest = {
    runId,
    projectSlug: entry.slug,
    env: cfg.env.name,
    tagsExpr: tags,
    layers: layers.length ? layers : (projectCfg.layers as Layer[]),
    browsers: browsers.length ? browsers : (projectCfg.browsers as BrowserName[]),
    suiteTag: tags && /^@[a-z]+$/.test(tags) ? tags : undefined,
    trigger: (flags.trigger as RunManifest['trigger']) ?? 'cli',
    git: await gitInfo(ctx.rootDir),
    ci: process.env.GITHUB_ACTIONS
      ? {
          provider: 'github',
          runId: process.env.GITHUB_RUN_ID,
          url: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        }
      : undefined,
    startedAt: new Date().toISOString(),
    command: process.argv.slice(2).join(' '),
    shardIndex: cfg.runtime.shard?.current,
    shardTotal: cfg.runtime.shard?.total,
    process: proc?.name,
    modules: modules.length ? modules : undefined,
    sdodsVersion: VERSION,
  };
  const writeManifest = () =>
    writeFileSync(join(runDir, runFiles.manifest), JSON.stringify(manifest, null, 2));
  writeManifest();

  if (flags.lint !== false) {
    const result = await lintProject({ project: cfg.project });
    if (result.errors.length) {
      process.stderr.write(formatFindings(result) + '\n');
      throw new SdodsError(
        'LINT_FAILED',
        `${result.errors.length} lint error(s) in project ${entry.slug}. Fix them or pass --no-lint.`,
        { exitCode: 3 },
      );
    }
    if (result.warnings.length && ctx.opts.verbose)
      process.stderr.write(formatFindings(result) + '\n');
  }

  const selection: RunnerSelection = {
    project: entry.slug,
    env: cfg.env.name,
    layers: layers.length ? layers : undefined,
    browsers: browsers.length ? browsers : undefined,
    tags,
    runId,
    allure: flags.allure,
    reporters: flags.reporter.length ? flags.reporter : undefined,
    reporterMode:
      (flags.reporterMode as RunnerSelection['reporterMode']) ??
      (ctx.opts.quiet ? 'quiet' : 'default'),
  };
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SDODS_ROOT: ctx.rootDir,
    SDODS_PROJECT: entry.slug,
    SDODS_ENV: cfg.env.name,
    SDODS_TAGS: tags ?? '',
    SDODS_LAYERS: selection.layers?.join(',') ?? '',
    SDODS_BROWSERS: selection.browsers?.join(',') ?? '',
    SDODS_RUN_ID: runId,
    SDODS_ALLURE: flags.allure ? '1' : '',
    SDODS_REPORTERS: selection.reporters?.join(',') ?? '',
    SDODS_REPORTER_MODE: selection.reporterMode ?? 'default',
    SDODS_PROCESS: proc?.name ?? '',
    SDODS_MODULES: modules.join(','),
    [CLI_OVERRIDES_ENV]: serializeCliOverrides(cli),
    FORCE_COLOR: ctx.opts.color === false ? '0' : (process.env.FORCE_COLOR ?? '1'),
  };
  if (flags.updateSnapshots) childEnv.SDODS_UPDATE_SNAPSHOTS = '1';
  if (harMode) childEnv.SDODS_HAR_MODE = harMode;
  if (flags.strict && harMode === 'replay') childEnv.SDODS_OFFLINE = '1';

  const configPath = join(ctx.rootDir, 'sdods.runner.config.ts');
  if (!existsSync(configPath)) {
    throw new SdodsError('CONFIG_NOT_FOUND', `No runner config at ${configPath}.`, {
      hint: 'Run `sdods init` or copy the template from the SDODS repo.',
    });
  }

  const runnerProjects = listGeneratedProjects(ctx.registry, selection);
  if (!runnerProjects.length) {
    throw new SdodsError('CONFIG_INVALID', 'The selection produced no run targets.', {
      hint: 'Check --layer / --browser against the project yaml.',
      exitCode: 2,
    });
  }

  // Recorded specs are plain runner tests: no Gherkin to generate.
  const recordedOnly = runnerProjects.every((p) => p.layer === 'recorded');
  if (!recordedOnly) {
    const gen = await execa('npx', ['bddgen', '-c', configPath], {
      cwd: ctx.rootDir,
      env: childEnv,
      stdio: ctx.opts.quiet ? 'pipe' : 'inherit',
      reject: false,
    });
    if (gen.exitCode !== 0) {
      if (ctx.opts.quiet && gen.stderr) process.stderr.write(gen.stderr + '\n');
      throw new SdodsError('RUN_FAILED', 'bddgen failed to generate specs.', {
        hint: 'Run `sdods lint -p <slug> --undefined-steps` to find undefined steps.',
        exitCode: 2,
      });
    }
  }

  const args = ['playwright', 'test', '-c', configPath, '--pass-with-no-tests'];
  for (const p of runnerProjects) args.push('--project', p.name);
  if (flags.headed) args.push('--headed');
  if (workers) args.push('--workers', String(workers));
  if (flags.shard) args.push('--shard', flags.shard);
  if (retries !== undefined) args.push('--retries', String(retries));
  if (flags.grep) args.push('--grep', flags.grep);
  if (flags.scenario) args.push('--grep', escapeRe(flags.scenario));
  if (flags.repeatEach) args.push('--repeat-each', String(flags.repeatEach));
  if (flags.maxFailures) args.push('--max-failures', String(flags.maxFailures));
  if (flags.timeout) args.push('--timeout', String(flags.timeout));
  if (flags.updateSnapshots) args.push('--update-snapshots');
  if (failOnFlaky) args.push('--fail-on-flaky-tests');
  if (flags.ui) args.push('--ui');
  if (flags.debug) args.push('--debug');
  if (flags.list) args.push('--list');

  // module / feature restriction → generated spec path filters (features/<dir>/x.feature → .sdods/generated/<slug>/<layer>/<dir>/x.feature.spec.js)
  const filters: string[] = [];
  for (const m of modules) {
    const rel = relative(
      join(cfg.project.root, 'features'),
      moduleDir(cfg.project.root, moduleByName(projectCfg, m)),
    ).replace(/\\/g, '/');
    filters.push(
      `\\.sdods/generated/${escapeRe(runId)}/${escapeRe(entry.slug)}/[^/]+/${escapeRe(rel)}/`,
    );
  }
  const featureFilter = (rel: string) =>
    escapeRe(rel.replace(/^features\//, '').replace(/\.feature$/, '')) + '\\.feature\\.spec';

  if (featureRel) filters.push(featureFilter(featureRel));

  // --since <range>: run only what the change could have broken.
  //
  // `analyzeChangeImpact` has existed for a while and was reachable only
  // through MCP, so it could advise a human and could not select a run. This is
  // the seam that was missing; the mapping itself is unchanged.
  if (flags.since) {
    const impact = analyzeChangeImpact(cfg.project.root, ctx.rootDir, flags.since);
    if (impact.impacted.length === 0) {
      // Deliberately NOT "run everything" and deliberately not a silent empty
      // run. A run that registered zero scenarios exits 0 and looks identical
      // to a green run, which is the single most dangerous outcome a test
      // runner has. Say so, in words, and stop.
      out(pc.bold(`No features impacted by ${flags.since}.`));
      out(`  ${impact.changedFiles.length} changed file(s), none reaching a feature.`);
      out(pc.dim('  Nothing was run. This is not a pass — re-run without --since to verify.'));
      // Exit 0: selecting nothing is a correct outcome for this flag, not a
      // failure. The wording above is what stops it being read as a pass.
      return 0;
    }
    out(pc.bold(`--since ${flags.since}: ${impact.impacted.length} impacted feature(s)`));
    for (const row of impact.impacted) out(`  ${row.feature}  ${pc.dim(row.reasons.join('; '))}`);
    for (const row of impact.impacted) filters.push(featureFilter(row.feature));
  }
  // positional filters must precede `--project` (variadic in the runner CLI)
  args.splice(4, 0, ...filters);

  if (flags.list) {
    out(pc.bold('Run targets:'));
    for (const p of runnerProjects) out(`  ${p.name}`);
    const listed = await execa('npx', args, {
      cwd: ctx.rootDir,
      env: childEnv,
      stdio: 'inherit',
      reject: false,
    });
    rmSync(join(ctx.rootDir, '.sdods', 'generated', runId), { recursive: true, force: true });
    rmSync(runDir, { recursive: true, force: true });
    return listed.exitCode ?? 0;
  }

  out(
    pc.dim(
      `run ${runId} · project ${entry.slug} · env ${cfg.env.name}${tags ? ` · tags ${tags}` : ''}${proc ? ` · process ${proc.name}` : ''}${modules.length ? ` · modules ${modules.join(',')}` : ''}`,
    ),
  );
  out(pc.dim(`projects: ${runnerProjects.map((p) => p.name).join(', ')}`));
  const started = Date.now();
  const child = execa('npx', args, {
    cwd: ctx.rootDir,
    env: childEnv,
    stdio: 'inherit',
    reject: false,
  });
  const onSignal = () => child.kill('SIGTERM');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const result = await child;
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  const exitCode =
    result.signal === 'SIGINT' || result.signal === 'SIGTERM' ? 130 : (result.exitCode ?? 1);
  rmSync(join(ctx.rootDir, '.sdods', 'generated', runId), { recursive: true, force: true });
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = exitCode;
  writeManifest();

  const summary = readSummary(runDir, runId, exitCode, Date.now() - started);
  if (summary) writeFileSync(join(runDir, runFiles.summary), JSON.stringify(summary, null, 2));

  const dbConfigured =
    process.env.DB_DRIVER === 'postgres'
      ? Boolean(process.env.DATABASE_URL)
      : existsSync(resolvePath(ctx.rootDir, process.env.SQLITE_PATH ?? '.sdods/sdods.db'));
  if (flags.ingest === true || (flags.ingest !== false && dbConfigured)) {
    try {
      const dbModule = '@sdods/db';
      const mod = (await import(dbModule)) as {
        openDb: () => Promise<{ close(): Promise<void> } & Record<string, unknown>>;
        ingestRun: (
          adb: unknown,
          opts: { artifactsRoot: string; runId: string },
        ) => Promise<unknown>;
      };
      const adb = await mod.openDb();
      try {
        await mod.ingestRun(adb, { artifactsRoot: cfg.runtime.artifactsDir, runId });
        manifest.ingestedAt = new Date().toISOString();
        writeManifest();
        out(pc.dim(`ingested run ${runId} into the ${process.env.DB_DRIVER ?? 'sqlite'} database`));
      } finally {
        await adb.close();
      }
    } catch (e) {
      warn(`ingest skipped: ${(e as Error).message}`);
    }
  }

  // Zero scenarios with exit 0 is indistinguishable from a green run, so a typo in --tags or
  // --feature used to keep CI passing while testing nothing. One shard of several can
  // legitimately receive nothing, and --allow-empty opts out explicitly.
  let finalExit = exitCode;
  if (summary && summary.totals.total === 0) {
    const emptyShard = (cfg.runtime.shard?.total ?? 1) > 1;
    const message = `No scenarios matched the selection${tags ? ` (tags: ${tags})` : ''}${featureRel ? ` (feature: ${featureRel})` : ''}.`;
    warn(message);
    if (exitCode === 0 && !flags.allowEmpty && !emptyShard) {
      finalExit = 2;
      warn(
        'Nothing was run, so this is not a pass. Pass --allow-empty if an empty run is expected.',
      );
      manifest.exitCode = finalExit;
      writeManifest();
    }
  }

  if (ctx.opts.json) {
    json({ runId, runDir, exitCode: finalExit, summary, manifest });
  } else {
    const t = summary?.totals;
    out('');
    out(
      `${finalExit === 0 ? pc.green('✔ passed') : finalExit === 130 ? pc.yellow('■ cancelled') : finalExit === 2 ? pc.yellow('■ nothing ran') : pc.red('✖ failed')}  ${t ? `${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped, ${t.flaky} flaky` : ''}  ${pc.dim(`(${Math.round((Date.now() - started) / 1000)}s)`)}`,
    );
    out(pc.dim(`artifacts:   ${runDir}`));
    out(pc.dim(`html report: ${join(runDir, runFiles.htmlReport, 'index.html')}`));
    out(pc.dim(`dashboard:   ${join(runDir, runFiles.dashboard, 'index.html')}`));
  }
  return finalExit;
}

/**
 * `--feature` accepts a path relative to features/, to the project, to the repo, or absolute. It is
 * turned into one relative to the project, and must exist: a mistyped path used to select nothing
 * and pass.
 */
function projectFeaturePath(projectRoot: string, repoRoot: string, input: string): string {
  const candidates = isAbsolute(input)
    ? [input]
    : [
        join(projectRoot, 'features', input),
        join(projectRoot, input),
        resolvePath(repoRoot, input),
        resolvePath(process.cwd(), input),
      ];
  const found = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  const rel = found ? relative(projectRoot, found).replace(/\\/g, '/') : undefined;
  if (!found || !rel || rel.startsWith('..') || !rel.startsWith('features/'))
    throw new SdodsError('CONFIG_NOT_FOUND', `Feature file not found in this project: ${input}`, {
      hint: `Give a path under ${relative(repoRoot, join(projectRoot, 'features')) || 'features'}/, e.g. --feature auth/login.feature.`,
      exitCode: 2,
    });
  return rel;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function gitInfo(cwd: string): Promise<RunManifest['git']> {
  try {
    const sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    const branch = (
      await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
    ).stdout.trim();
    const dirty = (await execa('git', ['status', '--porcelain'], { cwd })).stdout.trim().length > 0;
    return { sha, branch, dirty };
  } catch {
    return undefined;
  }
}

function readSummary(
  runDir: string,
  runId: string,
  exitCode: number,
  durationMs: number,
): RunSummary | undefined {
  const metrics = join(runDir, runFiles.dashboard, 'metrics.json');
  if (!existsSync(metrics)) return undefined;
  try {
    const m = JSON.parse(readFileSync(metrics, 'utf8')) as {
      summary: any;
      byProject: Record<string, any>;
      failed: any[];
      flaky: any[];
    };
    return {
      runId,
      status: exitCode === 0 ? 'passed' : exitCode === 130 ? 'cancelled' : 'failed',
      totals: { ...m.summary, durationMs },
      byProject: m.byProject,
      failed: m.failed ?? [],
      flaky: m.flaky ?? [],
      reportPaths: {
        html: join(runDir, runFiles.htmlReport, 'index.html'),
        dashboard: join(runDir, runFiles.dashboard, 'index.html'),
        messages: join(runDir, runFiles.messages),
      },
    };
  } catch {
    return undefined;
  }
}
