import type { Page } from '@playwright/test';
import { attachmentNames, scenarioFiles, type ApiSnapshot } from '@sdods/contracts';
import { writeAndAttachJson } from '../a11y/audit.js';
import { SdodsError } from '../errors.js';
import {
  API_P95_BUDGET_KEY,
  LCP_SETTLE_MS,
  LOAD_WAIT_MS,
  VITAL_KEYS,
  collectRawVitals,
  p95Of,
  perfStore,
  resolvedBudgets,
  toRecording,
  type BudgetConfig,
  type RawVitals,
  type VitalsRecording,
} from '../perf/vitals.js';

/**
 * The budget check an `@perf` tag buys. Before this existed `perf.budgets` was enforced only by
 * explicit steps, `apiP95Ms` only by a sampling step, and the tag itself by nothing.
 *
 * Two halves, because a page has to be watched while the scenario runs and judged after it:
 *
 *   · `watchNavigations` (UI and hybrid, before the scenario) installs an init script in the page.
 *     Every document the main frame loads reports its own vitals through an exposed binding, once
 *     the load event has finished. The document reports itself rather than being read from Node on
 *     a `load` event, because a Node-side read races the next navigation: a step that clicks a link
 *     straight after the load would have its read land in the NEXT document, whose load has not
 *     ended, and report a slow page that does not exist.
 *   · `judgeScenarioPerf` (every layer, after the scenario) compares every recorded navigation with
 *     the page budgets (`pageLoadMs`, `lcpMs`, `fcpMs`, `ttfbMs`), and the p95 of the scenario's live
 *     API response times (plus any latency samples it took) with `apiP95Ms`.
 *
 * The rules are the explicit steps' rules. A vital a budget applies to that did not fire FAILS,
 * naming why. An `@perf` scenario on an environment with no budgets at all FAILS as CONFIG_INVALID.
 * A scenario where no configured budget applied to anything it measured FAILS: it proved nothing.
 * An API call replayed from a HAR is not a measurement of this environment and is not counted.
 *
 * One thing is NOT a failure: a document the scenario left before it could report (a navigation
 * away before the document painted and its LCP window closed). That is not the application being slow; it is
 * listed under `unreported` in the attachment so the gap is visible.
 */

/**
 * How long a document waits, after its load event, for its first contentful paint before reporting.
 * A client-rendered page (SauceDemo's login is one) routinely paints AFTER `load`: reading its
 * vitals at the load event reports FCP and LCP as never having fired on a page that painted a
 * moment later. A page that has not painted after this long reports what it has, and a budget on
 * the missing vital then fails naming why.
 */
export const PAINT_WAIT_MS = LOAD_WAIT_MS;

/**
 * How long the judge waits, at scenario end, for documents that loaded but have not reported: the
 * paint wait plus the LCP settle window, with room for the binding round-trip.
 */
export const REPORT_WAIT_MS = PAINT_WAIT_MS + LCP_SETTLE_MS + 1_000;

/** The binding each document reports through. Namespaced so it cannot collide with the app. */
export const VITALS_BINDING = '__sdodsReportVitals';

interface PerfWatch {
  loads: number;
  recordings: VitalsRecording[];
  notify: (() => void)[];
}

const watches = new WeakMap<object, PerfWatch>();

/**
 * The script every document in the page runs. Only the top-level document reports: after its load
 * event, once it has painted (or `paintWaitMs` has passed), and after the same LCP settle window the
 * explicit `I record the page vitals` step uses, so both measure a page the same way.
 */
export function vitalsInitScript(
  settleMs = LCP_SETTLE_MS,
  paintWaitMs = PAINT_WAIT_MS,
  binding = VITALS_BINDING,
): string {
  return `(() => {
  if (window.top !== window) return;
  const collect = ${collectRawVitals.toString()};
  const painted = () => new Promise((resolve) => {
    if (performance.getEntriesByName('first-contentful-paint').length) return resolve();
    setTimeout(resolve, ${paintWaitMs});
    try {
      new PerformanceObserver((list) => {
        if (list.getEntries().some((e) => e.name === 'first-contentful-paint')) resolve();
      }).observe({ type: 'paint', buffered: true });
    } catch (e) {
      resolve();
    }
  });
  addEventListener('load', () => {
    setTimeout(() => {
      painted()
        .then(() => collect(${settleMs}))
        .then((raw) => {
          const report = window[${JSON.stringify(binding)}];
          if (typeof report === 'function') report(raw);
        }, () => undefined);
    }, 0);
  }, { once: true });
})();`;
}

/**
 * Starts recording the vitals of every document the page's main frame loads. Must run before the
 * scenario's first navigation, which is why the hook that calls it is a `BeforeScenario`.
 */
export async function watchNavigations(deps: {
  page: Page;
  scenario: { data: { browser?: string } };
}): Promise<void> {
  const { page, scenario } = deps;
  const watch: PerfWatch = { loads: 0, recordings: [], notify: [] };
  watches.set(scenario, watch);
  page.on('load', () => {
    watch.loads++;
  });
  await page.exposeBinding(VITALS_BINDING, (source, raw: RawVitals) => {
    if (source.frame !== page.mainFrame()) return;
    watch.recordings.push(toRecording(raw, source.frame.url(), scenario.data.browser));
    for (const fn of watch.notify.splice(0)) fn();
  });
  await page.addInitScript({ content: vitalsInitScript() });
}

async function waitForReports(watch: PerfWatch): Promise<void> {
  const deadline = Date.now() + REPORT_WAIT_MS;
  while (watch.recordings.length < watch.loads && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      watch.notify.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export interface PerfBreach {
  budget: string;
  limitMs: number;
  /** `null` when the value was never measured. */
  measuredMs: number | null;
  where: string;
  message: string;
}

/** What `sdods/perf-scenario` contains, and what the `perfBudgets` process gate reads back. */
export interface PerfScenarioReport {
  kind: 'perf-scenario';
  runnerProject: string;
  fingerprint: string;
  retry: number;
  env: string;
  status: 'judged' | 'skipped';
  reason?: string;
  budgets: Record<string, number>;
  navigations: {
    url: string;
    vitals: VitalsRecording['vitals'];
    unmeasured: VitalsRecording['unmeasured'];
  }[];
  /** Documents that loaded but were left before they could report. Listed, not failed. */
  unreported: number;
  api: { liveCalls: number; replayedFromHar: number; samples: number; p95Ms: number | null };
  /** How many budget comparisons were made. Zero means the scenario proved nothing. */
  judged: number;
  breaches: PerfBreach[];
}

export interface PerfScenarioDeps {
  config: BudgetConfig;
  scenario: {
    data: { runnerProject: string; fingerprint: string; retry: number; layer?: string };
    file(rel: string): string;
  };
  apiContext: { history: readonly ApiSnapshot[] };
  testInfo: {
    status?: string;
    attach(name: string, opts: { path: string; contentType: string }): Promise<void>;
  };
}

/** Pure: every comparison and breach for a set of recordings and API timings. */
export function judgeBudgets(input: {
  budgets: Record<string, number>;
  recordings: readonly VitalsRecording[];
  apiMs: readonly number[];
  apiReplayed: number;
  envName: string;
}): { judged: number; breaches: PerfBreach[]; p95Ms: number | null } {
  const { budgets, recordings, apiMs, apiReplayed, envName } = input;
  const breaches: PerfBreach[] = [];
  let judged = 0;
  for (const recording of recordings) {
    for (const key of VITAL_KEYS) {
      const limit = budgets[key];
      if (limit === undefined) continue;
      judged++;
      const value = recording.vitals[key];
      if (value === null) {
        breaches.push({
          budget: key,
          limitMs: limit,
          measuredMs: null,
          where: recording.url,
          message: `${key} was not measured on ${recording.url} — ${recording.unmeasured[key] ?? 'the page reported no value'}. A budget cannot be met by a vital that never fired.`,
        });
      } else if (value > limit) {
        breaches.push({
          budget: key,
          limitMs: limit,
          measuredMs: value,
          where: recording.url,
          message: `${key} measured ${value} ms on ${recording.url}, against a budget of ${limit} ms for environment "${envName}"`,
        });
      }
    }
  }
  let p95Ms: number | null = null;
  const apiLimit = budgets[API_P95_BUDGET_KEY];
  if (apiLimit !== undefined && apiMs.length > 0) {
    judged++;
    p95Ms = p95Of(apiMs);
    if (p95Ms > apiLimit)
      breaches.push({
        budget: API_P95_BUDGET_KEY,
        limitMs: apiLimit,
        measuredMs: p95Ms,
        where: `${apiMs.length} API call(s)`,
        message: `API p95 was ${p95Ms} ms over ${apiMs.length} call(s), against an ${API_P95_BUDGET_KEY} budget of ${apiLimit} ms for environment "${envName}"`,
      });
  } else if (apiLimit !== undefined && apiReplayed > 0) {
    judged++;
    breaches.push({
      budget: API_P95_BUDGET_KEY,
      limitMs: apiLimit,
      measuredMs: null,
      where: `${apiReplayed} API call(s)`,
      message: `All ${apiReplayed} API call(s) were replayed from a HAR, so their response times are the recording's, not environment "${envName}"'s. Run @perf scenarios without @har or --har-replay.`,
    });
  } else if (apiMs.length > 0) {
    p95Ms = p95Of(apiMs);
  }
  return { judged, breaches, p95Ms };
}

export async function judgeScenarioPerf(deps: PerfScenarioDeps): Promise<PerfScenarioReport> {
  const { config, scenario, apiContext, testInfo } = deps;
  const envName = config.env.name ?? 'unknown';
  const budgets = resolvedBudgets(config);
  const watch = watches.get(scenario);
  if (watch) await waitForReports(watch);
  const recordings = watch?.recordings ?? [];

  const live = apiContext.history.filter((s) => !s.replayedFromHar);
  const samples = perfStore(scenario).sampleSets.flatMap((set) => set.samples.map((s) => s.ms));
  const apiMs = [...live.map((s) => s.response.responseTime), ...samples];
  const apiReplayed = apiContext.history.length - live.length;

  const report: PerfScenarioReport = {
    kind: 'perf-scenario',
    runnerProject: scenario.data.runnerProject,
    fingerprint: scenario.data.fingerprint,
    retry: scenario.data.retry,
    env: envName,
    status: 'judged',
    budgets,
    navigations: recordings.map((r) => ({
      url: r.url,
      vitals: r.vitals,
      unmeasured: r.unmeasured,
    })),
    unreported: watch ? Math.max(0, watch.loads - recordings.length) : 0,
    api: {
      liveCalls: live.length,
      replayedFromHar: apiReplayed,
      samples: samples.length,
      p95Ms: null,
    },
    judged: 0,
    breaches: [],
  };
  const file = scenario.file(scenarioFiles.perfScenarioJson(scenario.data.runnerProject));
  const write = () => writeAndAttachJson(testInfo, attachmentNames.perfScenario, file, report);

  if (testInfo.status && testInfo.status !== 'passed') {
    report.status = 'skipped';
    report.reason = `the scenario ${testInfo.status} before its budgets could be judged`;
    await write();
    return report;
  }

  const verdict = judgeBudgets({ budgets, recordings, apiMs, apiReplayed, envName });
  report.judged = verdict.judged;
  report.breaches = verdict.breaches;
  report.api.p95Ms = verdict.p95Ms;

  if (Object.keys(budgets).length === 0) {
    report.status = 'skipped';
    report.reason = 'no perf budgets are configured';
    await write();
    throw new SdodsError(
      'CONFIG_INVALID',
      `This @perf scenario runs on environment "${envName}", which has no perf budgets configured.`,
      {
        hint: `Set perf.budgets (${[...VITAL_KEYS, API_P95_BUDGET_KEY].join(', ')}) in the project's sdods.project.yaml, or in envs/${envName}.yaml. Without one the @perf tag would pass no matter how slow the application is.`,
      },
    );
  }
  await write();

  if (verdict.judged === 0) {
    const measured = [
      recordings.length ? `${recordings.length} page navigation(s)` : 'no page navigation',
      apiMs.length ? `${apiMs.length} API call(s)` : 'no API call',
    ].join(' and ');
    throw new SdodsError(
      'RUN_FAILED',
      `This @perf scenario measured ${measured}, and none of the configured budgets (${Object.keys(budgets).join(', ')}) applies to that, so it proved nothing.`,
      {
        hint: 'Configure a budget for what the scenario exercises (page vitals for a UI flow, apiP95Ms for API calls), or drop @perf from it.',
      },
    );
  }
  if (verdict.breaches.length) {
    throw new SdodsError(
      'RUN_FAILED',
      `@perf: ${verdict.breaches.length} budget breach(es):\n${verdict.breaches.map((b) => `  ${b.message}`).join('\n')}`,
      { hint: 'The full measurements are attached as sdods/perf-scenario.' },
    );
  }
  return report;
}
