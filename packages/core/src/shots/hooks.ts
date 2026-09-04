import { AfterScenario, AfterStep, BeforeScenario, BeforeStep } from '../fixtures/test.js';

/**
 * Screenshot narrative hooks. Tag-filtered so API scenarios never instantiate a page.
 * playwright-bdd resolves fixture dependencies from the destructured names.
 */
const UI = '@ui or @hybrid';

/** `@skip:<browser>`: per-browser exclusion validated by lint, applied here for every layer. */
BeforeScenario({ name: 'automax:skip-browser' }, async ({ automax, $tags, $testInfo }) => {
  const skips = $tags.filter((t) => t.startsWith('@skip:')).map((t) => t.slice('@skip:'.length));
  if (automax.browser && skips.includes(automax.browser)) {
    $testInfo.skip(true, `skipped on ${automax.browser} by @skip:${automax.browser}`);
  }
});

BeforeScenario({ name: 'automax:shots:start', tags: UI }, async ({ shots }) => {
  await shots.scenarioStart();
});

BeforeStep({ name: 'automax:shots:before', tags: UI }, async ({ shots, $bddContext }) => {
  await shots.beforeStep($bddContext.stepIndex, $bddContext.step.title);
});

AfterStep({ name: 'automax:shots:after', tags: UI }, async ({ shots, $bddContext }) => {
  await shots.afterStep($bddContext.stepIndex, $bddContext.step.title);
});

AfterScenario({ name: 'automax:shots:end', tags: UI }, async ({ shots, $testInfo }) => {
  if ($testInfo.status && $testInfo.status !== 'passed' && $testInfo.status !== 'skipped')
    await shots.failure();
  await shots.scenarioEnd();
});

AfterScenario({ name: 'automax:finalize' }, async ({ scenario, apiContext, heal, $testInfo }) => {
  scenario.finalize({
    status: ($testInfo.status as any) ?? 'unknown',
    errorMessage: $testInfo.error?.message,
    apiCalls: apiContext.history.length,
    heals: heal.events.length,
  });
});
