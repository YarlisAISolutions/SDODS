import { AfterScenario, AfterStep, BeforeScenario, BeforeStep } from '../fixtures/test.js';

/**
 * Screenshot narrative hooks. Tag-filtered so API scenarios never instantiate a page.
 * playwright-bdd resolves fixture dependencies from the destructured names.
 */
const UI = '@ui or @hybrid';

/** `@skip:<browser>`: per-browser exclusion validated by lint, applied here for every layer. */
BeforeScenario({ name: 'sdods:skip-browser' }, async ({ sdods, $tags, $testInfo }) => {
  const skips = $tags.filter((t) => t.startsWith('@skip:')).map((t) => t.slice('@skip:'.length));
  if (sdods.browser && skips.includes(sdods.browser)) {
    $testInfo.skip(true, `skipped on ${sdods.browser} by @skip:${sdods.browser}`);
  }
});

BeforeScenario({ name: 'sdods:shots:start', tags: UI }, async ({ shots }) => {
  await shots.scenarioStart();
});

BeforeStep({ name: 'sdods:shots:before', tags: UI }, async ({ shots, $bddContext }) => {
  await shots.beforeStep($bddContext.stepIndex, $bddContext.step.title);
});

AfterStep({ name: 'sdods:shots:after', tags: UI }, async ({ shots, $bddContext }) => {
  await shots.afterStep($bddContext.stepIndex, $bddContext.step.title);
});

AfterScenario({ name: 'sdods:shots:end', tags: UI }, async ({ shots, $testInfo }) => {
  if ($testInfo.status && $testInfo.status !== 'passed' && $testInfo.status !== 'skipped')
    await shots.failure();
  await shots.scenarioEnd();
});

AfterScenario({ name: 'sdods:finalize' }, async ({ scenario, apiContext, heal, $testInfo }) => {
  scenario.finalize({
    status: ($testInfo.status as any) ?? 'unknown',
    errorMessage: $testInfo.error?.message,
    apiCalls: apiContext.history.length,
    heals: heal.events.length,
  });
});
