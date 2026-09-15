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
import { waitForSettle } from './perf-scenario.js';

/**
 * The audit an `@a11y` tag buys. Before this existed the tag was a label: the linter accepted it,
 * the docs said it ran axe, and nothing read it.
 *
 * At the END of an `@a11y` UI or hybrid scenario, the page the scenario finished on is audited with
 * axe (WCAG 2.x A/AA, as the explicit steps are) and the scenario fails on any violation at or above
 * `a11y.failOn`. The report is attached as `sdods/a11y-scenario` pass or fail, and it is also what
 * the `a11y` process gate reads.
 *
 * `a11y.scope: every-page` widens that to every distinct URL the scenario reaches. Each one is
 * audited after the STEP that reached it, once the page has settled at the point the `@perf` hook
 * reads a document (load, first paint, the LCP settle window). The trigger is the step boundary
 * rather than the page's own load event on purpose: an audit started from a load listener runs
 * beside the next step's clicks, and a step that leaves the page mid-audit destroys the context axe
 * runs in, so whether a page got audited would depend on timing. Between two steps nothing else
 * drives the page. Violations are collected per URL and fail the scenario once, at its end, naming
 * every URL that has them. A URL the scenario passed through inside a single step (a redirect, or a
 * step that clicks through two pages) is listed as `not-audited`, so the gap is visible.
 *
 * What it deliberately does not do:
 *   · audit a scenario that already failed. The page it stopped on is wherever the failure left it,
 *     and a violation list on top of the real error only buries the error;
 *   · audit a URL an explicit whole-page audit step already covered in the same scenario. That step
 *     ran with the threshold its author chose, and it passed (a failed step would have failed the
 *     scenario). Under `every-page` this holds even when the step ran after the tag's own audit;
 *   · with the default `scope: final`, audit any page but the last one.
 */

export type A11yScenarioStatus = 'audited' | 'covered-by-step' | 'skipped';

/** One URL's audit under `a11y.scope: every-page`. */
export interface A11yPageReport {
  url: string;
  status: 'audited' | 'covered-by-step' | 'not-audited';
  reason?: string;
  /** When the page was audited: after the named step, or at the end of the scenario. */
  auditedAfter?: string;
  violations: number;
  blocking: number;
  blockingRules: string[];
  results?: A11yResults;
}

/** What `sdods/a11y-scenario` contains, and what the `a11y` process gate reads back. */
export interface A11yScenarioReport {
  kind: 'a11y-scenario';
  runnerProject: string;
  fingerprint: string;
  retry: number;
  /** The URL the scenario ended on. */
  url: string;
  status: A11yScenarioStatus;
  reason?: string;
  /** Absent in reports written before `a11y.scope` existed, which were all `final`. */
  scope?: A11yConfig['scope'];
  failOn: A11yConfig['failOn'];
  include: string[];
  exclude: string[];
  /** Every violation axe reported, at any impact (summed over `pages` under `every-page`). */
  violations: number;
  /** Violations at or above `failOn`: the ones that fail the scenario. */
  blocking: number;
  blockingRules: string[];
  /** The axe results of the final page (`final` scope only; `every-page` keeps them per page). */
  results?: A11yResults;
  /** Every URL the scenario reached, in order (`every-page` scope only). */
  pages?: A11yPageReport[];
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
  return {
    failOn: a.failOn ?? 'serious',
    include: a.include ?? [],
    exclude: a.exclude ?? [],
    scope: a.scope ?? 'final',
  };
}

/* ── every-page: what the scenario reached and what was audited ─────────── */

interface PageWatch {
  /** URLs the main frame reached, in first-seen order. */
  visited: string[];
  /** Audits by URL. */
  pages: Map<string, A11yPageReport>;
  /** The URL the most recent step's audit covered, when that audit is the page's current state. */
  fresh?: string;
}

const pageWatches = new WeakMap<object, PageWatch>();

function watchOf(scenario: object): PageWatch {
  let watch = pageWatches.get(scenario);
  if (!watch) pageWatches.set(scenario, (watch = { visited: [], pages: new Map() }));
  return watch;
}

const auditable = (url: string) => Boolean(url) && url !== 'about:blank';

/**
 * Under `every-page`, starts listing the URLs the page's main frame reaches, so a URL no step ended
 * on still shows up in the report. A no-op under `final`.
 */
export function watchA11yPages(deps: Pick<A11yScenarioDeps, 'page' | 'config' | 'scenario'>): void {
  if (a11ySettings(deps.config).scope !== 'every-page') return;
  const watch = watchOf(deps.scenario);
  deps.page.on('framenavigated', (frame) => {
    if (frame !== deps.page.mainFrame()) return;
    const url = frame.url();
    if (auditable(url) && !watch.visited.includes(url)) watch.visited.push(url);
  });
}

/** A navigation that replaced the document axe was running in: not a defect of the page. */
const LEFT_THE_PAGE = /execution context was destroyed|frame was detached|navigat/i;

async function auditPage(
  page: Page,
  settings: A11yConfig,
  url: string,
  auditedAfter: string,
): Promise<A11yPageReport> {
  const results = await runAxe(page, { include: settings.include, exclude: settings.exclude });
  assertAxeChecked(results, `on ${url}`);
  const blocking = violationsAtOrAbove(results.violations, parseImpactFloor(settings.failOn));
  return {
    url,
    status: 'audited',
    auditedAfter,
    violations: results.violations.length,
    blocking: blocking.length,
    blockingRules: blocking.map((v) => v.id),
    results,
  };
}

/**
 * Under `every-page`, audits the page after a step when the step left it on a URL not yet audited
 * or covered. Violations are kept for the end of the scenario; a configuration defect (an `include`
 * that matches nothing, an audit that examined nothing) fails the step it follows.
 */
export async function auditAfterStep(
  deps: Pick<A11yScenarioDeps, 'page' | 'config' | 'scenario'> & {
    step: string;
    /** True when the step failed: its page proves nothing, as at the end of a failed scenario. */
    failed?: boolean;
  },
): Promise<A11yPageReport | undefined> {
  const { page, scenario } = deps;
  const settings = a11ySettings(deps.config);
  if (settings.scope !== 'every-page' || deps.failed) return undefined;
  const watch = watchOf(scenario);
  watch.fresh = undefined;
  const before = page.url();
  if (!auditable(before) || watch.pages.has(before)) return undefined;
  if (wasPageAudited(scenario, before)) return covered(watch, before);

  await waitForSettle(page);
  // The page may have redirected while it settled; audit where it is now.
  const url = page.url();
  if (!auditable(url) || watch.pages.has(url)) return undefined;
  if (wasPageAudited(scenario, url)) return covered(watch, url);
  if (!watch.visited.includes(url)) watch.visited.push(url);
  try {
    const report = await auditPage(page, settings, url, deps.step);
    watch.pages.set(url, report);
    watch.fresh = url;
    return report;
  } catch (e) {
    // A client-side redirect after the settle point: the next step boundary, or the end of the
    // scenario, audits wherever it went. This URL is listed as not audited.
    if (e instanceof Error && LEFT_THE_PAGE.test(e.message) && page.url() !== url) return undefined;
    throw e;
  }
}

function covered(watch: PageWatch, url: string): A11yPageReport {
  const report: A11yPageReport = {
    url,
    status: 'covered-by-step',
    reason: 'an explicit whole-page accessibility step already audited this URL in the scenario',
    violations: 0,
    blocking: 0,
    blockingRules: [],
  };
  if (!watch.visited.includes(url)) watch.visited.push(url);
  watch.pages.set(url, report);
  return report;
}

/* ── the end of the scenario ─────────────────────────────────────────────── */

export async function auditScenarioEnd(deps: A11yScenarioDeps): Promise<A11yScenarioReport> {
  const { page, scenario, testInfo } = deps;
  const settings = a11ySettings(deps.config);
  const floor = parseImpactFloor(settings.failOn);
  const url = page.url();
  const everyPage = settings.scope === 'every-page';
  const base = {
    kind: 'a11y-scenario' as const,
    runnerProject: scenario.data.runnerProject,
    fingerprint: scenario.data.fingerprint,
    retry: scenario.data.retry,
    url,
    ...(everyPage ? { scope: settings.scope } : {}),
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
  const watch = everyPage ? watchOf(scenario) : undefined;
  if (!auditable(url) && !watch?.pages.size) {
    throw new SdodsError(
      'RUN_FAILED',
      'This @a11y scenario never navigated anywhere, so there is no page to audit.',
      {
        hint: 'Navigate to the page under test in the scenario, or drop @a11y from a scenario that has no page.',
      },
    );
  }
  if (watch) return auditEveryPageEnd({ ...deps, settings, url, watch, base, write });

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

async function auditEveryPageEnd(
  input: A11yScenarioDeps & {
    settings: A11yConfig;
    url: string;
    watch: PageWatch;
    base: Omit<A11yScenarioReport, 'status'>;
    write: (report: A11yScenarioReport) => Promise<A11yScenarioReport>;
  },
): Promise<A11yScenarioReport> {
  const { page, scenario, settings, url, watch, base, write } = input;
  const floor = parseImpactFloor(settings.failOn);

  // The final page is audited as it stands at the end, as under `final`: the steps after the one
  // that reached it may have changed what is on it. Unless the last step's own audit is that state.
  if (auditable(url) && watch.fresh !== url) {
    if (!watch.visited.includes(url)) watch.visited.push(url);
    if (wasPageAudited(scenario, url)) covered(watch, url);
    else watch.pages.set(url, await auditPage(page, settings, url, 'the end of the scenario'));
  }

  const pages: A11yPageReport[] = watch.visited.map((visited) => {
    const audit = watch.pages.get(visited);
    // An explicit step that audited this URL AFTER the tag did has the last word, as it does under `final`.
    if (audit?.status === 'audited' && wasPageAudited(scenario, visited))
      return {
        url: visited,
        status: 'covered-by-step',
        reason:
          'an explicit whole-page accessibility step audited this URL later in the scenario, with the threshold its author chose',
        violations: 0,
        blocking: 0,
        blockingRules: [],
      };
    return (
      audit ?? {
        url: visited,
        status: 'not-audited',
        reason:
          'the scenario left this URL within the step that reached it, so no step boundary found it',
        violations: 0,
        blocking: 0,
        blockingRules: [],
      }
    );
  });

  const audited = pages.filter((p) => p.status === 'audited');
  const failing = audited.filter((p) => p.blocking > 0);
  const report = await write({
    ...base,
    status: audited.length ? 'audited' : 'covered-by-step',
    ...(audited.length
      ? {}
      : {
          reason: 'explicit whole-page accessibility steps covered every URL the scenario reached',
        }),
    violations: audited.reduce((n, p) => n + p.violations, 0),
    blocking: audited.reduce((n, p) => n + p.blocking, 0),
    blockingRules: [...new Set(failing.flatMap((p) => p.blockingRules))],
    pages,
  });
  if (failing.length) {
    const byUrl = failing
      .map((p) => {
        const blocking = violationsAtOrAbove(p.results?.violations ?? [], floor);
        return `${p.url} — ${p.blocking} of ${p.violations}:\n${describeViolations(blocking)}`;
      })
      .join('\n');
    expect(
      report.blocking,
      `@a11y: ${report.blocking} violation(s) at ${IMPACT_ORDER[floor]} or worse on ${failing.length} of ${audited.length} audited page(s) (a11y.scope is "every-page", a11y.failOn is "${settings.failOn}"):\n${byUrl}`,
    ).toBe(0);
  }
  return report;
}
