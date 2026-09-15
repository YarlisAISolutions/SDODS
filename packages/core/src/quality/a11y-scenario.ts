import { expect, type Page } from '@playwright/test';
import { attachmentNames, scenarioFiles, type A11yConfig } from '@sdods/contracts';
import {
  IMPACT_ORDER,
  assertAxeChecked,
  describeViolations,
  parseImpactFloor,
  runAxe,
  violationsAtOrAbove,
  wasPageAudited,
  writeAndAttachJson,
  type A11yResults,
} from '../a11y/audit.js';
import { SdodsError } from '../errors.js';

/**
 * The audit an `@a11y` tag buys. Before this existed the tag was a label: the linter accepted it,
 * the docs said it ran axe, and nothing read it.
 *
 * At the END of an `@a11y` UI or hybrid scenario, the page the scenario finished on is audited with
 * axe (WCAG 2.x A/AA, as the explicit steps are) and the scenario fails on any violation at or above
 * `a11y.failOn`. The report is attached as `sdods/a11y-scenario` pass or fail, and it is also what
 * the `a11y` process gate reads.
 *
 * What it deliberately does not do:
 *   · audit a scenario that already failed. The page it stopped on is wherever the failure left it,
 *     and a violation list on top of the real error only buries the error;
 *   · audit a URL an explicit whole-page audit step already covered in the same scenario. That step
 *     ran with the threshold its author chose, and it passed (a failed step would have failed the
 *     scenario);
 *   · audit every page the scenario passed through. It audits the final page. A flow that needs each
 *     page checked writes the explicit step after each navigation.
 */

export type A11yScenarioStatus = 'audited' | 'covered-by-step' | 'skipped';

/** What `sdods/a11y-scenario` contains, and what the `a11y` process gate reads back. */
export interface A11yScenarioReport {
  kind: 'a11y-scenario';
  runnerProject: string;
  fingerprint: string;
  retry: number;
  url: string;
  status: A11yScenarioStatus;
  reason?: string;
  failOn: A11yConfig['failOn'];
  include: string[];
  exclude: string[];
  /** Every violation axe reported, at any impact. */
  violations: number;
  /** Violations at or above `failOn`: the ones that fail the scenario. */
  blocking: number;
  blockingRules: string[];
  results?: A11yResults;
}

export interface A11yScenarioDeps {
  page: Page;
  config: { project: { a11y?: Partial<A11yConfig> } };
  scenario: {
    data: { runnerProject: string; fingerprint: string; retry: number };
    file(rel: string): string;
  };
  testInfo: {
    status?: string;
    attach(name: string, opts: { path: string; contentType: string }): Promise<void>;
  };
}

/** Effective a11y settings with the schema defaults, so a hand-built config behaves like a parsed one. */
export function a11ySettings(config: A11yScenarioDeps['config']): A11yConfig {
  const a = config.project.a11y ?? {};
  return { failOn: a.failOn ?? 'serious', include: a.include ?? [], exclude: a.exclude ?? [] };
}

export async function auditScenarioEnd(deps: A11yScenarioDeps): Promise<A11yScenarioReport> {
  const { page, scenario, testInfo } = deps;
  const settings = a11ySettings(deps.config);
  const floor = parseImpactFloor(settings.failOn);
  const url = page.url();
  const base = {
    kind: 'a11y-scenario' as const,
    runnerProject: scenario.data.runnerProject,
    fingerprint: scenario.data.fingerprint,
    retry: scenario.data.retry,
    url,
    failOn: settings.failOn,
    include: settings.include,
    exclude: settings.exclude,
    violations: 0,
    blocking: 0,
    blockingRules: [] as string[],
  };
  const file = scenario.file(scenarioFiles.a11yScenarioJson(scenario.data.runnerProject));
  const write = (report: A11yScenarioReport) =>
    writeAndAttachJson(testInfo, attachmentNames.a11yScenario, file, report).then(() => report);

  if (testInfo.status && testInfo.status !== 'passed') {
    return write({
      ...base,
      status: 'skipped',
      reason: `the scenario ${testInfo.status} before the audit, so the page it stopped on proves nothing`,
    });
  }
  if (!url || url === 'about:blank') {
    throw new SdodsError(
      'RUN_FAILED',
      'This @a11y scenario never navigated anywhere, so there is no page to audit.',
      {
        hint: 'Navigate to the page under test in the scenario, or drop @a11y from a scenario that has no page.',
      },
    );
  }
  if (wasPageAudited(scenario, url)) {
    return write({
      ...base,
      status: 'covered-by-step',
      reason: 'an explicit whole-page accessibility step already audited this URL in the scenario',
    });
  }

  const results = await runAxe(page, { include: settings.include, exclude: settings.exclude });
  const blocking = violationsAtOrAbove(results.violations, floor);
  const report = await write({
    ...base,
    status: 'audited',
    violations: results.violations.length,
    blocking: blocking.length,
    blockingRules: blocking.map((v) => v.id),
    results,
  });
  assertAxeChecked(results, `on ${url}`);
  expect(
    blocking.length,
    `@a11y: ${blocking.length} violation(s) at ${IMPACT_ORDER[floor]} or worse on ${url} (of ${results.violations.length} total; a11y.failOn is "${settings.failOn}"):\n${describeViolations(blocking)}`,
  ).toBe(0);
  return report;
}
