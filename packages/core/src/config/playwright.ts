import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { devices, type PlaywrightTestConfig, type ReporterDescription } from '@playwright/test';
import { cucumberReporter, defineBddConfig } from 'playwright-bdd';
import { pwProjectName, runFiles, type BrowserName, type Layer } from '@automax/contracts';
import { coreStepsGlob } from '../steps/glob.js';
import type { ProjectRegistry } from './registry.js';
import type { ResolvedConfig } from './resolve.js';
import { combineTagExpr, normalizeTagExpr } from './tags.js';

export interface PlaywrightSelection {
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

export interface AutomaxUseOption {
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

export const DASHBOARD_REPORTER = '@automax/core/reporters/dashboard';

/** Convenience for `playwright.config.ts`: read the selection from AUTOMAX_* env vars. */
export function selectionFromEnv(env: NodeJS.ProcessEnv = process.env): PlaywrightSelection {
  const list = (v?: string) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  return {
    project: env.AUTOMAX_PROJECT || undefined,
    env: env.AUTOMAX_ENV || undefined,
    layers: list(env.AUTOMAX_LAYERS),
    browsers: list(env.AUTOMAX_BROWSERS),
    tags: normalizeTagExpr(env.AUTOMAX_TAGS),
    runId: env.AUTOMAX_RUN_ID || undefined,
    lint: env.AUTOMAX_LINT === '1',
    allure: env.AUTOMAX_ALLURE === '1',
    reporters: list(env.AUTOMAX_REPORTERS),
    reporterMode: (env.AUTOMAX_REPORTER_MODE as PlaywrightSelection['reporterMode']) || 'default',
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
  sel: PlaywrightSelection,
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
        out.push({ name: pwProjectName({ project: p.slug, layer }), project: p.slug, layer });
        continue;
      }
      if (layer === 'recorded' && !existsSync(join(entry.root, 'recorded'))) continue;
      for (const browser of browsers) {
        out.push({
          name: pwProjectName({ project: p.slug, layer, browser }),
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
export function buildPlaywrightConfig(
  registry: ProjectRegistry,
  sel: PlaywrightSelection = {},
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
            name: pwProjectName({ project: p.slug, layer, browser }),
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
              automax: { project: p.slug, layer, browser } satisfies AutomaxUseOption,
            } as Record<string, unknown>,
          });
        }
        continue;
      }

      const testDir = defineBddConfig({
        features: `${toPosix(p.root)}/features/**/*.feature`,
        steps: [
          coreStepsGlob(),
          `${toPosix(p.root)}/steps/**/*.ts`,
          `${toPosix(p.root)}/pages/**/*.ts`,
        ],
        // Each run generates into its own dir (cleaned by `automax run`), lint/export into `.lint`,
        // so concurrent runs and tooling never race on generated specs.
        outputDir: `${toPosix(join(cfg.runtime.repoRoot, '.features-gen', sel.lint ? '.lint' : (sel.runId ?? 'adhoc'), p.slug, layer))}`,
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
          name: pwProjectName({ project: p.slug, layer }),
          testDir,
          use: { automax: { project: p.slug, layer } satisfies AutomaxUseOption } as Record<
            string,
            unknown
          >,
        });
        continue;
      }

      for (const browser of browsers) {
        projects.push({
          name: pwProjectName({ project: p.slug, layer, browser }),
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
            automax: { project: p.slug, layer, browser } satisfies AutomaxUseOption,
          } as Record<string, unknown>,
        });
      }
    }
  }

  const runDir = first?.runtime.runDir ?? resolvePath('.automax/runs/adhoc');
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
  if (sel.reporters?.length) {
    for (const r of sel.reporters)
      reporter.push(r.includes('=') ? [r.split('=')[0]!, { outputFile: r.split('=')[1] }] : [r]);
  } else {
    reporter.push(
      reporterMode === 'server' ? ['line'] : reporterMode === 'quiet' ? ['dot'] : ['list'],
    );
    reporter.push(['html', { outputFolder: join(runDir, runFiles.pwReport), open: 'never' }]);
    // The cucumber reporter throws when no defineBddConfig() ran (recorded-only selections).
    if (bddConfigs > 0)
      reporter.push(
        cucumberReporter('message', {
          outputFile: join(runDir, runFiles.messages),
        }) as ReporterDescription,
      );
    reporter.push([DASHBOARD_REPORTER, { outputDir: join(runDir, runFiles.dashboard) }]);
    if (projects.some((p) => String(p.name).includes('--recorded--'))) {
      reporter.push(['json', { outputFile: join(runDir, runFiles.pwResults) }]);
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

  return {
    timeout: timeouts.test,
    expect: { timeout: timeouts.expect },
    retries,
    workers,
    fullyParallel: true,
    outputDir: join(runDir, runFiles.pwOutput),
    reporter,
    use: {
      screenshot: 'off',
      video: 'retain-on-failure',
      trace: 'on-first-retry',
      actionTimeout: timeouts.action,
      navigationTimeout: timeouts.navigation,
    },
    projects,
    metadata: {
      automaxRunId: first?.runtime.runId,
      automaxEnv: first?.env.name,
      automaxRunDir: runDir,
    },
  };
}

function parseEnvOverrides() {
  const raw = process.env.AUTOMAX_CLI_OVERRIDES;
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
