import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiContext } from '../src/fixtures/api-context.js';
import { isSdodsError } from '../src/errors.js';
import {
  API_P95_BUDGET_KEY,
  assertBudgetsConfigured,
  assertEverySampleStatus,
  assertP95NoWorseThanPrevious,
  assertP95UnderThreshold,
  assertP95WithinBudget,
  assertVitalNoWorseThanPrevious,
  assertVitalUnderThreshold,
  assertVitalWithinBudget,
  collectRawVitals,
  p95Of,
  perfStore,
  recordPageVitals,
  requireBudget,
  resolvedBudgets,
  sampleLatency,
  sampleLatencyWithBody,
  toRecording,
  VITAL_KEYS,
  type RawVitals,
} from '../src/steps/perf.steps.js';

/**
 * These steps exist to make a perf suite capable of failing. Every hard case below is therefore a
 * NEGATIVE proof: an unmeasured vital, an unconfigured budget, an empty sample, a comparison with
 * nothing to compare against. A perf library that cannot go red is the thing being prevented, so a
 * test that only shows the happy path would be testing the wrong half.
 */

/* ── doubles ──────────────────────────────────────────────────────────── */

function config(
  projectBudgets: Record<string, number | undefined> = {},
  envBudgets?: Record<string, number | undefined>,
  name = 'staging',
) {
  return {
    project: { perf: { budgets: projectBudgets } },
    env: { name, perf: envBudgets ? { budgets: envBudgets } : undefined, vars: {} },
  };
}

/** A `scenario` double: the WeakMap key for the measurement store, and the artefact writer. */
function scenarioDouble() {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-perf-'));
  return {
    data: { browser: 'chromium' as const },
    file: (rel: string) => {
      const target = join(dir, rel);
      mkdirSync(join(target, '..'), { recursive: true });
      return target;
    },
    dir,
  };
}

function testInfoDouble() {
  const attached: Array<{ name: string; path: string; contentType: string }> = [];
  return {
    attached,
    attach: async (name: string, options: { path: string; contentType: string }) => {
      attached.push({ name, ...options });
    },
  };
}

const FULL_RAW: RawVitals = {
  hasNavigationEntry: true,
  navigationStartEpochMs: Date.parse('2026-01-02T03:04:05.000Z'),
  pageLoadMs: 1200,
  ttfbMs: 180,
  fcpMs: 640,
  lcpMs: 900,
  domContentLoadedMs: 800,
  totalResources: 12,
  totalResourceSizeKB: 340,
  lcpSupported: true,
  fcpSupported: true,
};

function pageDouble(
  raw: RawVitals,
  url = 'https://shop.example.com/cart',
  opts: { loadNeverFires?: boolean } = {},
) {
  const loadWaits: Array<{ state: string; timeout?: number }> = [];
  return {
    url: () => url,
    waitForLoadState: async (state: string, options?: { timeout?: number }) => {
      loadWaits.push({ state, timeout: options?.timeout });
      // Playwright rejects on timeout; the step must survive that, not abort on it.
      if (opts.loadNeverFires) throw new Error('Timeout 5000ms exceeded waiting for load');
    },
    // The real step passes the browser-side collector; the double answers with fixed numbers so
    // the assertions under test are the subject, not the Performance API.
    evaluate: async () => raw,
    loadWaits,
  };
}

interface SentCall {
  method: string;
  path: string;
  opts: { body?: unknown; silent?: boolean; retries?: number } | undefined;
}

/** An `api` double that answers with a scripted latency/status per call. */
function apiDouble(
  plan: Array<{ ms: number; status?: number }>,
  opts_: { replayedFromHar?: boolean } = {},
) {
  const sent: SentCall[] = [];
  return {
    sent,
    send: async (
      method: string,
      path: string,
      opts?: { body?: unknown; silent?: boolean; retries?: number },
    ) => {
      const next = plan[sent.length] ?? plan[plan.length - 1] ?? { ms: 1, status: 200 };
      sent.push({ method, path, opts });
      return {
        response: { status: next.status ?? 200, responseTime: next.ms },
        replayedFromHar: opts_.replayedFromHar,
      };
    },
  };
}

/** The step bodies take real Playwright fixtures; the doubles above are the slice each one reads. */
const asFixtures = (o: unknown) => o as any;

async function caught(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the step to fail, but it passed — the assertion is vacuous');
}

/* ── budgets ──────────────────────────────────────────────────────────── */

describe('perf budgets', () => {
  it('lets the env override the project per key and leaves the others alone', () => {
    expect(
      resolvedBudgets(config({ pageLoadMs: 4000, lcpMs: 3000 }, { pageLoadMs: 8000 })),
    ).toEqual({ pageLoadMs: 8000, lcpMs: 3000 });
  });

  it('does not let an undefined env value erase a real project budget', () => {
    // A cleared key would silently turn a gated assertion into an ungated one.
    expect(resolvedBudgets(config({ lcpMs: 3000 }, { lcpMs: undefined }))).toEqual({ lcpMs: 3000 });
  });

  it('refuses a missing budget with a config error naming the key and the yaml path', async () => {
    const error = await caught(async () => requireBudget(config({ lcpMs: 3000 }), 'ttfbMs'));
    expect(isSdodsError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    expect(error.message).toContain('ttfbMs');
    expect(error.message).toContain('staging');
    expect((error as { hint?: string }).hint).toContain('perf.budgets.ttfbMs');
  });

  it('refuses a zero or negative budget rather than treating it as configured', async () => {
    for (const value of [0, -1]) {
      const error = await caught(async () => requireBudget(config({ ttfbMs: value }), 'ttfbMs'));
      expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    }
  });
});

describe('p95Of', () => {
  it('is the nearest-rank 95th percentile', () => {
    // 20 samples → index ceil(19)-1 = 18 → the 19th slowest.
    const twenty = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(p95Of(twenty)).toBe(190);
    // Unsorted input must not change the answer.
    expect(p95Of([...twenty].reverse())).toBe(190);
  });

  it('is the maximum below 20 samples, and says so through the count in the artefact', () => {
    expect(p95Of([5, 1, 9, 3])).toBe(9);
  });

  it('refuses an empty sample instead of returning a 0 that slides under every budget', async () => {
    const error = await caught(async () => p95Of([]));
    expect(error.message).toContain('empty sample');
  });
});

/* ── recording ────────────────────────────────────────────────────────── */

describe('When I record the page vitals', () => {
  it('records every vital and attaches the PerformanceMetrics contract under sdods/perf/NN', async () => {
    const scenario = scenarioDouble();
    const $testInfo = testInfoDouble();
    await recordPageVitals(
      asFixtures({
        page: pageDouble(FULL_RAW),
        config: config({ pageLoadMs: 4000 }),
        scenario,
        $bddContext: { stepIndex: 3 },
        $testInfo,
      }),
    );

    const recording = perfStore(scenario).recordings[0]!;
    expect(recording.vitals).toEqual({ pageLoadMs: 1200, lcpMs: 900, fcpMs: 640, ttfbMs: 180 });
    expect(recording.unmeasured).toEqual({});

    expect($testInfo.attached).toHaveLength(1);
    expect($testInfo.attached[0]!.name).toBe('sdods/perf/03');
    expect($testInfo.attached[0]!.contentType).toBe('application/json');

    const written = JSON.parse(readFileSync($testInfo.attached[0]!.path, 'utf8'));
    // The contract shape the DB ingest reads into steps.perf_json.
    expect(written.url).toBe('https://shop.example.com/cart');
    expect(written.timestamp).toBe('2026-01-02T03:04:05.000Z');
    expect(written.pageLoadTime).toBe(1200);
    expect(written.timeToFirstByte).toBe(180);
    expect(written.domContentLoaded).toBe(800);
    expect(written.firstContentfulPaint).toBe(640);
    expect(written.largestContentfulPaint).toBe(900);
    expect(written.totalResources).toBe(12);
    expect(written.totalResourceSizeKB).toBe(340);
    // …and the budget-facing view alongside it.
    expect(written.budgets.measured.lcpMs).toBe(900);
    expect(written.budgets.configured).toEqual({ pageLoadMs: 4000 });
  });

  it('waits for the load event first, bounded — loadEventEnd is 0 until it fires', async () => {
    // The core navigation step settles on domcontentloaded, so without this wait pageLoadMs would
    // be "not measured" on a page that is merely still loading.
    const page = pageDouble(FULL_RAW);
    await recordPageVitals(
      asFixtures({
        page,
        config: config(),
        scenario: scenarioDouble(),
        $bddContext: { stepIndex: 0 },
        $testInfo: testInfoDouble(),
      }),
    );
    expect(page.loadWaits).toEqual([{ state: 'load', timeout: 5000 }]);
  });

  it('survives a load event that never fires, and blames it on the vital that needed it', async () => {
    // Not fatal: a scenario asserting only on TTFB must still run. But pageLoadMs is null, so a
    // scenario asserting on it fails naming the cause rather than comparing a 0 against the budget.
    const scenario = scenarioDouble();
    await recordPageVitals(
      asFixtures({
        page: pageDouble({ ...FULL_RAW, pageLoadMs: null }, 'https://shop.example.com/', {
          loadNeverFires: true,
        }),
        config: config(),
        scenario,
        $bddContext: { stepIndex: 0 },
        $testInfo: testInfoDouble(),
      }),
    );
    expect(perfStore(scenario).recordings[0]!.vitals.ttfbMs).toBe(180);
    const error = await caught(() =>
      assertVitalWithinBudget(
        asFixtures({
          scenario,
          config: config({ pageLoadMs: 4000 }),
          apiContext: new ApiContext(),
          env: { vars: {} },
        }),
        'pageLoadMs',
      ),
    );
    expect(error.message).toContain('pageLoadMs was not measured');
    expect(error.message).toContain('load event had not fired');
  });

  it('fails when nothing has navigated, rather than recording four nulls', async () => {
    const error = await caught(() =>
      recordPageVitals(
        asFixtures({
          page: pageDouble({ ...FULL_RAW, hasNavigationEntry: false }, 'about:blank'),
          config: config(),
          scenario: scenarioDouble(),
          $bddContext: { stepIndex: 0 },
          $testInfo: testInfoDouble(),
        }),
      ),
    );
    expect((error as { code: string }).code).toBe('RUN_FAILED');
    expect(error.message).toContain('about:blank');
  });

  it('keeps every recording, so two navigations can be compared', async () => {
    const scenario = scenarioDouble();
    for (const [index, pageLoadMs] of [1200, 700].entries()) {
      await recordPageVitals(
        asFixtures({
          page: pageDouble({ ...FULL_RAW, pageLoadMs }),
          config: config(),
          scenario,
          $bddContext: { stepIndex: index },
          $testInfo: testInfoDouble(),
        }),
      );
    }
    expect(perfStore(scenario).recordings.map((r) => r.vitals.pageLoadMs)).toEqual([1200, 700]);
  });
});

describe('toRecording', () => {
  it('records an absent vital as null and names WHY, per vital', () => {
    const recording = toRecording(
      {
        ...FULL_RAW,
        lcpMs: null,
        lcpSupported: false,
        fcpMs: null,
        fcpSupported: true,
        pageLoadMs: null,
      },
      'https://shop.example.com/',
      'webkit',
    );
    expect(recording.vitals.lcpMs).toBeNull();
    expect(recording.unmeasured.lcpMs).toContain('not implemented in webkit');
    expect(recording.unmeasured.fcpMs).toContain('no contentful frame');
    expect(recording.unmeasured.pageLoadMs).toContain('load event');
    // The contract's non-nullable fields carry 0; the nullable view is what assertions read.
    expect(recording.metrics.pageLoadTime).toBe(0);
    expect(recording.metrics.largestContentfulPaint).toBeNull();
  });
});

/* ── vital assertions ─────────────────────────────────────────────────── */

async function recorded(raw: Partial<RawVitals> = {}) {
  const scenario = scenarioDouble();
  await recordPageVitals(
    asFixtures({
      page: pageDouble({ ...FULL_RAW, ...raw }),
      config: config(),
      scenario,
      $bddContext: { stepIndex: 0 },
      $testInfo: testInfoDouble(),
    }),
  );
  return scenario;
}

describe('Then the recorded {string} should be within its configured budget', () => {
  const apiContext = () => new ApiContext();
  const env = { vars: {} };

  it('passes on the budget and fails over it', async () => {
    const scenario = await recorded({ lcpMs: 900 });
    await assertVitalWithinBudget(
      asFixtures({ scenario, config: config({ lcpMs: 900 }), apiContext: apiContext(), env }),
      'lcpMs',
    );
    const error = await caught(() =>
      assertVitalWithinBudget(
        asFixtures({ scenario, config: config({ lcpMs: 899 }), apiContext: apiContext(), env }),
        'lcpMs',
      ),
    );
    expect(error.message).toContain('900 ms');
    expect(error.message).toContain('899 ms');
  });

  it('FAILS when the vital never fired, instead of comparing 0 against the budget', async () => {
    // The defect this whole file exists to prevent: LCP does not fire outside Chromium, and a 0
    // would sit under every budget for ever.
    const scenario = await recorded({ lcpMs: null, lcpSupported: false });
    const error = await caught(() =>
      assertVitalWithinBudget(
        asFixtures({ scenario, config: config({ lcpMs: 3000 }), apiContext: apiContext(), env }),
        'lcpMs',
      ),
    );
    expect(error.message).toContain('lcpMs was not measured');
    expect(error.message).toContain('not implemented in chromium');
  });

  it('refuses an unconfigured budget before it looks at the measurement', async () => {
    const scenario = await recorded();
    const error = await caught(() =>
      assertVitalWithinBudget(
        asFixtures({
          scenario,
          config: config({ pageLoadMs: 4000 }),
          apiContext: apiContext(),
          env,
        }),
        'ttfbMs',
      ),
    );
    expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    expect(error.message).toContain('ttfbMs');
  });

  it('refuses a vital name SDODS does not record', async () => {
    const scenario = await recorded();
    const error = await caught(() =>
      assertVitalWithinBudget(
        asFixtures({ scenario, config: config({ clsScore: 1 }), apiContext: apiContext(), env }),
        'clsScore',
      ),
    );
    expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    expect((error as { hint?: string }).hint).toContain(VITAL_KEYS.join(', '));
  });

  it('is step misuse, not a pass, when nothing was recorded first', async () => {
    const error = await caught(() =>
      assertVitalWithinBudget(
        asFixtures({
          scenario: scenarioDouble(),
          config: config({ lcpMs: 3000 }),
          apiContext: apiContext(),
          env,
        }),
        'lcpMs',
      ),
    );
    expect((error as { code: string }).code).toBe('RUN_FAILED');
    expect((error as { hint?: string }).hint).toContain('I record the page vitals');
  });

  it('interpolates the metric name through the scenario variables', async () => {
    const scenario = await recorded({ ttfbMs: 100 });
    const ctx = apiContext();
    ctx.vars.set('vital', 'ttfbMs');
    await assertVitalWithinBudget(
      asFixtures({ scenario, config: config({ ttfbMs: 200 }), apiContext: ctx, env }),
      '{{vital}}',
    );
  });
});

describe('Then the recorded {string} should be under {int} ms', () => {
  const fixtures = (scenario: object) => ({
    scenario,
    apiContext: new ApiContext(),
    env: { vars: {} },
  });

  it('is strictly under — a measurement equal to the limit fails', async () => {
    const scenario = await recorded({ ttfbMs: 200 });
    await assertVitalUnderThreshold(asFixtures(fixtures(scenario)), 'ttfbMs', 201);
    const error = await caught(() =>
      assertVitalUnderThreshold(asFixtures(fixtures(scenario)), 'ttfbMs', 200),
    );
    expect(error.message).toContain('scenario-local limit of 200 ms');
  });

  it('still fails on a vital that never fired', async () => {
    const scenario = await recorded({ fcpMs: null, fcpSupported: true });
    const error = await caught(() =>
      assertVitalUnderThreshold(asFixtures(fixtures(scenario)), 'fcpMs', 10_000),
    );
    expect(error.message).toContain('fcpMs was not measured');
  });
});

describe('Then the recorded {string} should be no worse than the previous recording plus {int} ms', () => {
  const fixtures = (scenario: object) => ({
    scenario,
    apiContext: new ApiContext(),
    env: { vars: {} },
  });

  async function twoRecordings(first: number, second: number) {
    const scenario = scenarioDouble();
    for (const [index, pageLoadMs] of [first, second].entries()) {
      await recordPageVitals(
        asFixtures({
          page: pageDouble({ ...FULL_RAW, pageLoadMs }),
          config: config(),
          scenario,
          $bddContext: { stepIndex: index },
          $testInfo: testInfoDouble(),
        }),
      );
    }
    return scenario;
  }

  it('passes when the reload is faster and fails when it is slower than the tolerance', async () => {
    await assertVitalNoWorseThanPrevious(
      asFixtures(fixtures(await twoRecordings(1200, 700))),
      'pageLoadMs',
      0,
    );
    const slower = fixtures(await twoRecordings(1000, 1300));
    const error = await caught(() =>
      assertVitalNoWorseThanPrevious(asFixtures(slower), 'pageLoadMs', 100),
    );
    expect(error.message).toContain('1000 ms to 1300 ms');
  });

  it('refuses to compare a single recording with itself', async () => {
    const only = fixtures(await recorded());
    const error = await caught(() =>
      assertVitalNoWorseThanPrevious(asFixtures(only), 'pageLoadMs', 0),
    );
    expect((error as { code: string }).code).toBe('RUN_FAILED');
    expect(error.message).toContain('comparing needs two');
  });
});

describe('Then the perf budgets {string} should be configured', () => {
  const fixtures = (budgets: Record<string, number>) => ({
    config: config(budgets),
    apiContext: new ApiContext(),
    env: { vars: {} },
  });

  it('passes when every named budget is set', async () => {
    await assertBudgetsConfigured(
      asFixtures(fixtures({ pageLoadMs: 4000, lcpMs: 3000, apiP95Ms: 1500 })),
      `pageLoadMs, lcpMs, ${API_P95_BUDGET_KEY}`,
    );
  });

  it('names the first missing key — the guard on every other perf step in the suite', async () => {
    const error = await caught(() =>
      assertBudgetsConfigured(asFixtures(fixtures({ pageLoadMs: 4000 })), 'pageLoadMs lcpMs'),
    );
    expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    expect(error.message).toContain('lcpMs');
  });

  it('refuses an empty list rather than passing over nothing', async () => {
    const error = await caught(() => assertBudgetsConfigured(asFixtures(fixtures({})), '  ,  '));
    expect(error.message).toContain('No budget names');
  });
});

/* ── API latency sampling ─────────────────────────────────────────────── */

describe('When I sample the latency of {method} {string} over {int} requests', () => {
  function fixtures(api: ReturnType<typeof apiDouble>, vars: Record<string, unknown> = {}) {
    const apiContext = new ApiContext();
    for (const [k, v] of Object.entries(vars)) apiContext.vars.set(k, v);
    return {
      api,
      apiContext,
      env: { vars: { region: 'eu' } },
      scenario: scenarioDouble(),
      $bddContext: { stepIndex: 7 },
      $testInfo: testInfoDouble(),
    };
  }

  it('interpolates the path through scenario variables and the env vars', async () => {
    // The single most common step-library defect: an argument that silently does not interpolate.
    const api = apiDouble([{ ms: 10 }]);
    const fx = fixtures(api, { workflowId: 42 });
    await sampleLatency(asFixtures(fx), 'GET' as never, '/{{region}}/workflows/{{workflowId}}', 3);
    expect(api.sent.map((c) => c.path)).toEqual([
      '/eu/workflows/42',
      '/eu/workflows/42',
      '/eu/workflows/42',
    ]);
  });

  it('takes exactly N sequential samples, silent and un-retried', async () => {
    const api = apiDouble([{ ms: 5 }]);
    const fx = fixtures(api);
    await sampleLatency(asFixtures(fx), 'GET' as never, '/health', 4);
    expect(api.sent).toHaveLength(4);
    // silent keeps the samples out of apiContext.history, so `the response status should be …`
    // still refers to the request the scenario actually made.
    expect(api.sent.every((c) => c.opts?.silent === true)).toBe(true);
    // retries:0 — a retried sample would time the second attempt and hide the first failure.
    expect(api.sent.every((c) => c.opts?.retries === 0)).toBe(true);
    expect(fx.apiContext.history).toHaveLength(0);
  });

  it('records the p95 and attaches the distribution', async () => {
    const api = apiDouble([{ ms: 10 }, { ms: 90 }, { ms: 20 }, { ms: 30 }]);
    const fx = fixtures(api);
    await sampleLatency(asFixtures(fx), 'GET' as never, '/items', 4);
    const set = perfStore(fx.scenario).sampleSets[0]!;
    expect(set.p95Ms).toBe(90);
    expect(fx.$testInfo.attached[0]!.name).toBe('sdods/perf-sample/07');
    const written = JSON.parse(readFileSync(fx.$testInfo.attached[0]!.path, 'utf8'));
    expect(written).toMatchObject({
      method: 'GET',
      path: '/items',
      count: 4,
      p95Ms: 90,
      minMs: 10,
      maxMs: 90,
    });
  });

  it('refuses to time a HAR replay — that measures the recording, not the environment', async () => {
    // `silent: true` suppresses recording but not replay, and `release:check` runs
    // `--har-replay --strict` with the perfBudgets gate on. Without this the p95 would be the
    // HAR file's numbers and would pass every budget for ever.
    const error = await caught(() =>
      sampleLatency(
        asFixtures(fixtures(apiDouble([{ ms: 3 }], { replayedFromHar: true }))),
        'GET' as never,
        '/items',
        5,
      ),
    );
    expect((error as { code: string }).code).toBe('NOT_SUPPORTED');
    expect((error as { hint?: string }).hint).toContain('--har-replay');
  });

  it('refuses a zero-sample request rather than producing an empty distribution', async () => {
    const error = await caught(() =>
      sampleLatency(asFixtures(fixtures(apiDouble([{ ms: 1 }]))), 'GET' as never, '/items', 0),
    );
    expect((error as { code: string }).code).toBe('RUN_FAILED');
  });

  it('renders the body of the with-body form, keeping JSON types', async () => {
    const api = apiDouble([{ ms: 12 }]);
    const fx = fixtures(api, { id: 7 });
    await sampleLatencyWithBody(
      asFixtures(fx),
      'POST' as never,
      '/search',
      2,
      '{"id": {{id}}, "region": "{{region}}"}',
    );
    expect(api.sent[0]!.opts?.body).toEqual({ id: 7, region: 'eu' });
    expect(api.sent).toHaveLength(2);
  });
});

describe('sampled p95 assertions', () => {
  async function sampled(plan: Array<{ ms: number; status?: number }>, times = plan.length) {
    const scenario = scenarioDouble();
    await sampleLatency(
      asFixtures({
        api: apiDouble(plan),
        apiContext: new ApiContext(),
        env: { vars: {} },
        scenario,
        $bddContext: { stepIndex: 1 },
        $testInfo: testInfoDouble(),
      }),
      'GET' as never,
      '/items',
      times,
    );
    return scenario;
  }

  it('passes on the apiP95Ms budget and fails over it', async () => {
    const scenario = await sampled([{ ms: 100 }, { ms: 400 }]);
    await assertP95WithinBudget(asFixtures({ scenario, config: config({ apiP95Ms: 400 }) }));
    const error = await caught(() =>
      assertP95WithinBudget(asFixtures({ scenario, config: config({ apiP95Ms: 399 }) })),
    );
    expect(error.message).toContain('apiP95Ms budget of 399 ms');
    expect(error.message).toContain('2 samples');
  });

  it('refuses an unconfigured apiP95Ms rather than passing silently', async () => {
    const scenario = await sampled([{ ms: 1 }]);
    const error = await caught(() =>
      assertP95WithinBudget(asFixtures({ scenario, config: config({ pageLoadMs: 4000 }) })),
    );
    expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    expect(error.message).toContain(API_P95_BUDGET_KEY);
  });

  it('is step misuse, not a pass, when nothing was sampled', async () => {
    const error = await caught(() =>
      assertP95WithinBudget(
        asFixtures({ scenario: scenarioDouble(), config: config({ apiP95Ms: 100 }) }),
      ),
    );
    expect((error as { code: string }).code).toBe('RUN_FAILED');
  });

  it('applies the scenario-local limit strictly', async () => {
    const scenario = await sampled([{ ms: 250 }]);
    await assertP95UnderThreshold(asFixtures({ scenario }), 251);
    const error = await caught(() => assertP95UnderThreshold(asFixtures({ scenario }), 250));
    expect(error.message).toContain('scenario-local limit of 250 ms');
  });

  it('compares two samples and refuses to compare one', async () => {
    const scenario = await sampled([{ ms: 400 }]);
    const alone = await caught(() => assertP95NoWorseThanPrevious(asFixtures({ scenario }), 0));
    expect(alone.message).toContain('comparing needs two');

    await sampleLatency(
      asFixtures({
        api: apiDouble([{ ms: 100 }]),
        apiContext: new ApiContext(),
        env: { vars: {} },
        scenario,
        $bddContext: { stepIndex: 2 },
        $testInfo: testInfoDouble(),
      }),
      'GET' as never,
      '/items',
      1,
    );
    await assertP95NoWorseThanPrevious(asFixtures({ scenario }), 0);

    await sampleLatency(
      asFixtures({
        api: apiDouble([{ ms: 900 }]),
        apiContext: new ApiContext(),
        env: { vars: {} },
        scenario,
        $bddContext: { stepIndex: 3 },
        $testInfo: testInfoDouble(),
      }),
      'GET' as never,
      '/items',
      1,
    );
    const slower = await caught(() => assertP95NoWorseThanPrevious(asFixtures({ scenario }), 10));
    expect(slower.message).toContain('100 ms to 900 ms');
  });

  it('catches a p95 that was met by error responses', async () => {
    // A budget met by an endpoint that 500s in 3 ms is the vacuous green this step closes.
    const scenario = await sampled([
      { ms: 3, status: 500 },
      { ms: 4, status: 500 },
    ]);
    await assertP95WithinBudget(asFixtures({ scenario, config: config({ apiP95Ms: 1000 }) }));
    const error = await caught(() => assertEverySampleStatus(asFixtures({ scenario }), 200));
    expect(error.message).toContain('2 of 2 samples');
    expect(error.message).toContain('[500]');
  });

  it('passes the status check when every sample is the expected status', async () => {
    const scenario = await sampled([{ ms: 3 }, { ms: 4 }]);
    await assertEverySampleStatus(asFixtures({ scenario }), 200);
  });

  it('is step misuse, not a pass, when the status check runs with no sample', async () => {
    const error = await caught(() =>
      assertEverySampleStatus(asFixtures({ scenario: scenarioDouble() }), 200),
    );
    expect((error as { code: string }).code).toBe('RUN_FAILED');
  });
});

/* ── the browser-side collector, against a real page ──────────────────── */

/**
 * Everything above stubs `page.evaluate`, which leaves the one decision the whole library turns on
 * — null versus a number — typed but unproven. This is the only test that runs the collector in a
 * browser, so it is the only one that can show a vital that never fired coming back as `null`
 * rather than 0. Served through a fulfilled route rather than `setContent`, so the navigation entry
 * has a real `responseStart` to report.
 */
describe('collectRawVitals in a real browser', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function serve(body: string): Promise<RawVitals> {
    await page.route('**/*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body }),
    );
    await page.goto('http://perf.sdods.test/', { waitUntil: 'load' });
    return page.evaluate(collectRawVitals, 100);
  }

  it('measures every vital on a page that paints', async () => {
    const raw = await serve('<!doctype html><html><body><h1>Largest thing here</h1></body></html>');
    expect(raw.hasNavigationEntry).toBe(true);
    expect(raw.pageLoadMs).toBeGreaterThan(0);
    expect(raw.ttfbMs).toBeGreaterThan(0);
    expect(raw.domContentLoadedMs).toBeGreaterThan(0);
    expect(raw.fcpMs).toBeGreaterThan(0);
    expect(raw.lcpMs).toBeGreaterThan(0);
    expect(raw.lcpSupported).toBe(true);
    expect(raw.navigationStartEpochMs).toBeGreaterThan(0);
  });

  it('returns null, never 0, for a vital that never fired', async () => {
    // A page with nothing contentful produces no LCP candidate. Recording that as 0 is the defect
    // this library exists to remove: 0 sits under every budget that could ever be configured.
    const raw = await serve('<!doctype html><html><body></body></html>');
    expect(raw.hasNavigationEntry).toBe(true);
    expect(raw.ttfbMs).toBeGreaterThan(0);
    expect(raw.lcpMs).toBeNull();
    expect(toRecording(raw, 'http://perf.sdods.test/', 'chromium').vitals.lcpMs).toBeNull();
  });

  it('counts the resources the page actually fetched', async () => {
    const raw = await serve(
      '<!doctype html><html><body><h1>hi</h1><script src="/a.js"></script></body></html>',
    );
    expect(raw.totalResources).toBeGreaterThan(0);
  });
});
