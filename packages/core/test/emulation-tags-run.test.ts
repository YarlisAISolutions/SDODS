import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * #116 — the per-scenario emulation tags, through a REAL run: bddgen generates the specs from a
 * feature file with the repo's own `sdods.runner.config.ts`, and Playwright runs them in Chromium
 * with the SDODS fixtures. Nothing is stubbed between the tag on the scenario and the browser
 * context, which is the whole claim: `@theme:dark` must reach `prefers-color-scheme`, and
 * `@locale:fr-FR` must reach `navigator.language`, over whatever the env's `use:` said.
 *
 * The untagged scenario is the #51 control: it reads back the env's own `use.colorScheme` and
 * `use.locale`, proving that block is threaded into the context rather than inert.
 *
 * The workspace lives under the repo's gitignored `.sdods/` so its steps resolve `@sdods/core`
 * the way a real project in this monorepo does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const require_ = createRequire(import.meta.url);
const pwCli = join(dirname(require_.resolve('@playwright/test/package.json')), 'cli.js');
const bddgen = join(dirname(require_.resolve('playwright-bdd/package.json')), 'dist/cli/index.js');
const runnerConfig = join(repoRoot, 'sdods.runner.config.ts');

mkdirSync(join(repoRoot, '.sdods'), { recursive: true });
const ws = mkdtempSync(join(repoRoot, '.sdods', 'test-emulation-'));
afterAll(() => rmSync(ws, { recursive: true, force: true }));

const FEATURE = `@ui @smoke
Feature: Per-scenario emulation

  Scenario: untagged
    Then the probe records what the browser reports

  @theme:dark @locale:fr-FR @timezone:Asia/Tokyo @viewport:320x640
  Scenario: tagged
    Then the probe records what the browser reports
    And I use the locale "fr-FR"
    And I use the timezone "Asia/Tokyo"

  @device:iPhone-15
  Scenario: device
    Then the probe records what the browser reports
    And I use the device "iPhone 15"

  Scenario: untagged locale step
    Then I use the locale "de-DE"

  # One outline, one Examples block per locale: the pattern that replaces an env yaml per locale.
  Scenario Outline: outline
    Then the probe records what the browser reports

    @locale:de-DE @theme:dark
    Examples:
      | n  |
      | de |

    @locale:ja-JP
    Examples:
      | n  |
      | ja |
`;

const PROBE_STEPS = `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBdd } from '@sdods/core/fixtures';
import { test } from './fixtures';

const { Then } = createBdd(test);

Then('the probe records what the browser reports', async ({ page }) => {
  // Without a viewport meta a mobile browser lays out at 980px, whatever the device width.
  await page.setContent('<meta name="viewport" content="width=device-width"><p>probe</p>');
  const seen = await page.evaluate(() => ({
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    light: matchMedia('(prefers-color-scheme: light)').matches,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    width: innerWidth,
    height: innerHeight,
    touch: navigator.maxTouchPoints > 0,
    userAgent: navigator.userAgent,
  }));
  const info = test.info();
  writeFileSync(
    join(process.env.PROBE_OUT!, info.project.name + '__' + info.title + '.json'),
    JSON.stringify(seen),
  );
});
`;

function setup() {
  const proj = join(ws, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  mkdirSync(join(proj, 'features'), { recursive: true });
  mkdirSync(join(proj, 'steps'), { recursive: true });
  writeFileSync(join(ws, 'package.json'), '{ "private": true, "type": "module" }');
  writeFileSync(
    join(proj, 'sdods.project.yaml'),
    'slug: shop\nname: Shop\nlayers: [ui]\nbrowsers: [chromium, mobile-chrome]\nenvs: { default: local, available: [local] }\n',
  );
  writeFileSync(
    join(proj, 'envs', 'local.yaml'),
    'ui: { baseUrl: "http://127.0.0.1:9" }\napi: { baseUrl: "http://127.0.0.1:9" }\n' +
      'use: { colorScheme: light, locale: en-GB, timezoneId: Europe/London }\n',
  );
  writeFileSync(join(proj, 'features', 'emulation.feature'), FEATURE);
  writeFileSync(
    join(proj, 'steps', 'fixtures.ts'),
    "export { test, createBdd } from '@sdods/core/fixtures';\n",
  );
  writeFileSync(join(proj, 'steps', 'probe.steps.ts'), PROBE_STEPS);
}

interface Probe {
  dark: boolean;
  light: boolean;
  language: string;
  timeZone: string;
  width: number;
  height: number;
  touch: boolean;
  userAgent: string;
}

describe('#116 — emulation tags reach the browser context (real Chromium run)', () => {
  let out = '';
  let results: Record<string, { status: string; error: string }> = {};
  const DESKTOP = 'shop--ui--chromium';
  const MOBILE = 'shop--ui--mobile-chrome';
  const probe = (title: string, project = DESKTOP): Probe =>
    JSON.parse(readFileSync(join(out, `${project}__${title}.json`), 'utf8')) as Probe;
  const status = (title: string, project = DESKTOP) => results[`${project}/${title}`]?.status;

  it('runs the feature', () => {
    setup();
    out = join(ws, 'probe');
    mkdirSync(out, { recursive: true });
    const env = {
      ...process.env,
      CI: '',
      FORCE_COLOR: '0',
      SDODS_ROOT: ws,
      SDODS_PROJECT: 'shop',
      SDODS_ENV: 'local',
      SDODS_LAYERS: 'ui',
      SDODS_BROWSERS: 'chromium,mobile-chrome',
      SDODS_RUN_ID: 'emulation-test',
      SDODS_TAGS: '',
      PROBE_OUT: out,
    };
    const gen = spawnSync(process.execPath, [bddgen, '-c', runnerConfig], {
      cwd: ws,
      env,
      encoding: 'utf8',
    });
    expect(gen.status, gen.stdout + gen.stderr).toBe(0);
    const json = join(ws, 'results.json');
    const run = spawnSync(
      process.execPath,
      [pwCli, 'test', '-c', runnerConfig, '--reporter', 'json', '--workers', '2'],
      { cwd: ws, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: json }, encoding: 'utf8' },
    );
    expect(existsSync(json), run.stdout + run.stderr).toBe(true);
    const report = JSON.parse(readFileSync(json, 'utf8'));
    const walk = (s: any) => {
      for (const spec of s.specs ?? [])
        for (const t of spec.tests) {
          const last = t.results.at(-1);
          results[`${t.projectName}/${spec.title}`] = {
            status: last?.status ?? 'none',
            error: last?.error?.message ?? '',
          };
        }
      for (const c of s.suites ?? []) walk(c);
    };
    results = {};
    for (const s of report.suites) walk(s);
    const titles = [
      'Example #1',
      'Example #2',
      'device',
      'tagged',
      'untagged',
      'untagged locale step',
    ];
    expect(Object.keys(results).sort(), run.stdout + run.stderr).toEqual(
      [...titles.map((t) => `${DESKTOP}/${t}`), ...titles.map((t) => `${MOBILE}/${t}`)].sort(),
    );
  });

  it('an untagged scenario gets the env use: block (colorScheme, locale, timezone are not inert)', () => {
    expect(status('untagged')).toBe('passed');
    const seen = probe('untagged');
    expect(seen.light).toBe(true);
    expect(seen.dark).toBe(false);
    expect(seen.language).toBe('en-GB');
    expect(seen.timeZone).toBe('Europe/London');
    expect({ width: seen.width, height: seen.height }).toEqual({ width: 1280, height: 720 });
  });

  it('@theme:dark @locale:fr-FR @timezone:Asia/Tokyo @viewport:320x640 override the env', () => {
    expect(status('tagged')).toBe('passed');
    const seen = probe('tagged');
    expect(seen.dark).toBe(true);
    expect(seen.language).toBe('fr-FR');
    expect(seen.timeZone).toBe('Asia/Tokyo');
    expect({ width: seen.width, height: seen.height }).toEqual({ width: 320, height: 640 });
  });

  it('@device:iPhone-15 applies the descriptor within the run target browser', () => {
    expect(status('device')).toBe('passed');
    const seen = probe('device');
    expect(seen.width).toBe(393);
    expect(seen.touch).toBe(true);
    expect(seen.userAgent).toContain('iPhone');
  });

  it('a locale step without the tag fails instead of running under the wrong locale', () => {
    const result = results[`${DESKTOP}/untagged locale step`];
    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('@locale:de-DE');
  });

  it('tagged Examples blocks give each example its own locale and theme', () => {
    // Example #1 is the de block, #2 the ja block.
    expect(status('Example #1')).toBe('passed');
    expect(status('Example #2')).toBe('passed');
    expect(probe('Example #1')).toMatchObject({ language: 'de-DE', dark: true });
    // The ja block carries no @theme:, so it falls back to the env's light scheme.
    expect(probe('Example #2')).toMatchObject({ language: 'ja-JP', dark: false });
  });

  it('a mobile run target keeps its device viewport (it was reset to 1280x720)', () => {
    expect(status('untagged', MOBILE)).toBe('passed');
    const seen = probe('untagged', MOBILE);
    // Pixel 7 — the descriptor behind mobile-chrome.
    expect({ width: seen.width, height: seen.height }).toEqual({ width: 412, height: 839 });
    expect(seen.touch).toBe(true);
  });

  it('a tag still wins over the mobile target descriptor', () => {
    expect(status('tagged', MOBILE)).toBe('passed');
    const seen = probe('tagged', MOBILE);
    expect({ width: seen.width, height: seen.height }).toEqual({ width: 320, height: 640 });
    expect(seen.dark).toBe(true);
    expect(seen.language).toBe('fr-FR');
  });
});
