import { AfterScenario, AfterStep, BeforeScenario } from '../fixtures/test.js';
import { auditAfterStep, auditScenarioEnd, watchA11yPages } from './a11y-scenario.js';
import { judgeScenarioPerf, watchNavigations } from './perf-scenario.js';

/**
 * `@a11y` and `@perf` tag hooks.
 *
 * Tag-filtered scenario hooks rather than auto fixtures, for the reason `shots/hooks.ts` gives: a
 * hook's fixtures are requested only by the scenarios its tag expression matches (playwright-bdd
 * decides that when it generates the spec), so an `@api @perf` scenario never opens a browser to be
 * judged. playwright-bdd reads the fixture names from the destructuring below, so each hook lists
 * its fixtures literally and hands them to a plain function the unit tests call directly.
 *
 * Registered after the screenshot hooks and before nothing else: after-hooks run in reverse
 * registration order, so these run BEFORE `sdods:finalize` and can leave their verdict on the
 * scenario for it to record. A failure here is otherwise invisible to `meta.json`, because
 * Playwright only marks the test failed once every after-hook has returned.
 */

const PAGE = '(@ui or @hybrid)';

async function noting<T>(scenario: { noteFailure(message: string): void }, run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    scenario.noteFailure(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

BeforeScenario(
  { name: 'sdods:perf:watch', tags: `@perf and ${PAGE}` },
  async ({ page, scenario }) => {
    await watchNavigations({ page, scenario });
  },
);

// Registered before the a11y hook, so it runs after it: the audit's axe injection is not a navigation.
AfterScenario(
  { name: 'sdods:perf', tags: '@perf' },
  async ({ config, scenario, apiContext, $testInfo }) => {
    await noting(scenario, () =>
      judgeScenarioPerf({ config, scenario, apiContext, testInfo: $testInfo }),
    );
  },
);

// `a11y.scope: every-page` only; both are no-ops under the default `final`.
BeforeScenario(
  { name: 'sdods:a11y:watch', tags: `@a11y and ${PAGE}` },
  async ({ page, config, scenario }) => {
    watchA11yPages({ page, config, scenario });
  },
);

AfterStep(
  { name: 'sdods:a11y:page', tags: `@a11y and ${PAGE}` },
  async ({ page, config, scenario, $bddContext }) => {
    await noting(scenario, () =>
      auditAfterStep({
        page,
        config,
        scenario,
        step: $bddContext.step.title,
        failed: $bddContext.step.error !== undefined,
      }),
    );
  },
);

AfterScenario(
  { name: 'sdods:a11y', tags: `@a11y and ${PAGE}` },
  async ({ page, config, scenario, $testInfo }) => {
    await noting(scenario, () => auditScenarioEnd({ page, config, scenario, testInfo: $testInfo }));
  },
);
