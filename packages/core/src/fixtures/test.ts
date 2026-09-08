import { join } from 'node:path';
import { test as base, createBdd } from 'playwright-bdd';
import type { EnvConfig } from '@sdods/contracts';
import { ProjectRegistry } from '../config/registry.js';
import type { HarMode } from '../config/resolve.js';
import { parseTagValue, scenarioSkipReason } from '../config/tags.js';
import { noopAuth } from '../auth/index.js';
import { ApiClient } from '../api/client.js';
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
   * Declared FIRST in test scope, and automatic, so it decides before anything
   * expensive happens — before a pool account is leased, before a browser
   * context is built, before a session is minted.
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

  api: async (
    { request, config, apiContext, scenario, harMode, $bddContext, $tags },
    use,
    testInfo,
  ) => {
    await use(
      new ApiClient({
        request,
        config,
        ctx: apiContext,
        testInfo,
        scenario,
        stepIndex: () => $bddContext.stepIndex,
        har: apiHarForScenario({ $tags, config, harMode }),
      }),
    );
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

  user: async ({ userPool, $tags }, use, testInfo) => {
    const role = parseTagValue($tags, 'user');
    await use(role ? await userPool.lease(role, testInfo.parallelIndex) : undefined);
  },

  storageState: async ({ user, authCache, auth, sdods, browser, config }, use) => {
    if (!user || sdods.layer === 'api' || !config.project.auth.storageState) return use(undefined);
    await use(await authCache.ensure(user, auth, browser));
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
