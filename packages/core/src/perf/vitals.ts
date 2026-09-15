import type { PerformanceMetrics } from '@sdods/contracts';
import { SdodsError } from '../errors.js';

/**
 * Page vitals, latency percentiles and the budgets they are judged against, shared by the explicit
 * perf steps (`steps/perf.steps.ts`) and the end-of-scenario check every `@perf` scenario gets
 * (`quality/hooks.ts`). Outside the step file for the reason `a11y/audit.ts` gives: importing a step
 * file registers its phrases, and `steps.core.exclude: [perf]` must stay able to switch them off.
 * The rules these functions keep are written up at the top of `steps/perf.steps.ts`.
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

export function requireVitalKey(name: string): VitalKey {
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

export function lastRecording(key: object): VitalsRecording {
  const recording = perfStore(key).recordings.at(-1);
  if (!recording) {
    throw new SdodsError('RUN_FAILED', 'No page vitals have been recorded in this scenario.', {
      hint: 'Add `When I record the page vitals` after the navigation you want to measure.',
    });
  }
  return recording;
}

export function lastSampleSet(key: object): LatencySampleSet {
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
export const LCP_SETTLE_MS = 500;

/** Bounded wait for the load event before reading `loadEventEnd`. */
export const LOAD_WAIT_MS = 5_000;

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
