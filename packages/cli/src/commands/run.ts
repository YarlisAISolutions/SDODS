import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';
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
  serializeCliOverrides,
  type CliOverrides,
  type PlaywrightSelection,
} from '@sdods/core';
import { createContext } from '../context.js';
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
      'chromium | firefox | webkit | mobile-chrome | mobile-safari (repeatable)',
      collect,
      [],
    )
    .option('-m, --module <name>', 'restrict to a module (repeatable)', collect, [])
    .option('--process <name>', 'run a named process (recipe) from the project or workspace')
    .option('--project-matrix', 'run every browser declared in the project yaml')
    .option('--device <name>', 'Playwright device name (mobile emulation)')
    .option('--headed', 'run headed')
    .option('-w, --workers <n>', 'parallel workers', parseIntFlag('workers'))
    .option('--shard <i/n>', 'shard, e.g. 1/3')
    .option('--retries <n>', 'retries per test', parseIntFlag('retries'))
    .option('--grep <pattern>', 'Playwright --grep')
    .option('--feature <path>', 'only this feature file (relative to features/)')
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
    .option('--ui', 'Playwright UI mode')
    .option('--debug', 'Playwright inspector')
    .option('--list', 'list the Playwright projects and tests that would run')
    .option('--repeat-each <n>', 'repeat each test n times', parseIntFlag('repeat-each'))
    .option('--fail-on-flaky', 'exit 1 when any test is flaky')
    .option('--max-failures <n>', 'stop after n failures', parseIntFlag('max-failures'))
    .option('--timeout <ms>', 'per-test timeout override', parseIntFlag('timeout'))
    .option(
      '--reporter <name>',
      'Playwright reporter override (repeatable, name=outputFile)',
      collect,
      [],
    )
    .option('--reporter-mode <mode>', 'default | server | quiet')
    .option('--trigger <kind>', 'cli | ui | ci | agent | mcp | schedule', 'cli');
}

export function register(program: Command) {
  const run = addRunOptions(
    program
      .command('run')
      .description('Generate BDD specs and run Playwright for a project (alias: test)'),
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

  const selection: PlaywrightSelection = {
    project: entry.slug,
    env: cfg.env.name,
    layers: layers.length ? layers : undefined,
    browsers: browsers.length ? browsers : undefined,
    tags,
    runId,
    allure: flags.allure,
    reporters: flags.reporter.length ? flags.reporter : undefined,
    reporterMode:
      (flags.reporterMode as PlaywrightSelection['reporterMode']) ??
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

  const configPath = join(ctx.rootDir, 'playwright.config.ts');
  if (!existsSync(configPath)) {
    throw new SdodsError('CONFIG_NOT_FOUND', `No playwright.config.ts at ${ctx.rootDir}.`, {
      hint: 'Run `sdods init` or copy the template from the SDODS repo.',
    });
  }

  const pwProjects = listGeneratedProjects(ctx.registry, selection);
  if (!pwProjects.length) {
    throw new SdodsError('CONFIG_INVALID', 'The selection produced no Playwright projects.', {
      hint: 'Check --layer / --browser against the project yaml.',
      exitCode: 2,
    });
  }

  // Recorded specs are plain Playwright tests: no Gherkin to generate.
  const recordedOnly = pwProjects.every((p) => p.layer === 'recorded');
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
  for (const p of pwProjects) args.push('--project', p.name);
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

  // module / feature restriction → generated spec path filters (features/<dir>/x.feature → .features-gen/<slug>/<layer>/<dir>/x.feature.spec.js)
  const filters: string[] = [];
  for (const m of modules) {
    const rel = relative(
      join(cfg.project.root, 'features'),
      moduleDir(cfg.project.root, moduleByName(projectCfg, m)),
    ).replace(/\\/g, '/');
    filters.push(
      `\\.features-gen/${escapeRe(runId)}/${escapeRe(entry.slug)}/[^/]+/${escapeRe(rel)}/`,
    );
  }
  if (flags.feature)
    filters.push(
      escapeRe(flags.feature.replace(/^features\//, '').replace(/\.feature$/, '')) +
        '\\.feature\\.spec',
    );
  // positional filters must precede `--project` (variadic in Playwright's CLI)
  args.splice(4, 0, ...filters);

  if (flags.list) {
    out(pc.bold('Playwright projects:'));
    for (const p of pwProjects) out(`  ${p.name}`);
    const listed = await execa('npx', args, {
      cwd: ctx.rootDir,
      env: childEnv,
      stdio: 'inherit',
      reject: false,
    });
    rmSync(join(ctx.rootDir, '.features-gen', runId), { recursive: true, force: true });
    rmSync(runDir, { recursive: true, force: true });
    return listed.exitCode ?? 0;
  }

  out(
    pc.dim(
      `run ${runId} · project ${entry.slug} · env ${cfg.env.name}${tags ? ` · tags ${tags}` : ''}${proc ? ` · process ${proc.name}` : ''}${modules.length ? ` · modules ${modules.join(',')}` : ''}`,
    ),
  );
  out(pc.dim(`projects: ${pwProjects.map((p) => p.name).join(', ')}`));
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
  rmSync(join(ctx.rootDir, '.features-gen', runId), { recursive: true, force: true });
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

  if (summary && summary.totals.total === 0)
    warn(`No scenarios matched the selection${tags ? ` (tags: ${tags})` : ''}.`);

  if (ctx.opts.json) {
    json({ runId, runDir, exitCode, summary, manifest });
  } else {
    const t = summary?.totals;
    out('');
    out(
      `${exitCode === 0 ? pc.green('✔ passed') : exitCode === 130 ? pc.yellow('■ cancelled') : pc.red('✖ failed')}  ${t ? `${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped, ${t.flaky} flaky` : ''}  ${pc.dim(`(${Math.round((Date.now() - started) / 1000)}s)`)}`,
    );
    out(pc.dim(`artifacts:   ${runDir}`));
    out(pc.dim(`html report: ${join(runDir, runFiles.pwReport, 'index.html')}`));
    out(pc.dim(`dashboard:   ${join(runDir, runFiles.dashboard, 'index.html')}`));
  }
  return exitCode;
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
        html: join(runDir, runFiles.pwReport, 'index.html'),
        dashboard: join(runDir, runFiles.dashboard, 'index.html'),
        messages: join(runDir, runFiles.messages),
      },
    };
  } catch {
    return undefined;
  }
}
