import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  judgeBudgets,
  judgeScenarioPerf,
  watchNavigations,
  type PerfScenarioReport,
} from '../src/quality/perf-scenario.js';
import { toRecording, type RawVitals } from '../src/perf/vitals.js';

/**
 * The `@perf` tag check. Like the explicit perf steps, the cases that matter are the ones that must
 * go red: a breach, a vital that never fired, no budgets at all, and a scenario that measured
 * nothing a budget applies to. The browser cases run the real init script and binding in Chromium.
 */

const RAW: RawVitals = {
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

const recording = (vitals: Partial<RawVitals>, url = 'https://x/') =>
  toRecording({ ...RAW, ...vitals }, url, 'chromium');

async function caught(fn: () => Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error('expected a failure, got a pass');
}

describe('judgeBudgets', () => {
  it('compares every recorded navigation with every page budget that is configured', () => {
    const verdict = judgeBudgets({
      budgets: { pageLoadMs: 1000, lcpMs: 2000 },
      recordings: [
        recording({ pageLoadMs: 900 }, 'https://x/a'),
        recording({ pageLoadMs: 1300 }, 'https://x/b'),
      ],
      apiMs: [],
      apiReplayed: 0,
      envName: 'staging',
    });
    expect(verdict.judged).toBe(4);
    expect(verdict.breaches.map((b) => `${b.budget}@${b.where}`)).toEqual([
      'pageLoadMs@https://x/b',
    ]);
  });

  it('fails a budgeted vital that never fired instead of passing it as 0', () => {
    const verdict = judgeBudgets({
      budgets: { lcpMs: 2000 },
      recordings: [recording({ lcpMs: null })],
      apiMs: [],
      apiReplayed: 0,
      envName: 'staging',
    });
    expect(verdict.breaches[0]?.measuredMs).toBeNull();
    expect(verdict.breaches[0]?.message).toContain('not measured');
  });

  it('judges the API p95 against apiP95Ms, and refuses HAR-replayed timings as measurements', () => {
    const slow = judgeBudgets({
      budgets: { apiP95Ms: 100 },
      recordings: [],
      apiMs: [10, 20, 30, 400],
      apiReplayed: 0,
      envName: 'staging',
    });
    expect(slow.p95Ms).toBe(400);
    expect(slow.breaches).toHaveLength(1);
    const replayed = judgeBudgets({
      budgets: { apiP95Ms: 100 },
      recordings: [],
      apiMs: [],
      apiReplayed: 3,
      envName: 'staging',
    });
    expect(replayed.judged).toBe(1);
    expect(replayed.breaches[0]?.message).toContain('replayed from a HAR');
  });

  it('reports zero comparisons when no configured budget applies to what was measured', () => {
    const verdict = judgeBudgets({
      budgets: { apiP95Ms: 100 },
      recordings: [recording({})],
      apiMs: [],
      apiReplayed: 0,
      envName: 'staging',
    });
    expect(verdict.judged).toBe(0);
  });
});

describe('@perf scenario check in a real browser', () => {
  let browser: Browser;
  let context: BrowserContext | undefined;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    await context?.close();
    context = await browser.newContext();
    page = await context.newPage();
    await page.route('**/*', (route) => {
      const url = route.request().url();
      // /spa paints only after its load event, the way a client-rendered page does.
      const body = url.endsWith('/spa')
        ? '<!doctype html><html><body><div id="root"></div><script>addEventListener("load",()=>setTimeout(()=>{document.getElementById("root").innerHTML="<h1>Rendered late</h1>"},300))</script></body></html>'
        : `<!doctype html><html><body><h1>Page ${url}</h1></body></html>`;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
  });

  function deps(budgets: Record<string, number>, history: unknown[] = [], status = 'passed') {
    const dir = mkdtempSync(join(tmpdir(), 'sdods-perf-scenario-'));
    const attached: string[] = [];
    const scenario = {
      dir,
      data: {
        browser: 'chromium',
        runnerProject: 'shop--ui--chromium',
        fingerprint: '0123456789abcdef',
        retry: 0,
      },
      file: (rel: string) => {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        return join(dir, rel);
      },
    };
    return {
      scenario,
      attached,
      input: {
        config: { project: { perf: { budgets } }, env: { name: 'staging' } },
        scenario,
        apiContext: { history },
        testInfo: {
          status,
          attach: async (name: string) => {
            attached.push(name);
          },
        },
      },
    };
  }

  const reportOf = (dir: string) =>
    JSON.parse(
      readFileSync(join(dir, 'perf', 'scenario--shop--ui--chromium.json'), 'utf8'),
    ) as PerfScenarioReport;

  it('records every document the scenario loads and passes them inside generous budgets', async () => {
    const d = deps({ pageLoadMs: 60_000, fcpMs: 60_000, lcpMs: 60_000, ttfbMs: 60_000 });
    await watchNavigations({ page, scenario: d.scenario });
    await page.goto('http://perf.sdods.test/one', { waitUntil: 'domcontentloaded' });
    await page.goto('http://perf.sdods.test/two', { waitUntil: 'domcontentloaded' });
    const report = await judgeScenarioPerf(d.input as never);
    // The first document was left straight after it loaded, so it may not have reported; the
    // one the scenario ended on always does, and nothing is double-counted.
    expect(report.navigations.length + report.unreported).toBe(2);
    expect(report.navigations.at(-1)?.url).toBe('http://perf.sdods.test/two');
    expect(report.judged).toBe(4 * report.navigations.length);
    expect(report.breaches).toEqual([]);
    expect(reportOf(d.scenario.dir).status).toBe('judged');
    expect(d.attached).toEqual(['sdods/perf-scenario']);
  });

  it('waits for a page that paints after its load event instead of calling its FCP unmeasured', async () => {
    const d = deps({ fcpMs: 60_000, lcpMs: 60_000 });
    await watchNavigations({ page, scenario: d.scenario });
    await page.goto('http://perf.sdods.test/spa', { waitUntil: 'load' });
    const report = await judgeScenarioPerf(d.input as never);
    expect(report.navigations[0]?.vitals.fcpMs).toBeGreaterThanOrEqual(300);
    expect(report.breaches).toEqual([]);
  });

  it('fails on a budget breach and names the page and the numbers', async () => {
    const d = deps({ pageLoadMs: 1 });
    await watchNavigations({ page, scenario: d.scenario });
    await page.goto('http://perf.sdods.test/slow', { waitUntil: 'load' });
    const error = await caught(() => judgeScenarioPerf(d.input as never));
    expect(error.message).toContain('pageLoadMs measured');
    expect(error.message).toContain('http://perf.sdods.test/slow');
    expect(reportOf(d.scenario.dir).breaches).toHaveLength(1);
  });

  it('is CONFIG_INVALID, not a pass, when the environment has no budgets at all', async () => {
    const d = deps({});
    await watchNavigations({ page, scenario: d.scenario });
    await page.goto('http://perf.sdods.test/', { waitUntil: 'load' });
    const error = await caught(() => judgeScenarioPerf(d.input as never));
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.message).toContain('no perf budgets configured');
  });

  it('fails a scenario where no configured budget applied to anything it measured', async () => {
    const d = deps({ apiP95Ms: 500 });
    await watchNavigations({ page, scenario: d.scenario });
    await page.goto('http://perf.sdods.test/', { waitUntil: 'load' });
    const error = await caught(() => judgeScenarioPerf(d.input as never));
    expect(error.message).toContain('proved nothing');
  });

  it('judges API response times against apiP95Ms without any page', async () => {
    const snap = (ms: number, replayedFromHar = false) => ({
      request: { method: 'GET', url: 'https://api/x', headers: {} },
      response: { status: 200, statusText: 'OK', headers: {}, body: null, responseTime: ms },
      startedAt: '2026-01-01T00:00:00Z',
      replayedFromHar,
    });
    const ok = deps({ apiP95Ms: 500 }, [snap(40), snap(60), snap(900, true)]);
    const report = await judgeScenarioPerf(ok.input as never);
    expect(report.api).toEqual({ liveCalls: 2, replayedFromHar: 1, samples: 0, p95Ms: 60 });
    const slow = deps({ apiP95Ms: 50 }, [snap(40), snap(60)]);
    await expect(judgeScenarioPerf(slow.input as never)).rejects.toThrow(/API p95 was 60 ms/);
  });

  it('does not judge a scenario that already failed', async () => {
    const report = await judgeScenarioPerf(deps({ pageLoadMs: 1 }, [], 'failed').input as never);
    expect(report.status).toBe('skipped');
    expect(report.breaches).toEqual([]);
  });
});
