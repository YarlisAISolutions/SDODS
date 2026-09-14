import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devices } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema } from '@sdods/contracts';
import {
  applyEmulation,
  emulationFromTags,
  emulationTagProblem,
  findDevice,
} from '../src/config/emulation.js';
import { ProjectRegistry } from '../src/config/registry.js';
import { buildRunnerConfig } from '../src/config/runner.js';
import { SdodsError } from '../src/errors.js';
import { lintProject } from '../src/lint/index.js';

/**
 * #116 — `@locale:` `@timezone:` `@theme:` `@viewport:` `@device:`. The browser proof is in
 * emulation-tags-run.test.ts; these are the parts that can be wrong without a browser: the
 * precedence between a tag and the env's `use:`, the validation lint shares with the runtime, and
 * the runner config the env's `use:` block travels through.
 */

describe('emulationFromTags + applyEmulation — precedence', () => {
  const env = { locale: 'en-GB', timezoneId: 'Europe/London', colorScheme: 'light' as const };

  it('an untagged scenario keeps exactly what the env resolved', () => {
    expect(applyEmulation(env, emulationFromTags(['@ui', '@smoke', '@user:admin']))).toEqual(env);
  });

  it('tags override the env, key by key', () => {
    expect(applyEmulation(env, emulationFromTags(['@theme:dark', '@locale:fr-FR']))).toEqual({
      locale: 'fr-FR',
      timezoneId: 'Europe/London',
      colorScheme: 'dark',
    });
    expect(applyEmulation(env, emulationFromTags(['@timezone:Asia/Tokyo'])).timezoneId).toBe(
      'Asia/Tokyo',
    );
  });

  it('@viewport: sets the size and wins over the @device: viewport', () => {
    const base = { viewport: { width: 1280, height: 720 } };
    expect(applyEmulation(base, emulationFromTags(['@viewport:320x640'])).viewport).toEqual({
      width: 320,
      height: 640,
    });
    const both = applyEmulation(
      base,
      emulationFromTags(['@device:iPhone-15', '@viewport:320x640']),
    );
    expect(both.viewport).toEqual({ width: 320, height: 640 });
    expect((both as { userAgent?: string }).userAgent).toBe(devices['iPhone 15']!.userAgent);
  });

  it('@device: carries the descriptor, but never isMobile onto firefox (newContext throws)', () => {
    const e = emulationFromTags(['@device:Pixel-7']);
    expect(applyEmulation({ isMobile: false, browserName: 'chromium' }, e).isMobile).toBe(true);
    expect(applyEmulation({ isMobile: false, browserName: 'firefox' }, e).isMobile).toBe(false);
    expect(applyEmulation({ hasTouch: false }, e).hasTouch).toBe(true);
  });

  it('device names match without spaces and without case', () => {
    expect(findDevice('iPhone-15')).toBe('iPhone 15');
    expect(findDevice('iphone_15')).toBe('iPhone 15');
    expect(findDevice('Galaxy-S9+')).toBe('Galaxy S9+');
    expect(findDevice('Nokia-3310')).toBeUndefined();
  });

  it('refuses an unusable value or two values for one key at runtime', () => {
    expect(() => emulationFromTags(['@theme:dim'])).toThrow(SdodsError);
    expect(() => emulationFromTags(['@locale:fr', '@locale:de'])).toThrow(/Conflicting/);
    // The same tag twice (Feature and Scenario) is not a conflict.
    expect(emulationFromTags(['@locale:fr', '@locale:fr']).locale).toBe('fr');
  });
});

describe('emulationTagProblem — shared by lint and runtime', () => {
  it.each([
    ['locale', 'fr'],
    ['locale', 'fr-FR'],
    ['locale', 'zh-Hant-TW'],
    ['timezone', 'Europe/Paris'],
    ['timezone', 'UTC'],
    ['theme', 'light'],
    ['theme', 'dark'],
    ['theme', 'no-preference'],
    ['viewport', '320x640'],
    ['device', 'iPhone-15'],
  ] as const)('accepts @%s:%s', (key, value) => {
    expect(emulationTagProblem(key, value)).toBeUndefined();
  });

  it.each([
    ['locale', 'fr_FR'],
    ['locale', 'not a locale'],
    ['timezone', 'Mars/Olympus'],
    ['theme', 'dim'],
    ['viewport', '320'],
    ['viewport', '0x640'],
    ['viewport', '320X640'],
    ['device', 'Nokia-3310'],
  ] as const)('rejects @%s:%s', (key, value) => {
    expect(emulationTagProblem(key, value)).toMatch(new RegExp(`^@${key}:`));
  });
});

function lintFixture(feature: string) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-lint-emulation-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'features'), { recursive: true });
  writeFileSync(join(proj, 'features', 'a.feature'), feature);
  return lintProject({
    project: {
      ...ProjectConfigSchema.parse({
        slug: 'shop',
        name: 'Shop',
        layers: ['ui'],
        browsers: ['chromium'],
        envs: { default: 'staging', available: ['staging'] },
      }),
      root: proj,
    },
  });
}

const scenario = (tags: string) =>
  `@ui @smoke\nFeature: F\n\n  ${tags}\n  Scenario: S\n    Given I open the home page\n`;

describe('sdods lint — emulation tags', () => {
  it('accepts every valid tag with no unknown-tag warning', async () => {
    const res = await lintFixture(
      scenario(
        '@locale:fr-FR @timezone:Asia/Tokyo @theme:dark @viewport:320x640 @device:iPhone-15',
      ),
    );
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => w.rule === 'tags/unknown')).toEqual([]);
  });

  it('rejects a bad value under the tag rule, with the reason', async () => {
    const res = await lintFixture(
      scenario('@locale:fr_FR @timezone:Mars/Olympus @theme:dim @viewport:320 @device:Nokia-3310'),
    );
    expect(res.errors.map((e) => e.rule).sort()).toEqual([
      'tags/device',
      'tags/locale',
      'tags/theme',
      'tags/timezone',
      'tags/viewport',
    ]);
    expect(res.errors.find((e) => e.rule === 'tags/theme')?.message).toContain('no-preference');
  });

  it('rejects a Feature tag and a Scenario tag that disagree', async () => {
    const res = await lintFixture(
      `@ui @smoke @theme:light\nFeature: F\n\n  @theme:dark\n  Scenario: S\n    Given I open the home page\n`,
    );
    expect(res.errors.filter((e) => e.rule === 'tags/theme')).toHaveLength(1);
    expect(res.errors[0]?.message).toContain('Conflicting');
  });

  it('allows one Examples block per locale on an outline', async () => {
    const res = await lintFixture(`@ui @smoke
Feature: F

  Scenario Outline: S <n>
    Given I open the home page

    @locale:fr-FR
    Examples:
      | n |
      | 1 |

    @locale:de-DE
    Examples:
      | n |
      | 2 |
`);
    expect(res.errors.filter((e) => e.rule === 'tags/locale')).toEqual([]);
  });
});

describe('runner config — the env use: block and mobile targets', () => {
  function projects(envUse: string) {
    const root = mkdtempSync(join(tmpdir(), 'sdods-runner-emulation-'));
    const proj = join(root, 'projects', 'shop');
    mkdirSync(join(proj, 'envs'), { recursive: true });
    mkdirSync(join(proj, 'features'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(
      join(proj, 'sdods.project.yaml'),
      'slug: shop\nname: Shop\nlayers: [ui]\nbrowsers: [chromium, mobile-chrome, mobile-safari]\nenvs: { default: local, available: [local] }\n',
    );
    writeFileSync(
      join(proj, 'envs', 'local.yaml'),
      `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n${envUse}`,
    );
    const cfg = buildRunnerConfig(ProjectRegistry.discover(root), { env: 'local' });
    return Object.fromEntries(
      (cfg.projects ?? []).map((p) => [p.name, p.use as Record<string, unknown>]),
    );
  }

  it('threads use.colorScheme, locale and timezoneId into every browser target (#51)', () => {
    const use = projects('use: { colorScheme: dark, locale: fr-FR, timezoneId: Asia/Tokyo }\n');
    for (const name of [
      'shop--ui--chromium',
      'shop--ui--mobile-chrome',
      'shop--ui--mobile-safari',
    ]) {
      expect(use[name]).toMatchObject({
        colorScheme: 'dark',
        locale: 'fr-FR',
        timezoneId: 'Asia/Tokyo',
      });
    }
  });

  it('a mobile target keeps its device viewport instead of an explicit undefined', () => {
    // Playwright reads `viewport: undefined` as "use the default", so the key being present at all
    // turned Pixel 7 and iPhone 15 into 1280x720 windows (proven in a real run in
    // emulation-tags-run.test.ts).
    const use = projects('');
    expect(use['shop--ui--mobile-chrome']?.viewport).toEqual(devices['Pixel 7']!.viewport);
    expect(use['shop--ui--mobile-safari']?.viewport).toEqual(devices['iPhone 15']!.viewport);
    expect(use['shop--ui--chromium']?.viewport).toEqual({ width: 1280, height: 720 });
  });
});
