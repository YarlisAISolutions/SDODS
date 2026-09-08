import { writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import './params.js';
import { Then, When } from '../fixtures/test.js';
import type { Page, TestInfo } from '@playwright/test';
import { attachmentNames, pad2, scenarioFiles } from '@sdods/contracts';
import type { EnvConfig, PerformanceMetrics } from '@sdods/contracts';
import type { ApiClient, HttpMethod } from '../api/client.js';
import type { ApiContext } from '../fixtures/api-context.js';
import type { ScenarioMeta } from '../fixtures/scenario.js';
import { render, renderJson } from '../api/template.js';
import { SdodsError } from '../errors.js';

/**
 * Performance budgets.
 *
 * `PerfBudgetsSchema` (pageLoadMs / lcpMs / fcpMs / ttfbMs / apiP95Ms), the `perf.budgets` block in
 * the project and env yaml, the `perfBudgets: true` release gate and `attachmentNames.perf` all
 * existed before this file; nothing read any of them. These steps close that loop.
 *
 * Two rules run through every step here, both learned from hand-written project steps that got
 * them wrong:
 *
 *  1. A BUDGET IS READ FROM CONFIG, NEVER FROM THE FEATURE FILE. A number typed into a `.feature`
 *     is a number that drifts from the environment it runs on — staging and a laptop do not share
 *     a page-load budget. `Then the response time should be under {int} ms` (api.steps.ts) is the
 *     literal-threshold form and stays exactly as it is; the budget-driven forms below are new
 *     patterns, not a widening of it. A local literal is still reachable where a scenario genuinely
 *     needs one — `should be under {int} ms` — so the escape hatch is visible in the step text.
 *  2. AN UNMEASURED VITAL FAILS. LCP does not fire on a page with no contentful paint, and WebKit
 *     does not implement it at all; paint timings and the navigation entry can be missing too.
 *     Recording those as `0` makes every budget assertion pass — a whole perf module
 *     goes green while measuring nothing. So a vital that did not fire is recorded as `null`
 *     together with the reason, and asserting on it FAILS naming that reason. A real navigation
 *     cannot produce a genuine 0 ms vital (they are all offsets from navigation start), so treating
 *     "absent or 0" as "not measured" loses no honest signal.
 *
 * A budget that is not configured is likewise a hard `CONFIG_INVALID` naming the missing key, not
 * a skip: silently skipping is the same vacuous green in a different costume.
 *
 * The two comparison operators are deliberately different and deliberately visible in the step
 * text: `under {int} ms` is strict `<` (matching `the response time should be under {int} ms` in
 * api.steps.ts), `within its configured budget` is `<=` — a budget is a ceiling you may sit on.
 */

/* ── budgets ──────────────────────────────────────────────────────────── */

/** The page vitals SDODS records. Each name is also its key in `perf.budgets`. */
export const VITAL_KEYS = ['pageLoadMs', 'lcpMs', 'fcpMs', 'ttfbMs'] as const;
export type VitalKey = (typeof VITAL_KEYS)[number];

/** The `perf.budgets` key a sampled API latency distribution is judged against. */
export const API_P95_BUDGET_KEY = 'apiP95Ms';

type BudgetLayer = { budgets?: Record<string, number | undefined> } | undefined;

/** The slice of a resolved config these steps read. Nothing here writes config. */
export interface BudgetConfig {
  project: { perf?: BudgetLayer };
  env: { name?: string; perf?: BudgetLayer };
}

/**
 * Effective budgets, env overriding project per key.
 *
 * `resolveConfig` already deep-merges `env.perf` into `config.project.perf`, so on a resolved
 * config the project side is the whole answer. Merging the env side again is idempotent and keeps
 * this correct for a config assembled by hand. Non-numeric values are dropped rather than spread —
 * an explicit `undefined` in the env layer would otherwise erase a real project budget and turn a
 * configured assertion into an unconfigured one.
 */
export function resolvedBudgets(config: BudgetConfig): Record<string, number> {
  const out: Record<string, number> = {};
  for (const layer of [config.project.perf?.budgets, config.env.perf?.budgets]) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
  }
  return out;
}

/**
 * The configured budget for one key, or a hard error naming it.
 *
 * PROVES the assertion that follows is gated on something real. A missing budget must never
 * degrade to a skip or to `Infinity`: an unconfigured budget is the single failure mode that lets
 * an entire perf suite report success while asserting nothing at all.
 */
export function requireBudget(config: BudgetConfig, key: string): number {
  const budget = resolvedBudgets(config)[key];
  const envName = config.env.name ?? 'unknown';
  if (typeof budget !== 'number' || !(budget > 0)) {
    throw new SdodsError(
      'CONFIG_INVALID',
      `Perf budget "${key}" is not configured for environment "${envName}".`,
      {
        hint: `Set perf.budgets.${key} in the project's sdods.project.yaml, or override it in envs/${envName}.yaml. Without it this assertion would pass no matter how slow the application is.`,
      },
    );
  }
  return budget;
}

function requireVitalKey(name: string): VitalKey {
  if ((VITAL_KEYS as readonly string[]).includes(name)) return name as VitalKey;
  throw new SdodsError('CONFIG_INVALID', `"${name}" is not a page vital SDODS records.`, {
    hint: `Known vitals: ${VITAL_KEYS.join(', ')}. Each is also its key in perf.budgets.`,
  });
}

/* ── per-scenario measurement store ───────────────────────────────────── */

/** One `When I record the page vitals`. `null` in `vitals` means NOT MEASURED, never "0 ms". */
export interface VitalsRecording {
  url: string;
  vitals: Record<VitalKey, number | null>;
  /** Why a vital is null, keyed by vital. Surfaced verbatim in the failure message. */
  unmeasured: Partial<Record<VitalKey, string>>;
  /** The contract shape written to `sdods/perf/<step>` and ingested into `steps.perf_json`. */
  metrics: PerformanceMetrics;
}

export interface LatencySample {
  status: number;
  ms: number;
}

export interface LatencySampleSet {
  method: string;
  path: string;
  samples: LatencySample[];
  p95Ms: number;
}

interface PerfStore {
  recordings: VitalsRecording[];
  sampleSets: LatencySampleSet[];
}

/**
 * Measurements have to survive from a `When` step to a `Then` step. They do not go in
 * `apiContext.vars`: that store doubles as a `{{…}}` template scope, so an array of samples parked
 * there would leak into every later rendering. Keyed on the per-test `scenario` object, so two
 * scenarios in parallel workers can never read each other's numbers and nothing outlives the
 * scenario that measured it.
 */
const stores = new WeakMap<object, PerfStore>();

export function perfStore(key: object): PerfStore {
  let store = stores.get(key);
  if (!store) {
    store = { recordings: [], sampleSets: [] };
    stores.set(key, store);
  }
  return store;
}

function lastRecording(key: object): VitalsRecording {
  const recording = perfStore(key).recordings.at(-1);
  if (!recording) {
    throw new SdodsError('RUN_FAILED', 'No page vitals have been recorded in this scenario.', {
      hint: 'Add `When I record the page vitals` after the navigation you want to measure.',
    });
  }
  return recording;
}

function lastSampleSet(key: object): LatencySampleSet {
  const set = perfStore(key).sampleSets.at(-1);
  if (!set) {
    throw new SdodsError('RUN_FAILED', 'No latency samples have been taken in this scenario.', {
      hint: 'Add `When I sample the latency of GET "/path" over 20 requests` before asserting a p95.',
    });
  }
  return set;
}

/* ── statistics ───────────────────────────────────────────────────────── */

/**
 * Nearest-rank p95 — deterministic for a given set of samples, with no interpolation to argue
 * about. Below 20 samples the nearest rank IS the maximum; the sample count travels in the
 * attachment and in every failure message so a reader can see when "p95" means "slowest of five".
 *
 * Throws rather than returning 0 on an empty sample: a p95 of 0 slides under every budget.
 */
export function p95Of(msValues: readonly number[]): number {
  if (msValues.length === 0) {
    throw new SdodsError('RUN_FAILED', 'Cannot compute a p95 over an empty sample.', {
      hint: 'Sample at least one request before asserting a p95.',
    });
  }
  const sorted = [...msValues].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index] as number;
}

/* ── browser-side collection ──────────────────────────────────────────── */

/**
 * How long the LCP observer is given to settle. LCP arrives as a stream of ever-larger candidates;
 * `buffered: true` replays the ones already emitted and this window catches any still in flight.
 * A fixed constant rather than a computed wait, so two runs of one scenario observe the same
 * window and a baseline stays comparable.
 */
const LCP_SETTLE_MS = 500;

/** Bounded wait for the load event before reading `loadEventEnd`. */
const LOAD_WAIT_MS = 5_000;

type BrowserPerfEntry = Record<string, unknown>;
type BrowserPerformance = {
  timeOrigin: number;
  getEntriesByType(type: string): BrowserPerfEntry[];
  getEntriesByName(name: string): BrowserPerfEntry[];
};
type BrowserPerfObserver = {
  observe(options: { type: string; buffered: boolean }): void;
  disconnect(): void;
};
type BrowserPerfObserverCtor = {
  new (callback: (list: { getEntries(): BrowserPerfEntry[] }) => void): BrowserPerfObserver;
  supportedEntryTypes?: readonly string[];
};

/** What the page hands back. Every timing is `number | null`; null always means "did not fire". */
export interface RawVitals {
  hasNavigationEntry: boolean;
  navigationStartEpochMs: number | null;
  pageLoadMs: number | null;
  ttfbMs: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  domContentLoadedMs: number | null;
  totalResources: number;
  totalResourceSizeKB: number;
  lcpSupported: boolean;
  fcpSupported: boolean;
}

/**
 * Runs inside the page. Serialised by Playwright, so it closes over nothing but its argument — the
 * type aliases above are erased at compile time and are safe to reference; the constants are not,
 * which is why the settle window is passed in.
 */
export async function collectRawVitals(settleMs: number): Promise<RawVitals> {
  const perf = performance as unknown as BrowserPerformance;
  const Observer = (globalThis as unknown as { PerformanceObserver?: BrowserPerfObserverCtor })
    .PerformanceObserver;

  // Every vital is an offset from navigation start, so a genuine measurement is always > 0.
  const positive = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

  const supported = Observer?.supportedEntryTypes ?? [];
  const lcpSupported = supported.includes('largest-contentful-paint');
  const fcpSupported = supported.includes('paint');

  // TRAP: paint timings can land AFTER the load event. Reading the paint entry eagerly while only
  // LCP waited for the settle window reported `fcpMs: null` beside a real `lcpMs` on a page that
  // had painted perfectly well — impossible, since first paint always precedes the largest one —
  // and a budget assertion would then have failed it as "not measured". So nothing is read until
  // the window closes, and the window is opened whether or not LCP is supported.
  let largestPaint = 0;
  await new Promise<void>((resolve) => {
    let observer: BrowserPerfObserver | undefined;
    try {
      if (Observer && lcpSupported) {
        observer = new Observer((list) => {
          for (const entry of list.getEntries()) {
            const start = entry.startTime;
            if (typeof start === 'number' && start > largestPaint) largestPaint = start;
          }
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      }
    } catch {
      observer = undefined;
    }
    setTimeout(() => {
      try {
        observer?.disconnect();
      } catch {
        /* already gone */
      }
      resolve();
    }, settleMs);
  });

  const nav = perf.getEntriesByType('navigation')[0];
  const fcpEntry = perf.getEntriesByName('first-contentful-paint')[0];
  const lcpMs = largestPaint > 0 ? Math.round(largestPaint) : null;

  let totalResources = 0;
  let totalBytes = 0;
  for (const entry of perf.getEntriesByType('resource')) {
    totalResources++;
    const size = entry.transferSize;
    if (typeof size === 'number' && Number.isFinite(size)) totalBytes += size;
  }

  const startTime = nav && typeof nav.startTime === 'number' ? nav.startTime : 0;
  return {
    hasNavigationEntry: Boolean(nav),
    navigationStartEpochMs:
      nav && typeof perf.timeOrigin === 'number' ? Math.round(perf.timeOrigin + startTime) : null,
    pageLoadMs: nav ? positive(nav.loadEventEnd) : null,
    ttfbMs: nav ? positive(nav.responseStart) : null,
    fcpMs: fcpEntry ? positive(fcpEntry.startTime) : null,
    lcpMs,
    domContentLoadedMs: nav ? positive(nav.domContentLoadedEventEnd) : null,
    totalResources,
    totalResourceSizeKB: Math.round(totalBytes / 1024),
    lcpSupported,
    fcpSupported,
  };
}

/**
 * Turns the page's answer into a recording, capturing WHY a vital is null while the browser's
 * capabilities are still in hand. By the time a `Then` step fails, "lcpMs was not measured" on its
 * own sends the reader hunting for a bug in a page that is merely running in a browser that does
 * not implement LCP (WebKit). Support is read from `PerformanceObserver.supportedEntryTypes`, never
 * assumed from the browser name.
 */
export function toRecording(raw: RawVitals, url: string, browserName?: string): VitalsRecording {
  const vitals: Record<VitalKey, number | null> = {
    pageLoadMs: raw.pageLoadMs,
    lcpMs: raw.lcpMs,
    fcpMs: raw.fcpMs,
    ttfbMs: raw.ttfbMs,
  };
  const where = browserName ? ` in ${browserName}` : ' in this browser';
  const unmeasured: Partial<Record<VitalKey, string>> = {};
  if (raw.pageLoadMs === null)
    unmeasured.pageLoadMs = `the load event had not fired ${LOAD_WAIT_MS} ms after the vitals step began`;
  if (raw.ttfbMs === null) unmeasured.ttfbMs = 'the navigation entry reported no response start';
  if (raw.fcpMs === null)
    unmeasured.fcpMs = raw.fcpSupported
      ? 'the page painted no contentful frame'
      : `paint timings are not implemented${where}`;
  if (raw.lcpMs === null)
    unmeasured.lcpMs = raw.lcpSupported
      ? 'the page produced no largest-contentful-paint candidate'
      : `largest-contentful-paint is not implemented${where} — restrict the scenario to a browser that supports it`;

  // The contract's three non-nullable fields carry 0 for an unmeasured value; the nullable
  // `budgets.measured` block written alongside is what the assertions read, so a 0 here can never
  // be mistaken for a measurement.
  const metrics: PerformanceMetrics = {
    url,
    timestamp: new Date(raw.navigationStartEpochMs ?? Date.now()).toISOString(),
    domContentLoaded: raw.domContentLoadedMs ?? 0,
    pageLoadTime: raw.pageLoadMs ?? 0,
    timeToFirstByte: raw.ttfbMs ?? 0,
    totalResources: raw.totalResources,
    totalResourceSizeKB: raw.totalResourceSizeKB,
    firstContentfulPaint: raw.fcpMs,
    largestContentfulPaint: raw.lcpMs,
  };
  return { url, vitals, unmeasured, metrics };
}

/** The measured value, or a failure naming why it is absent. Never returns 0-for-absent. */
function measured(recording: VitalsRecording, metric: VitalKey): number {
  const value = recording.vitals[metric];
  expect(
    value,
    `${metric} was not measured on ${recording.url} — ${recording.unmeasured[metric] ?? 'the page reported no value'}. A budget cannot be asserted against a vital that never fired.`,
  ).not.toBeNull();
  return value as number;
}

/* ── recording ────────────────────────────────────────────────────────── */

interface VitalsFixtures {
  page: Page;
  config: BudgetConfig;
  scenario: ScenarioMeta;
  $bddContext: { stepIndex: number };
  $testInfo: TestInfo;
}

/**
 * PROVES that the current navigation produced real page vitals, and pins them to this step so a
 * later assertion has something that can actually fail. Records LCP / FCP / TTFB / load plus the
 * resource count and weight, as the `PerformanceMetrics` contract, under `sdods/perf/<step>` — the
 * name `attachmentNames.perf` has always defined and the DB ingest has always read into
 * `steps.perf_json`, and which nothing had ever written.
 *
 * TRAP: recording before anything navigated. `performance.getEntriesByType('navigation')` is empty
 * on a page that has not loaded a document, so every vital comes back null. That is step misuse
 * rather than a slow application, so it fails here as `RUN_FAILED` naming the fix, instead of as
 * four confusing assertion failures later.
 */
export const recordPageVitals = async ({
  page,
  config,
  scenario,
  $bddContext,
  $testInfo,
}: VitalsFixtures) => {
  // `pageLoadMs` reads `loadEventEnd`, which stays 0 until the load event fires — and the core
  // navigation step settles on `domcontentloaded`. So wait, but briefly and never fatally: a page
  // that never fires load leaves pageLoadMs null, which lets a scenario asserting only on TTFB run
  // and makes a scenario asserting on pageLoadMs fail with the reason rather than the symptom.
  await page.waitForLoadState('load', { timeout: LOAD_WAIT_MS }).catch(() => undefined);

  const raw = await page.evaluate(collectRawVitals, LCP_SETTLE_MS);
  if (!raw.hasNavigationEntry) {
    throw new SdodsError(
      'RUN_FAILED',
      `No navigation timing on ${page.url()} — nothing has been navigated to in this scenario.`,
      {
        hint: 'Record the vitals AFTER the navigation you want to measure (for example `Given I navigate to the "home" page`).',
      },
    );
  }

  const recording = toRecording(raw, page.url(), scenario.data.browser);
  perfStore(scenario).recordings.push(recording);

  const file = scenario.file(scenarioFiles.perfJson($bddContext.stepIndex));
  writeFileSync(
    file,
    JSON.stringify(
      {
        ...recording.metrics,
        // Budget-facing view. The keys are exactly the `perf.budgets` keys, `null` means NOT
        // MEASURED, and the configured ceilings travel alongside so the artefact reads on its own —
        // nobody has to go and find the yaml to know what failed and against what.
        budgets: {
          measured: recording.vitals,
          unmeasured: recording.unmeasured,
          configured: resolvedBudgets(config),
        },
      },
      null,
      2,
    ),
  );
  await $testInfo.attach(attachmentNames.perf($bddContext.stepIndex), {
    path: file,
    contentType: 'application/json',
  });
};

When('I record the page vitals', recordPageVitals);

/* ── vital assertions ─────────────────────────────────────────────────── */

interface AssertFixtures {
  scenario: ScenarioMeta;
  config: BudgetConfig;
  apiContext: ApiContext;
  env: EnvConfig;
}

/**
 * PROVES a recorded vital sits inside the ceiling THIS environment declares. The budget is read
 * from `perf.budgets` and is never a step argument: a threshold written into a feature file ships
 * unchanged to every environment, which is exactly what a per-environment budget exists to prevent.
 *
 * Ordered so the cheapest fix surfaces first: forgot the recording → typo'd the vital name →
 * budget missing from config → vital never fired → the comparison itself.
 */
export const assertVitalWithinBudget = async (
  { scenario, config, apiContext, env }: AssertFixtures,
  metricName: string,
) => {
  const recording = lastRecording(scenario);
  const metric = requireVitalKey(render(metricName, apiContext.vars.toObject(), env.vars));
  const budget = requireBudget(config, metric);
  const value = measured(recording, metric);
  expect(
    value,
    `${metric} measured ${value} ms on ${recording.url}, against a budget of ${budget} ms for environment "${config.env.name ?? 'unknown'}"`,
  ).toBeLessThanOrEqual(budget);
};

Then('the recorded {string} should be within its configured budget', assertVitalWithinBudget);

/**
 * PROVES a recorded vital sits under a limit this scenario owns. The visible escape hatch from the
 * configured budget, for a page whose limit the environment-wide budget cannot express. Strictly
 * `<`, matching `the response time should be under {int} ms`.
 */
export const assertVitalUnderThreshold = async (
  { scenario, apiContext, env }: AssertFixtures,
  metricName: string,
  maxMs: number,
) => {
  const recording = lastRecording(scenario);
  const metric = requireVitalKey(render(metricName, apiContext.vars.toObject(), env.vars));
  const value = measured(recording, metric);
  expect(
    value,
    `${metric} measured ${value} ms on ${recording.url}, against a scenario-local limit of ${maxMs} ms`,
  ).toBeLessThan(maxMs);
};

Then('the recorded {string} should be under {int} ms', assertVitalUnderThreshold);

/**
 * PROVES a second navigation is not slower than the first — the caching / warm-path claim.
 * Compares the last two recordings of one vital, so a scenario records, acts, and records again.
 *
 * Carries an explicit tolerance because both sides are live measurements: the zero-tolerance form
 * (`plus 0 ms`) is available, but it is the author's decision in the feature file rather than a
 * hidden fudge factor here. Fails outright with fewer than two recordings, because comparing a
 * recording with itself always passes.
 */
export const assertVitalNoWorseThanPrevious = async (
  { scenario, apiContext, env }: AssertFixtures,
  metricName: string,
  toleranceMs: number,
) => {
  const metric = requireVitalKey(render(metricName, apiContext.vars.toObject(), env.vars));
  const recordings = perfStore(scenario).recordings;
  if (recordings.length < 2) {
    throw new SdodsError(
      'RUN_FAILED',
      `Only ${recordings.length} page-vitals recording(s) in this scenario; comparing needs two.`,
      {
        hint: 'Record the vitals once, do the thing that should be faster, then record them again.',
      },
    );
  }
  const previous = measured(recordings[recordings.length - 2] as VitalsRecording, metric);
  const latest = measured(recordings[recordings.length - 1] as VitalsRecording, metric);
  expect(
    latest,
    `${metric} went from ${previous} ms to ${latest} ms, beyond the ${toleranceMs} ms tolerance — the second pass did more work than the first`,
  ).toBeLessThanOrEqual(previous + toleranceMs);
};

Then(
  'the recorded {string} should be no worse than the previous recording plus {int} ms',
  assertVitalNoWorseThanPrevious,
);

/**
 * PROVES the budgets a perf suite depends on actually exist for the environment being run.
 *
 * This step guards the other steps. A missing or partial `perf.budgets` block is invisible
 * everywhere else in a run: the release gate reads `perfBudgets: true`, the suite goes green, and
 * nobody learns the ceiling was never set. Put this in the first scenario of a perf module and the
 * gap fails loudly, once, naming the key.
 */
export const assertBudgetsConfigured = async (
  { config, apiContext, env }: AssertFixtures,
  names: string,
) => {
  const wanted = render(names, apiContext.vars.toObject(), env.vars)
    .split(/[,\s]+/)
    .filter(Boolean);
  if (wanted.length === 0) {
    throw new SdodsError('CONFIG_INVALID', 'No budget names were given to check.', {
      hint: `Name the budgets the suite depends on, for example "pageLoadMs, lcpMs, ${API_P95_BUDGET_KEY}".`,
    });
  }
  for (const key of wanted) requireBudget(config, key);
};

Then('the perf budgets {string} should be configured', assertBudgetsConfigured);

/* ── API latency sampling ─────────────────────────────────────────────── */

interface SampleFixtures {
  api: ApiClient;
  apiContext: ApiContext;
  env: EnvConfig;
  scenario: ScenarioMeta;
  $bddContext: { stepIndex: number };
  $testInfo: TestInfo;
}

/**
 * Sequential, deliberately. Firing N requests in parallel measures how the server behaves under a
 * burst of N, which is a different question from how long one request takes; a p95 built that way
 * moves with the sample size and is not comparable between runs.
 *
 * Goes through `api.send` rather than a raw fetch, so every sample inherits the env base URL, the
 * env and scenario headers, the query parameters and the auth — whatever authenticated the
 * scenario authenticates the sample. Two options are pinned:
 *   · `silent: true` — samples stay out of `apiContext.history`, so `Then the response status
 *     should be …` still refers to the request the scenario actually made, and twenty samples do
 *     not produce forty attachments.
 *   · `retries: 0`   — the client retries once on CI by default. A retried sample would time the
 *     second attempt and quietly swallow the first failure, which is the opposite of measuring.
 */
async function collectSamples(
  fx: SampleFixtures,
  method: HttpMethod,
  pathTemplate: string,
  times: number,
  bodyTemplate?: string,
): Promise<LatencySampleSet> {
  if (!Number.isInteger(times) || times < 1) {
    throw new SdodsError('RUN_FAILED', `Cannot sample a latency distribution ${times} times.`, {
      hint: 'Sample at least once. Below 20 requests the nearest-rank p95 is simply the slowest sample.',
    });
  }
  const scopes = [fx.apiContext.vars.toObject(), fx.env.vars];
  const path = render(pathTemplate, ...scopes);
  const body = bodyTemplate === undefined ? undefined : renderJson(bodyTemplate, ...scopes);

  const samples: LatencySample[] = [];
  for (let i = 0; i < times; i++) {
    const snapshot = await fx.api.send(method, path, { body, silent: true, retries: 0 });
    // TRAP: `silent` suppresses recording but NOT HAR replay, so under `--har-replay` every sample
    // would return the response time baked into the recording. A p95 over a HAR file measures the
    // file. This is reachable exactly where it matters — `release:check` runs `--har-replay
    // --strict` and the release gate declares `perfBudgets: true` — so it fails loudly instead.
    if (snapshot.replayedFromHar) {
      throw new SdodsError(
        'NOT_SUPPORTED',
        `${method} ${path} was replayed from a HAR, so its ${snapshot.response.responseTime} ms is the recording's, not this environment's.`,
        {
          hint: 'Take latency samples against a live environment: drop @har from the scenario, or run it without --har-replay.',
        },
      );
    }
    samples.push({ status: snapshot.response.status, ms: snapshot.response.responseTime });
  }

  const set: LatencySampleSet = {
    method,
    path,
    samples,
    p95Ms: p95Of(samples.map((s) => s.ms)),
  };
  perfStore(fx.scenario).sampleSets.push(set);

  // Not `attachmentNames.perf`: that name is typed as `PerformanceMetrics` all the way into
  // `steps.perf_json`, and a latency distribution is a different shape. This lands as a plain
  // attachment until the shared contract grows a name for it.
  const stepIndex = fx.$bddContext.stepIndex;
  const file = fx.scenario.file(`perf/${pad2(stepIndex)}-latency-sample.json`);
  const durations = samples.map((s) => s.ms);
  writeFileSync(
    file,
    JSON.stringify(
      {
        method,
        path,
        count: samples.length,
        p95Ms: set.p95Ms,
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
        statuses: samples.map((s) => s.status),
        samples,
      },
      null,
      2,
    ),
  );
  await fx.$testInfo.attach(`sdods/perf-sample/${pad2(stepIndex)}`, {
    path: file,
    contentType: 'application/json',
  });
  return set;
}

/**
 * PROVES an endpoint's latency DISTRIBUTION rather than one lucky request. `the response time
 * should be under {int} ms` (api.steps.ts) times a single call — the measurement most likely to be
 * a cold start or a cache hit. A p95 needs a sample, and SDODS had no way to take one.
 */
export const sampleLatency = async (
  { api, apiContext, env, scenario, $bddContext, $testInfo }: SampleFixtures,
  method: HttpMethod,
  path: string,
  times: number,
) => {
  await collectSamples(
    { api, apiContext, env, scenario, $bddContext, $testInfo },
    method,
    path,
    times,
  );
};

When('I sample the latency of {method} {string} over {int} requests', sampleLatency);

/** PROVES the same for a write path, where the latency that matters belongs to a real payload. */
export const sampleLatencyWithBody = async (
  { api, apiContext, env, scenario, $bddContext, $testInfo }: SampleFixtures,
  method: HttpMethod,
  path: string,
  times: number,
  body: string,
) => {
  await collectSamples(
    { api, apiContext, env, scenario, $bddContext, $testInfo },
    method,
    path,
    times,
    body,
  );
};

When(
  'I sample the latency of {method} {string} over {int} requests with body:',
  sampleLatencyWithBody,
);

/**
 * PROVES the sampled p95 sits inside the environment's `apiP95Ms` ceiling. The budget key is fixed
 * and read from config — nothing to mistype in the feature file, nothing to drift.
 *
 * Says nothing about whether the responses were correct: a p95 over twenty fast 500s passes this,
 * and should. Pair it with `every latency sample should have returned status 200`, which is the
 * step that proves the server was doing the work being timed.
 */
export const assertP95WithinBudget = async ({
  scenario,
  config,
}: {
  scenario: ScenarioMeta;
  config: BudgetConfig;
}) => {
  const set = lastSampleSet(scenario);
  const budget = requireBudget(config, API_P95_BUDGET_KEY);
  expect(
    set.p95Ms,
    `p95 was ${set.p95Ms} ms over ${set.samples.length} samples of ${set.method} ${set.path}, against an ${API_P95_BUDGET_KEY} budget of ${budget} ms for environment "${config.env.name ?? 'unknown'}"`,
  ).toBeLessThanOrEqual(budget);
};

Then('the sampled p95 should be within the configured apiP95Ms budget', assertP95WithinBudget);

/** PROVES the sampled p95 sits under a limit this scenario owns. Strictly `<`, as with the vitals. */
export const assertP95UnderThreshold = async (
  { scenario }: { scenario: ScenarioMeta },
  maxMs: number,
) => {
  const set = lastSampleSet(scenario);
  expect(
    set.p95Ms,
    `p95 was ${set.p95Ms} ms over ${set.samples.length} samples of ${set.method} ${set.path}, against a scenario-local limit of ${maxMs} ms`,
  ).toBeLessThan(maxMs);
};

Then('the sampled p95 should be under {int} ms', assertP95UnderThreshold);

/**
 * PROVES that whatever changed between two samples did not make the endpoint slower — a warmed
 * cache, a new index, a refusal being cheaper to serve than a response. Compares the last two
 * sample sets in this scenario; fails outright with only one, because comparing a sample with
 * itself always passes.
 */
export const assertP95NoWorseThanPrevious = async (
  { scenario }: { scenario: ScenarioMeta },
  toleranceMs: number,
) => {
  const sets = perfStore(scenario).sampleSets;
  if (sets.length < 2) {
    throw new SdodsError(
      'RUN_FAILED',
      `Only ${sets.length} latency sample(s) in this scenario; comparing needs two.`,
      { hint: 'Sample once, change the condition under test, then sample again.' },
    );
  }
  const previous = (sets[sets.length - 2] as LatencySampleSet).p95Ms;
  const latest = (sets[sets.length - 1] as LatencySampleSet).p95Ms;
  expect(
    latest,
    `p95 went from ${previous} ms to ${latest} ms over ${(sets[sets.length - 1] as LatencySampleSet).samples.length} samples, beyond the ${toleranceMs} ms tolerance`,
  ).toBeLessThanOrEqual(previous + toleranceMs);
};

Then(
  'the sampled p95 should be no worse than the previous sample plus {int} ms',
  assertP95NoWorseThanPrevious,
);

/**
 * PROVES the timed responses were the ones the scenario meant to time. Without it a latency budget
 * is happily met by an endpoint that 500s in 3 ms, or that 401s because the sample lost the
 * scenario's auth. Lists the offending statuses, because "not all 200" sends nobody anywhere.
 */
export const assertEverySampleStatus = async (
  { scenario }: { scenario: ScenarioMeta },
  status: number,
) => {
  const set = lastSampleSet(scenario);
  const wrong = set.samples.map((s) => s.status).filter((s) => s !== status);
  expect(
    wrong,
    `${wrong.length} of ${set.samples.length} samples of ${set.method} ${set.path} did not return ${status} (got ${JSON.stringify([...new Set(wrong)])})`,
  ).toHaveLength(0);
};

Then('every latency sample should have returned status {int}', assertEverySampleStatus);
