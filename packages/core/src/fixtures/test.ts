import { join } from 'node:path';
import { test as base, createBdd } from 'playwright-bdd';
import type { EnvConfig } from '@automax/contracts';
import { ProjectRegistry } from '../config/registry.js';
import type { HarMode } from '../config/resolve.js';
import { parseTagValue } from '../config/tags.js';
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

export type { TestFixtures, WorkerFixtures, AutomaxOption } from './types.js';

const log = new Logger('fixtures');

/**
 * The single merged test object. Projects extend it in `steps/fixtures.ts`
 * (auth strategy + page-object fixtures) and playwright-bdd imports that file.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // ── worker scope ────────────────────────────────────────────────────────
  automax: [
    { project: process.env.AUTOMAX_PROJECT ?? '', layer: 'ui' },
    { option: true, scope: 'worker' },
  ],

  registry: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(
        ProjectRegistry.discover(
          ProjectRegistry.findRepoRoot(process.env.AUTOMAX_ROOT ?? process.cwd()),
        ),
      );
    },
    { scope: 'worker' },
  ],

  config: [
    async ({ registry, automax }, use) => {
      const slug =
        automax.project || process.env.AUTOMAX_PROJECT || registry.entriesList()[0]?.slug || '';
      await use(registry.resolve(slug, process.env.AUTOMAX_ENV || undefined));
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
          const mod = await import('@automax/db');
          const adb = mod.createDb(
            config.env.db.driver === 'postgres'
              ? { driver: 'postgres', databaseUrl: config.env.db.url }
              : { driver: 'sqlite', sqlitePath: config.env.db.url.replace(/^file:/, '') },
          );
          handle = adb.db as unknown as DbHandle;
          close = () => adb.close();
        } catch (e) {
          log.warn(
            `env.db is configured but @automax/db could not be loaded: ${(e as Error).message}`,
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
  scenario: async ({ config, automax, $bddContext, $tags }, use, testInfo) => {
    const meta = new ScenarioMeta({
      config,
      testInfo,
      featureUri: $bddContext.featureUri,
      tags: $tags,
      pickleLine: $bddContext.bddTestData?.pickleLine,
      automax,
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
      await testInfo.attach('automax/cleanup-errors', {
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

  storageState: async ({ user, authCache, auth, automax, browser, config }, use) => {
    if (!user || automax.layer === 'api' || !config.project.auth.storageState)
      return use(undefined);
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

  $automaxAnnotations: [
    async ({ config, automax, scenario }, use, testInfo) => {
      testInfo.annotations.push(
        { type: 'automax:project', description: config.project.slug },
        { type: 'automax:layer', description: automax.layer },
        { type: 'automax:env', description: config.env.name },
        { type: 'automax:fingerprint', description: scenario.fingerprint },
        { type: 'automax:runId', description: config.runtime.runId },
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
export type AutomaxTest = typeof test;
