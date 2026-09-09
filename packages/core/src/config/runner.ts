import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { devices, type PlaywrightTestConfig, type ReporterDescription } from '@playwright/test';
import { cucumberReporter, defineBddConfig } from 'playwright-bdd';
import { runnerProjectName, runFiles, type BrowserName, type Layer } from '@sdods/contracts';
import { coreStepsPatterns } from '../steps/glob.js';
import type { ProjectRegistry } from './registry.js';
import type { ResolvedConfig } from './resolve.js';
import { combineTagExpr, normalizeTagExpr } from './tags.js';

export interface RunnerSelection {
  project?: string;
  env?: string;
  layers?: string[];
  browsers?: string[];
  tags?: string;
  runId?: string;
  lint?: boolean;
  allure?: boolean;
  reporters?: string[];
  reporterMode?: 'default' | 'server' | 'quiet';
}

export interface SdodsUseOption {
  project: string;
  layer: Layer;
  browser?: BrowserName;
}

const DEVICE_FOR_BROWSER: Record<BrowserName, string> = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
  'mobile-chrome': 'Pixel 7',
  'mobile-safari': 'iPhone 15',
};

export const DASHBOARD_REPORTER = '@sdods/core/reporters/dashboard';

/** Convenience for `sdods.runner.config.ts`: read the selection from SDODS_* env vars. */
export function selectionFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerSelection {
  const list = (v?: string) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  return {
    project: env.SDODS_PROJECT || undefined,
    env: env.SDODS_ENV || undefined,
    layers: list(env.SDODS_LAYERS),
    browsers: list(env.SDODS_BROWSERS),
    tags: normalizeTagExpr(env.SDODS_TAGS),
    runId: env.SDODS_RUN_ID || undefined,
    lint: env.SDODS_LINT === '1',
    allure: env.SDODS_ALLURE === '1',
    reporters: list(env.SDODS_REPORTERS),
    reporterMode: (env.SDODS_REPORTER_MODE as RunnerSelection['reporterMode']) || 'default',
  };
}

export interface GeneratedProject {
  name: string;
  project: string;
  layer: Layer;
  browser?: BrowserName;
}

/** Names (and identity) of the Playwright projects a selection would produce, without side effects. */
export function listGeneratedProjects(
  registry: ProjectRegistry,
  sel: RunnerSelection,
): GeneratedProject[] {
  const out: GeneratedProject[] = [];
  for (const entry of sel.project ? [registry.entry(sel.project)] : registry.entriesList()) {
    const p = entry.config;
    const layers = (
      sel.layers?.length ? p.layers.filter((l) => sel.layers!.includes(l)) : p.layers
    ) as Layer[];
    const browsers = (
      sel.browsers?.length
        ? p.browsers.filter((b) => sel.browsers!.includes(b as string))
        : p.browsers
    ) as BrowserName[];
    for (const layer of layers) {
      if (layer === 'api') {
        out.push({ name: runnerProjectName({ project: p.slug, layer }), project: p.slug, layer });
        continue;
      }
      if (layer === 'recorded' && !existsSync(join(entry.root, 'recorded'))) continue;
      for (const browser of browsers) {
        out.push({
          name: runnerProjectName({ project: p.slug, layer, browser }),
          project: p.slug,
          layer,
          browser,
        });
      }
    }
  }
  return out;
}

/**
 * Build the Playwright config for a selection of projects × layers × browsers.
 * One `defineBddConfig` per project × layer; browsers reuse the generated testDir.
 */
export function buildRunnerConfig(
  registry: ProjectRegistry,
  sel: RunnerSelection = {},
): PlaywrightTestConfig {
  const entries = sel.project ? [registry.entry(sel.project)] : registry.entriesList();
  const projects: NonNullable<PlaywrightTestConfig['projects']> = [];
  let first: ResolvedConfig | undefined;
  let bddConfigs = 0;
  const cliOverrides = sel.runId ? { runId: sel.runId } : undefined;

  for (const entry of entries) {
    const cfg = registry.resolve(
      entry.slug,
      sel.env,
      cliOverrides ? { ...parseEnvOverrides(), ...cliOverrides } : undefined,
    );
    first ??= cfg;
    const p = cfg.project;
    const layers = (
      sel.layers?.length ? p.layers.filter((l) => sel.layers!.includes(l)) : p.layers
    ) as Layer[];
    const browsers = (
      sel.browsers?.length
        ? p.browsers.filter((b) => sel.browsers!.includes(b as string))
        : p.browsers
    ) as BrowserName[];
    const envUse = {
      locale: cfg.env.use.locale,
      timezoneId: cfg.env.use.timezoneId,
      geolocation: cfg.env.use.geolocation,
      permissions: cfg.env.use.permissions,
      colorScheme: cfg.env.use.colorScheme,
      ignoreHTTPSErrors: cfg.env.use.ignoreHTTPSErrors,
      extraHTTPHeaders: cfg.env.use.extraHTTPHeaders,
      httpCredentials: cfg.env.use.httpCredentials,
    };
    for (const k of Object.keys(envUse) as Array<keyof typeof envUse>)
      if (envUse[k] === undefined) delete envUse[k];

    for (const layer of layers) {
      if (layer === 'recorded') {
        const recordedDir = join(p.root, 'recorded');
        if (!existsSync(recordedDir)) continue;
        for (const browser of browsers) {
          projects.push({
            name: runnerProjectName({ project: p.slug, layer, browser }),
            testDir: recordedDir,
            testMatch: '**/*.spec.ts',
            snapshotPathTemplate: join(
              p.root,
              'features',
              '__screenshots__',
              '{projectName}',
              '{platform}',
              '{arg}{ext}',
            ),
            use: {
              ...devices[DEVICE_FOR_BROWSER[browser]],
              ...(p.channel && (browser === 'chromium' || browser === 'mobile-chrome')
                ? { channel: p.channel }
                : {}),
              baseURL: cfg.env.ui.baseUrl,
              testIdAttribute: p.testIdAttribute,
              ...envUse,
              sdods: { project: p.slug, layer, browser } satisfies SdodsUseOption,
            } as Record<string, unknown>,
          });
        }
        continue;
      }

      const testDir = defineBddConfig({
        features: `${toPosix(p.root)}/features/**/*.feature`,
        steps: [
          ...coreStepsPatterns(cfg.project.steps?.core?.exclude ?? []),
          `${toPosix(p.root)}/steps/**/*.ts`,
          `${toPosix(p.root)}/pages/**/*.ts`,
        ],
        // Each run generates into its own dir (cleaned by `sdods run`), lint/export into `.lint`,
        // so concurrent runs and tooling never race on generated specs.
        outputDir: `${toPosix(join(cfg.runtime.repoRoot, '.sdods/generated', sel.lint ? '.lint' : (sel.runId ?? 'adhoc'), p.slug, layer))}`,
        featuresRoot: `${toPosix(p.root)}/features`,
        // Explicit: scenarios that only use core steps cannot let bddgen guess the project test instance.
        importTestFrom: `${toPosix(p.root)}/steps/fixtures.ts`,
        disableWarnings: { importTestFrom: true },
        tags: combineTagExpr(`@${layer}`, sel.tags),
        examplesTitleFormat: 'Example #<_index_>',
        missingSteps: sel.lint ? 'fail-on-gen' : 'fail-on-run',
        aiFix: { promptAttachment: true },
        quotes: 'single',
      });
      bddConfigs++;

      if (layer === 'api') {
        projects.push({
          name: runnerProjectName({ project: p.slug, layer }),
          testDir,
          use: { sdods: { project: p.slug, layer } satisfies SdodsUseOption } as Record<
            string,
            unknown
          >,
        });
        continue;
      }

      for (const browser of browsers) {
        projects.push({
          name: runnerProjectName({ project: p.slug, layer, browser }),
          testDir,
          // Baselines live with the project (generated specs are per-run and deleted):
          // projects/<slug>/features/__screenshots__/<pw project>/<platform>/<name>.png
          snapshotPathTemplate: join(
            p.root,
            'features',
            '__screenshots__',
            '{projectName}',
            '{platform}',
            '{arg}{ext}',
          ),
          use: {
            ...devices[DEVICE_FOR_BROWSER[browser]],
            ...(p.channel && (browser === 'chromium' || browser === 'mobile-chrome')
              ? { channel: p.channel }
              : {}),
            baseURL: cfg.env.ui.baseUrl,
            testIdAttribute: p.testIdAttribute,
            viewport: browser.startsWith('mobile') ? undefined : p.screenshots.viewport,
            ...envUse,
            sdods: { project: p.slug, layer, browser } satisfies SdodsUseOption,
          } as Record<string, unknown>,
        });
      }
    }
  }

  const runDir = first?.runtime.runDir ?? resolvePath('.sdods/runs/adhoc');
  const timeouts = first?.project.timeouts ?? {
    test: 60_000,
    expect: 10_000,
    action: 15_000,
    navigation: 30_000,
    api: 15_000,
  };
  const workers = first?.runtime.workers;
  const retries = first?.runtime.retries ?? 0;
  const reporterMode = sel.reporterMode ?? 'default';

  const reporter: ReporterDescription[] = [];
  // `--reporter <name[=outputFile]>` ADDS reporters (e.g. `blob` for sharded CI) to the SDODS
  // defaults, so the NDJSON, dashboard and HTML report always exist. Path-less `blob`/`json`/`junit`
  // land inside the run directory.
  const extra: ReporterDescription[] = (sel.reporters ?? []).map((r) => {
    const [name, file] = r.split('=') as [string, string | undefined];
    if (file) return [name, name === 'blob' ? { outputDir: file } : { outputFile: file }];
    if (name === 'blob') return ['blob', { outputDir: join(runDir, 'shard-reports') }];
    if (name === 'json') return ['json', { outputFile: join(runDir, 'runner-results.extra.json') }];
    if (name === 'junit') return ['junit', { outputFile: join(runDir, runFiles.junit) }];
    return [name];
  });
  {
    reporter.push(
      reporterMode === 'server' ? ['line'] : reporterMode === 'quiet' ? ['dot'] : ['list'],
    );
    reporter.push(['html', { outputFolder: join(runDir, runFiles.htmlReport), open: 'never' }]);
    // The cucumber reporter throws when no defineBddConfig() ran (recorded-only selections).
    if (bddConfigs > 0)
      reporter.push(
        cucumberReporter('message', {
          outputFile: join(runDir, runFiles.messages),
        }) as ReporterDescription,
      );
    reporter.push([DASHBOARD_REPORTER, { outputDir: join(runDir, runFiles.dashboard) }]);
    if (projects.some((p) => String(p.name).includes('--recorded--'))) {
      reporter.push(['json', { outputFile: join(runDir, runFiles.results) }]);
    }
    if (first?.project.reports.junit || first?.runtime.ci)
      reporter.push(['junit', { outputFile: join(runDir, runFiles.junit) }]);
    if (first?.project.reports.cucumberHtml)
      reporter.push(
        cucumberReporter('html', {
          outputFile: join(runDir, 'cucumber-report.html'),
        }) as ReporterDescription,
      );
    if (sel.allure || first?.project.reports.allure)
      reporter.push(['allure-playwright', { resultsDir: join(runDir, 'allure-results') }]);
  }
  for (const r of extra) {
    if (reporter.some((d) => d[0] === r[0])) continue; // already emitted by defaults (e.g. junit in CI)
    reporter.push(r);
  }

  return {
    timeout: timeouts.test,
    expect: { timeout: timeouts.expect },
    retries,
    workers,
    fullyParallel: true,
    outputDir: join(runDir, runFiles.output),
    reporter,
    use: {
      screenshot: 'off',
      video: 'retain-on-failure',
      trace: 'on-first-retry',
      actionTimeout: timeouts.action,
      navigationTimeout: timeouts.navigation,
      // Playwright's own `--headed` flag still wins on the CLI; this is what makes the documented
      // SDODS_HEADED env var and the --headed CliOverride reach the browser at all.
      headless: !first?.runtime.headed,
    },
    projects,
    metadata: {
      sdodsRunId: first?.runtime.runId,
      sdodsEnv: first?.env.name,
      sdodsRunDir: runDir,
    },
  };
}

function parseEnvOverrides() {
  const raw = process.env.SDODS_CLI_OVERRIDES;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** @deprecated Use {@link buildRunnerConfig}. Removed in the next minor. */
export const buildPlaywrightConfig = buildRunnerConfig;
/** @deprecated Use {@link RunnerSelection}. Removed in the next minor. */
export type PlaywrightSelection = RunnerSelection;
