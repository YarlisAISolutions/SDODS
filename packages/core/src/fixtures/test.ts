import { join } from 'node:path';
import { test as base, createBdd } from 'playwright-bdd';
import type { EnvConfig } from '@sdods/contracts';
import { ProjectRegistry } from '../config/registry.js';
import type { HarMode } from '../config/resolve.js';
import { parseTagValue, scenarioSkipReason } from '../config/tags.js';
import { applyEmulation, emulationFromTags } from '../config/emulation.js';
import { noopAuth } from '../auth/index.js';
import { ApiClient, isolatedRequestFactory } from '../api/client.js';
import { CompositeDataProvider } from '../data/provider.js';
import { FileUserPool } from '../data/user-pool.js';
import { apiHarForScenario } from '../har/hooks.js';
import { Healer } from '../heal/healer.js';
import { HealHistory } from '../heal/history.js';
import { Logger } from '../logger.js';
import { ScreenshotNarrator } from '../shots/narrator.js';
import { resolvePolicy } from '../shots/policy.js';
import { ApiContext } from './api-context.js';
import { AuthStateCache } from './auth.js';
import { PageRegistry } from './pages.js';
import { ScenarioMeta } from './scenario.js';
import type { DbHandle, TestFixtures, WorkerFixtures } from './types.js';

export type { TestFixtures, WorkerFixtures, SdodsOption } from './types.js';

const log = new Logger('fixtures');

/**
 * The single merged test object. Projects extend it in `steps/fixtures.ts`
 * (auth strategy + page-object fixtures) and playwright-bdd imports that file.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // ── worker scope ────────────────────────────────────────────────────────
  sdods: [
    { project: process.env.SDODS_PROJECT ?? '', layer: 'ui' },
    { option: true, scope: 'worker' },
  ],

  registry: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(
        ProjectRegistry.discover(
          ProjectRegistry.findRepoRoot(process.env.SDODS_ROOT ?? process.cwd()),
        ),
      );
    },
    { scope: 'worker' },
  ],

  config: [
    async ({ registry, sdods }, use) => {
      const slug =
        sdods.project || process.env.SDODS_PROJECT || registry.entriesList()[0]?.slug || '';
      await use(registry.resolve(slug, process.env.SDODS_ENV || undefined));
    },
    { scope: 'worker' },
  ],

  env: [async ({ config }, use) => use(config.env as EnvConfig), { scope: 'worker' }],
  runDir: [async ({ config }, use) => use(config.runtime.runDir), { scope: 'worker' }],
  harMode: [async ({ config }, use) => use(config.runtime.harMode as HarMode), { scope: 'worker' }],

  auth: [noopAuth, { option: true, scope: 'worker' }],

  db: [
    async ({ config }, use) => {
      let handle: DbHandle | undefined;
      let close: (() => Promise<void>) | undefined;
      if (config.env.db) {
        try {
          const mod = await import('@sdods/db');
          const adb = mod.createDb(
            config.env.db.driver === 'postgres'
              ? { driver: 'postgres', databaseUrl: config.env.db.url }
              : { driver: 'sqlite', sqlitePath: config.env.db.url.replace(/^file:/, '') },
          );
          handle = adb.db as unknown as DbHandle;
          close = () => adb.close();
        } catch (e) {
          log.warn(
            `env.db is configured but @sdods/db could not be loaded: ${(e as Error).message}`,
          );
        }
      }
      await use(handle);
      if (close) await close();
    },
    { scope: 'worker' },
  ],

  userPool: [
    async ({ config }, use, workerInfo) => {
      const provider = new CompositeDataProvider(config);
      const pool = new FileUserPool(config, provider, {
        owner: FileUserPool.ownerFor(config, workerInfo.parallelIndex),
      });
      await use(pool);
      await pool.releaseAll();
    },
    { scope: 'worker' },
  ],

  authCache: [async ({ config }, use) => use(new AuthStateCache(config)), { scope: 'worker' }],

  healHistory: [
    async ({ config }, use) => {
      const history = new HealHistory(join(config.runtime.artifactsDir, '..', 'heal-history.json'));
      await use(history);
      history.save();
    },
    { scope: 'worker' },
  ],

  // ── test scope ──────────────────────────────────────────────────────────

  /**
   * Automatic, and an explicit DEPENDENCY of `user` — which is what actually makes
   * it decide before anything expensive happens.
   *
   * Declaration order alone does not: Playwright instantiates fixtures in
   * dependency order, and `user` is pulled in by `storageState`, which the browser
   * context needs, so the pool lease happened first regardless of where the gate
   * sat in the object. An `@env:local @user:noconsent` scenario on staging failed
   * with `No users with role "noconsent"` instead of skipping — the gate never got
   * to run. Depending on it is the only ordering guarantee Playwright offers.
   *
   * `@env:`, `@skip:<browser>` and `@flag:` were validated at LINT time and had
   * no runtime path whatsoever. That is the worst arrangement available: the
   * tag reads as a control, the linter confirms it is spelled correctly, and
   * the runner ignores it — so a project can carry hundreds of `@env:` tags and
   * still point every one of them at production. `@quarantine` was worse still:
   * it was not a tag this framework knew at all, and every recipe excluded it
   * by hand in a tag expression that drifts and that nobody can audit.
   */
  $sdodsTagGate: [
    async ({ config, $tags }, use, testInfo) => {
      const features = config.env.vars?.features;
      const reason = scenarioSkipReason($tags, {
        env: config.env.name,
        browser: testInfo.project.use?.browserName,
        // Only gate on flags when the environment actually declares them.
        // An absent list means "not known", and an unknown list must never
        // silently skip a suite.
        flags:
          typeof features === 'string'
            ? features
                .split(',')
                .map((f) => f.trim())
                .filter(Boolean)
            : undefined,
        quarantine: process.env.SDODS_QUARANTINE === 'run' ? 'run' : 'skip',
      });
      if (reason) {
        // Recorded as an annotation as well as a skip reason: a run report that
        // says "skipped" without saying why is the thing that let 175 parked
        // scenarios go unnoticed.
        testInfo.annotations.push({ type: 'sdods:skipped', description: reason });
        testInfo.skip(true, reason);
      }
      await use();
    },
    { auto: true },
  ],

  scenario: async ({ config, sdods, $bddContext, $tags }, use, testInfo) => {
    const meta = new ScenarioMeta({
      config,
      testInfo,
      featureUri: $bddContext.featureUri,
      tags: $tags,
      pickleLine: $bddContext.bddTestData?.pickleLine,
      sdods,
    });
    await use(meta);
  },

  // eslint-disable-next-line no-empty-pattern
  apiContext: async ({}, use) => {
    await use(new ApiContext());
  },

  // `request` is Playwright's shared APIRequestContext. It is seeded from the test's context
  // options, so on @ui/@hybrid it carries the leased role's storageState cookies (plus any cookie
  // a response sets); on @api storageState is undefined and it starts empty. The isolated context
  // behind `I use an isolated API client` is only created when a scenario asks for it.
  api: async (
    { request, playwright, config, apiContext, scenario, harMode, $bddContext, $tags },
    use,
    testInfo,
  ) => {
    const isolated = isolatedRequestFactory(playwright.request);
    await use(
      new ApiClient({
        request,
        isolatedRequest: isolated.get,
        config,
        ctx: apiContext,
        testInfo,
        scenario,
        stepIndex: () => $bddContext.stepIndex,
        har: apiHarForScenario({ $tags, config, harMode }),
      }),
    );
    await isolated.dispose();
  },

  data: async ({ config, scenario, apiContext }, use, testInfo) => {
    const provider = new CompositeDataProvider(config, { seed: scenario.fingerprint });
    await use(provider);
    const errors = await provider.runCleanups();
    if (errors.length) {
      const file = scenario.file('cleanup-errors.json');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(file, JSON.stringify(errors, null, 2));
      await testInfo.attach('sdods/cleanup-errors', {
        path: file,
        contentType: 'application/json',
      });
    }
    void apiContext;
  },

  // `$sdodsTagGate` first, and it is not unused: it is here to force the ordering.
  // Leasing an account for a scenario that the tag gate is about to skip burns a
  // pool slot, and on a role with no rows it throws before the skip can happen.
  user: async ({ $sdodsTagGate, userPool, $tags }, use, testInfo) => {
    void $sdodsTagGate;
    const role = parseTagValue($tags, 'user');
    await use(role ? await userPool.lease(role, testInfo.parallelIndex) : undefined);
  },

  storageState: async ({ user, authCache, auth, sdods, browser, config }, use) => {
    if (!user || sdods.layer === 'api' || !config.project.auth.storageState) return use(undefined);
    await use(await authCache.ensure(user, auth, browser));
  },

  // ── per-scenario emulation: @locale: @timezone: @theme: @viewport: @device: ────
  //
  // Mirrors `storageState` above: Playwright builds the browser context from these option
  // fixtures, so overriding them is the one place a tag can reach the context BEFORE it opens —
  // which locale and timezone require, because neither can change on a live context. Each
  // override takes its own previous value (the env's `use:` via the runner project, or
  // Playwright's default) and replaces it only when the scenario is tagged, so tags win over the
  // env and an untagged scenario is untouched.
  $sdodsEmulation: async ({ $tags }, use) => {
    await use(emulationFromTags($tags));
  },
  locale: async ({ locale, $sdodsEmulation }, use) => {
    await use(applyEmulation({ locale }, $sdodsEmulation).locale);
  },
  timezoneId: async ({ timezoneId, $sdodsEmulation }, use) => {
    await use(applyEmulation({ timezoneId }, $sdodsEmulation).timezoneId);
  },
  colorScheme: async ({ colorScheme, $sdodsEmulation }, use) => {
    await use(applyEmulation({ colorScheme }, $sdodsEmulation).colorScheme);
  },
  viewport: async ({ viewport, $sdodsEmulation }, use) => {
    await use(applyEmulation({ viewport }, $sdodsEmulation).viewport);
  },
  userAgent: async ({ userAgent, $sdodsEmulation }, use) => {
    await use(applyEmulation({ userAgent }, $sdodsEmulation).userAgent);
  },
  deviceScaleFactor: async ({ deviceScaleFactor, $sdodsEmulation }, use) => {
    await use(applyEmulation({ deviceScaleFactor }, $sdodsEmulation).deviceScaleFactor);
  },
  hasTouch: async ({ hasTouch, $sdodsEmulation }, use) => {
    await use(applyEmulation({ hasTouch }, $sdodsEmulation).hasTouch);
  },
  isMobile: async ({ isMobile, browserName, $sdodsEmulation }, use) => {
    await use(applyEmulation({ isMobile, browserName }, $sdodsEmulation).isMobile);
  },

  heal: async ({ config, healHistory, scenario, $bddContext }, use, testInfo) => {
    await use(
      new Healer({
        config: config.project.heal,
        history: healHistory,
        scenario,
        testInfo,
        stepIndex: () => $bddContext.stepIndex,
        runId: config.runtime.runId,
      }),
    );
  },

  pages: async ({ page, config, heal, apiContext }, use) => {
    await use(new PageRegistry(page, config, heal, () => apiContext.vars.toObject()));
  },

  shots: async ({ page, config, scenario, apiContext, $tags }, use, testInfo) => {
    await use(
      new ScreenshotNarrator({
        page,
        policy: resolvePolicy($tags, config),
        scenario,
        testInfo,
        skipStep: (idx) => (apiContext.callsByStep.get(idx) ?? 0) > 0,
      }),
    );
  },

  $sdodsAnnotations: [
    async ({ config, sdods, scenario }, use, testInfo) => {
      testInfo.annotations.push(
        { type: 'sdods:project', description: config.project.slug },
        { type: 'sdods:layer', description: sdods.layer },
        { type: 'sdods:env', description: config.env.name },
        { type: 'sdods:fingerprint', description: scenario.fingerprint },
        { type: 'sdods:runId', description: config.runtime.runId },
      );
      await use();
    },
    { auto: true },
  ],
});

export const {
  Given,
  When,
  Then,
  Step,
  Before,
  After,
  BeforeAll,
  AfterAll,
  BeforeWorker,
  AfterWorker,
  BeforeScenario,
  AfterScenario,
  BeforeStep,
  AfterStep,
} = createBdd(test);

export { createBdd };
export type SdodsTest = typeof test;
