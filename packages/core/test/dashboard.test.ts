import { describe, expect, it } from 'vitest';
import { errorSignature, renderHtml, type Metrics } from '../src/reporters/dashboard.js';

/**
 * The dashboard is a decision surface, so the thing it must never do is present
 * an untrustworthy run as a good one. These tests pin the judgements, not the
 * layout — a redesign should keep them all passing.
 */

const ESC = '';

function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    title: 'run',
    generatedAt: '2026-01-01T00:00:00.000Z',
    summary: {
      total: 10,
      passed: 10,
      failed: 0,
      skipped: 0,
      timedOut: 0,
      flaky: 0,
      healed: 0,
      durationMs: 1000,
      workers: 2,
    },
    clusters: [],
    byRole: {},
    slowest: [],
    byProject: {},
    byLayer: {},
    byBrowser: {},
    byTag: {},
    failed: [],
    flaky: [],
    tests: [],
    ...over,
  } as Metrics;
}

describe('the verdict tells you whether you can ship', () => {
  it('says Passing only when something ran and nothing failed', () => {
    expect(renderHtml(metrics())).toContain('>Passing<');
  });

  it('a run that registered nothing is NOT green', () => {
    // A suite that registers zero tests exits 0 and is indistinguishable from a
    // green run in a CI summary. The dashboard must not repeat that mistake.
    const html = renderHtml(metrics({ summary: { ...metrics().summary, total: 0, passed: 0 } }));
    expect(html).toContain('Nothing ran');
    expect(html).not.toContain('>Passing<');
  });

  it('a fully skipped run is NOT green', () => {
    const html = renderHtml(
      metrics({ summary: { ...metrics().summary, total: 10, passed: 0, skipped: 10 } }),
    );
    expect(html).toContain('Nothing ran');
    expect(html).toContain('Skipped is not passed');
  });

  it('names the number of distinct causes, not just the failure count', () => {
    const html = renderHtml(
      metrics({
        summary: { ...metrics().summary, passed: 7, failed: 3 },
        clusters: [{ signature: 'expected <n>, got <n>', count: 3, titles: ['a', 'b', 'c'] }],
      }),
    );
    expect(html).toContain('3 scenarios failed across 1 distinct cause');
  });
});

describe('pass rate is computed over what EXECUTED', () => {
  it('excludes skipped scenarios from the denominator', () => {
    // 6 passed of 6 executed = 100%, with the 4 skips surfaced separately as a
    // warning. Folding skips into the rate is how a suite quietly stops
    // measuring anything: 6/10 understates the executed result, and counting
    // skips as passes overstates it. Neither is honest, so separate them.
    const html = renderHtml(
      metrics({ summary: { ...metrics().summary, total: 10, passed: 6, skipped: 4 } }),
    );
    expect(html).toContain('>100%<');
    expect(html).toContain('6 of 6 executed');
    expect(html).toContain('40% of the suite');
  });
});

describe('warnings make a green run untrustworthy on purpose', () => {
  it('warns when the skip rate is above the ceiling', () => {
    const html = renderHtml(
      metrics({ summary: { ...metrics().summary, total: 10, passed: 6, skipped: 4 } }),
    );
    expect(html).toContain('A skip is an untested path, not a pass');
  });

  it('warns when a locator had to be healed', () => {
    // A heal means the application's DOM moved. The test passed; the selector it
    // was written against no longer matches. That is a finding, not a success.
    const html = renderHtml(metrics({ summary: { ...metrics().summary, healed: 2 } }));
    // The apostrophe is HTML-escaped by esc(), which is correct — assert the
    // rendered form, not the source string.
    expect(html).toContain('DOM moved');
    expect(html).toContain('&#39;s DOM moved');
  });

  it('warns when a scenario only passed on retry', () => {
    const html = renderHtml(metrics({ summary: { ...metrics().summary, passed: 9, flaky: 1 } }));
    expect(html).toContain('passed only on retry');
  });

  it('a clean run raises no warnings', () => {
    expect(renderHtml(metrics())).not.toContain('class="warnings"');
  });
});

describe('the role matrix', () => {
  it('shows a role that fails while others pass', () => {
    const html = renderHtml(
      metrics({
        byRole: {
          viewer: { total: 4, passed: 1, failed: 3 },
          admin: { total: 4, passed: 4, failed: 0 },
        },
      }),
    );
    expect(html).toContain('@user:viewer');
    expect(html).toContain('@user:admin');
    expect(html).toContain('permissions regression');
  });

  it('is omitted entirely when no scenario is role-tagged', () => {
    expect(renderHtml(metrics())).not.toContain('permissions regression');
  });
});

describe('error signatures collapse one cause into one problem', () => {
  it('treats two instances of the same defect as one signature', () => {
    const a = errorSignature('Error: locator.click: Timeout 5000ms exceeded for "#save-btn"');
    const b = errorSignature('Error: locator.click: Timeout 9000ms exceeded for "#other-btn"');
    expect(a).toBe(b);
  });

  it('keeps genuinely different assertions apart', () => {
    // Over-collapsing is the real risk: a status mismatch and a visibility
    // failure are different problems, and hiding one behind the other is worse
    // than not clustering at all.
    expect(errorSignature('Expected 204 but received 403')).not.toBe(
      errorSignature('Expected the element to be visible but it was hidden'),
    );
  });

  it('strips ANSI colour so a coloured error still clusters', () => {
    const plain = errorSignature('Error: expected 204, got 403');
    const coloured = errorSignature(
      `Error: expected ${ESC}[32m204${ESC}[39m, got ${ESC}[31m403${ESC}[39m`,
    );
    expect(coloured).toBe(plain);
  });

  it('never returns an empty signature', () => {
    expect(errorSignature(undefined)).toBe('no error message');
    expect(errorSignature('')).toBe('no error message');
  });
});

describe('output safety', () => {
  it('escapes a title that contains markup', () => {
    const html = renderHtml(metrics({ title: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes an error signature that contains markup', () => {
    const html = renderHtml(
      metrics({
        summary: { ...metrics().summary, passed: 9, failed: 1 },
        clusters: [{ signature: '</code><script>x()</script>', count: 1, titles: [] }],
      }),
    );
    expect(html).not.toContain('<script>x()');
  });
});
