import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertAxeChecked,
  assertGathered,
  assertRegion,
  assertRuleRan,
  describeViolations,
  focusRingMissing,
  headingSkips,
  iconOnlyControls,
  imagesWithoutAlt,
  impactRank,
  parseImpactFloor,
  RAW_I18N_KEY,
  ruleBucket,
  unnamedControls,
  violationsAtOrAbove,
  WCAG_AA_TAGS,
  type A11yResults,
  type A11yViolation,
} from '../src/steps/a11y.steps.js';
import { SdodsError } from '../src/errors.js';
import { markPageAudited } from '../src/a11y/audit.js';
import {
  auditAfterStep,
  auditScenarioEnd,
  watchA11yPages,
  type A11yScenarioReport,
} from '../src/quality/a11y-scenario.js';

/**
 * The library's contract is "no step may pass vacuously". Every judge is therefore tested three
 * ways: it FAILS on an empty set, it CATCHES a real offender, and it PASSES a clean set. The
 * middle case alone would be satisfied by a step that also passes over nothing.
 */

const results = (over: Partial<A11yResults> = {}): A11yResults => ({
  violations: [],
  passes: [],
  incomplete: [],
  inapplicable: [],
  ...over,
});

const violation = (id: string, impact: string | null, nodes = 1): A11yViolation => ({
  id,
  impact,
  help: `${id} help`,
  nodes: Array.from({ length: nodes }, (_, i) => ({ target: [`#n${i}`] })),
});

describe('a11y step registration', () => {
  it('registers exactly the documented step patterns, once each', async () => {
    await import('../src/steps/a11y.steps.js');
    const require = createRequire(import.meta.url);
    const reg = require(
      require
        .resolve('playwright-bdd/package.json')
        .replace('package.json', 'dist/steps/stepRegistry.js'),
    );
    const patterns: string[] = reg.stepDefinitions.map((d: { pattern: string }) =>
      String(d.pattern),
    );
    const mine = [
      'the page should have no accessibility violations',
      'the page should have no accessibility violations within {string}',
      'the page should have no accessibility violations of impact {string} or worse',
      'the page should have no accessibility violations of impact {string} or worse within {string}',
      'the page should have no accessibility violations of rule {string}',
      'the page should have no colour-contrast violations',
      'the page should have no colour-contrast violations within {string}',
      'the page should have exactly one level-1 heading',
      'the heading levels should not skip a level',
      'every image on the page should carry an alt attribute',
      'every image within {string} should carry an alt attribute',
      'every icon-only control within {string} should expose an accessible name',
      'every focusable element within {string} should show a visible focus indicator',
    ];
    for (const p of mine) {
      // playwright-bdd hard-fails the whole run on a duplicate expression, so a second
      // registration of any of these — here or in another step file — must be caught.
      expect(
        patterns.filter((x) => x === p),
        `pattern registered ${patterns.filter((x) => x === p).length}x: ${p}`,
      ).toHaveLength(1);
    }
  });
});

describe('impact levels', () => {
  it('ranks the four axe levels weakest-first and treats a null impact as minor', () => {
    expect(IMPACTS.map(impactRank)).toEqual([0, 1, 2, 3]);
    expect(impactRank(null)).toBe(0);
    expect(impactRank(undefined)).toBe(0);
    // an impact axe invented in a future release must not silently outrank "critical"
    expect(impactRank('apocalyptic')).toBe(0);
  });

  it('rejects an impact level a feature file invented, rather than matching nothing', () => {
    expect(() => parseImpactFloor('banana')).toThrow(SdodsError);
    try {
      parseImpactFloor('banana');
    } catch (e) {
      expect((e as SdodsError).code).toBe('CONFIG_INVALID');
      expect((e as SdodsError).hint).toContain('minor, moderate, serious, critical');
    }
  });

  it('filters to violations at or above the floor', () => {
    const vs = [
      violation('a', 'minor'),
      violation('b', 'moderate'),
      violation('c', 'serious'),
      violation('d', 'critical'),
      violation('e', null),
    ];
    expect(violationsAtOrAbove(vs, parseImpactFloor('serious')).map((v) => v.id)).toEqual([
      'c',
      'd',
    ]);
    expect(violationsAtOrAbove(vs, parseImpactFloor('minor'))).toHaveLength(5);
    expect(violationsAtOrAbove([], parseImpactFloor('critical'))).toEqual([]);
  });
});
const IMPACTS = ['minor', 'moderate', 'serious', 'critical'];

describe('violation formatting', () => {
  it('names the rule, impact, node count and the first targets', () => {
    const text = describeViolations([violation('color-contrast', 'serious', 5)]);
    expect(text).toContain('color-contrast [serious]');
    expect(text).toContain('5 node(s)');
    expect(text).toContain('#n0 | #n1 | #n2');
    expect(text).toContain('(+2 more node(s))');
  });

  it('does not claim "+n more" when every node is shown', () => {
    expect(describeViolations([violation('x', 'minor', 2)])).not.toContain('more node(s)');
  });
});

describe('assertAxeChecked — the audit must have run', () => {
  it('fails when axe reported nothing at all, which reads as a clean page', () => {
    expect(() => assertAxeChecked(results(), 'on /dash')).toThrow(/examined nothing/);
    try {
      assertAxeChecked(results(), 'on /dash');
    } catch (e) {
      expect((e as SdodsError).code).toBe('RUN_FAILED');
      expect((e as SdodsError).hint).toMatch(/Content-Security-Policy/);
    }
  });

  it('passes when any rule landed in passes, violations or incomplete', () => {
    expect(() => assertAxeChecked(results({ passes: [{ id: 'r' }] }), 'x')).not.toThrow();
    expect(() =>
      assertAxeChecked(results({ violations: [violation('r', 'minor')] }), 'x'),
    ).not.toThrow();
    expect(() => assertAxeChecked(results({ incomplete: [{ id: 'r' }] }), 'x')).not.toThrow();
  });

  it('is not satisfied by inapplicable alone — nothing was actually examined', () => {
    expect(() => assertAxeChecked(results({ inapplicable: [{ id: 'r' }] }), 'x')).toThrow();
  });
});

describe('assertRuleRan — a rule-scoped audit must have been able to fail', () => {
  it('reports which bucket a rule landed in', () => {
    expect(
      ruleBucket(
        results({ violations: [violation('color-contrast', 'serious')] }),
        'color-contrast',
      ),
    ).toBe('violations');
    expect(ruleBucket(results({ passes: [{ id: 'image-alt' }] }), 'image-alt')).toBe('passes');
    expect(ruleBucket(results({ incomplete: [{ id: 'color-contrast' }] }), 'color-contrast')).toBe(
      'incomplete',
    );
    expect(ruleBucket(results({ inapplicable: [{ id: 'image-alt' }] }), 'image-alt')).toBe(
      'inapplicable',
    );
    expect(ruleBucket(results(), 'image-alt')).toBe('none');
  });

  it('fails on a misspelt rule id, which axe would otherwise report as zero violations', () => {
    try {
      assertRuleRan(results({ passes: [{ id: 'image-alt' }] }), 'imgae-alt', 'on /dash');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as SdodsError).code).toBe('CONFIG_INVALID');
      expect((e as SdodsError).message).toContain('never ran the rule "imgae-alt"');
    }
  });

  it('fails when the rule was inapplicable — a rule with nothing to check cannot pass', () => {
    try {
      assertRuleRan(results({ inapplicable: [{ id: 'image-alt' }] }), 'image-alt', 'on /dash');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as SdodsError).code).toBe('RUN_FAILED');
      expect((e as SdodsError).message).toContain('inapplicable on /dash');
      expect((e as SdodsError).hint).toContain('cannot fail');
    }
  });

  it('accepts a rule that ran, incomplete included, and hands back the bucket', () => {
    expect(
      assertRuleRan(results({ passes: [{ id: 'color-contrast' }] }), 'color-contrast', 'x'),
    ).toBe('passes');
    expect(
      assertRuleRan(results({ incomplete: [{ id: 'color-contrast' }] }), 'color-contrast', 'x'),
    ).toBe('incomplete');
    expect(
      assertRuleRan(
        results({ violations: [violation('color-contrast', 'serious')] }),
        'color-contrast',
        'x',
      ),
    ).toBe('violations');
  });
});

describe('assertRegion — a selector matching nothing is a failure, not an empty scan', () => {
  it('fails when the browser reported the region absent', () => {
    try {
      assertRegion({ regionFound: false, items: [] }, 'nav[aria-label="Main"]');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as SdodsError).code).toBe('RUN_FAILED');
      expect((e as SdodsError).message).toContain('nav[aria-label="Main"]');
    }
  });

  it('hands back the items when the region was found, empty ones included', () => {
    expect(assertRegion({ regionFound: true, items: [1, 2] }, 'nav')).toEqual([1, 2]);
    expect(assertRegion({ regionFound: true, items: [] }, 'nav')).toEqual([]);
  });
});

describe('assertGathered — the anti-vacuity guard the whole library turns on', () => {
  it('fails on an empty set and says what to do instead', () => {
    try {
      assertGathered([], 'img elements', 'on /pricing');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as SdodsError).code).toBe('RUN_FAILED');
      expect((e as SdodsError).message).toBe(
        'Found no img elements on /pricing; nothing was checked.',
      );
      expect((e as SdodsError).hint).toContain('passes without proving anything');
    }
  });

  it('passes anything non-empty straight through', () => {
    expect(assertGathered([1], 'x', 'y')).toEqual([1]);
  });
});

describe('heading outline', () => {
  it('catches a skipped level and names both ends of the jump', () => {
    const skips = headingSkips([
      { level: 1, text: 'Page' },
      { level: 2, text: 'Section' },
      { level: 4, text: 'Deep' },
    ]);
    expect(skips).toEqual(['h2 "Section" → h4 "Deep"']);
  });

  it('allows going back up any number of levels — only downward jumps break the outline', () => {
    expect(
      headingSkips([
        { level: 1, text: 'a' },
        { level: 2, text: 'b' },
        { level: 3, text: 'c' },
        { level: 1, text: 'd' },
      ]),
    ).toEqual([]);
  });

  it('reports every skip, not just the first', () => {
    expect(
      headingSkips([
        { level: 1, text: 'a' },
        { level: 3, text: 'b' },
        { level: 2, text: 'c' },
        { level: 6, text: 'd' },
      ]),
    ).toHaveLength(2);
  });

  it('an empty outline yields no skips — which is why the step guards it with assertGathered', () => {
    expect(headingSkips([])).toEqual([]);
    expect(() => assertGathered([], 'headings', 'on /blank')).toThrow(SdodsError);
  });
});

describe('image alt attributes', () => {
  it('flags a missing alt but not an empty one — those are different decisions', () => {
    expect(
      imagesWithoutAlt([
        { src: '/a.png', hasAlt: true },
        { src: '/b.png', hasAlt: false },
      ]),
    ).toEqual(['/b.png']);
  });

  it('names a src-less image rather than printing an empty string', () => {
    expect(imagesWithoutAlt([{ src: '', hasAlt: false }])).toEqual(['(no src)']);
  });

  it('an image-free page yields no offenders — the step guards it with assertGathered', () => {
    expect(imagesWithoutAlt([])).toEqual([]);
    expect(() => assertGathered([], 'img elements', 'on /blank')).toThrow(SdodsError);
  });
});

describe('icon-only controls', () => {
  const control = (over: Partial<{ tag: string; text: string; name: string; html: string }>) => ({
    tag: 'button',
    text: '',
    name: '',
    html: '<button/>',
    ...over,
  });

  it('counts only controls that render no text', () => {
    const all = [control({ name: 'Search' }), control({ text: 'Save', name: '' })];
    expect(iconOnlyControls(all)).toHaveLength(1);
    expect(iconOnlyControls(all)[0]!.name).toBe('Search');
  });

  it('treats whitespace-only text as icon-only', () => {
    expect(iconOnlyControls([control({ text: '  \n ' })])).toHaveLength(1);
  });

  it('flags an unnamed control', () => {
    expect(unnamedControls([control({ name: '' })])[0]).toContain('(no name)');
  });

  it('flags a name that is still a raw i18n key — axe sees a name and passes it', () => {
    const bad = unnamedControls([control({ name: 'nav.workspace.settings' })]);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain('raw i18n key');
  });

  it('accepts a real human name, including one with a full stop in it', () => {
    expect(unnamedControls([control({ name: 'Search' })])).toEqual([]);
    expect(unnamedControls([control({ name: 'Delete this. Permanently' })])).toEqual([]);
    expect(unnamedControls([control({ name: 'Étape suivante' })])).toEqual([]);
  });

  it('matches the raw-key shape the app actually renders', () => {
    expect(RAW_I18N_KEY.test('settings.memory.itemAria')).toBe(true);
    expect(RAW_I18N_KEY.test('nav.settings')).toBe(true);
    expect(RAW_I18N_KEY.test('workspace.a_b.c1')).toBe(true);
    expect(RAW_I18N_KEY.test('Search')).toBe(false);
    expect(RAW_I18N_KEY.test('Save changes')).toBe(false);
  });

  it('a region with no icon-only control proves nothing — the step guards it', () => {
    expect(unnamedControls([])).toEqual([]);
    expect(() => assertGathered([], 'icon-only controls', 'within "nav"')).toThrow(SdodsError);
  });
});

describe('focus indicators', () => {
  it('flags a control whose computed style is identical focused and at rest', () => {
    expect(
      focusRingMissing([
        { label: 'Search', rest: 'none|0px', focused: 'solid|3px' },
        { label: 'Close', rest: 'none|0px', focused: 'none|0px' },
      ]),
    ).toEqual(['Close']);
  });

  it('accepts any style difference, not just an outline — a ring may be a box-shadow', () => {
    expect(
      focusRingMissing([{ label: 'x', rest: 'a|none', focused: 'a|0 0 0 2px #FF6B35' }]),
    ).toEqual([]);
  });

  it('a region with no focusable element proves nothing — the step guards it', () => {
    expect(focusRingMissing([])).toEqual([]);
    expect(() => assertGathered([], 'focusable elements', 'within "nav"')).toThrow(SdodsError);
  });
});

describe('audit scope is pinned', () => {
  it('audits WCAG A/AA only, so a new axe release cannot move the verdict on its own', () => {
    expect(WCAG_AA_TAGS).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    expect(WCAG_AA_TAGS).not.toContain('best-practice');
  });
});

/* ── the @a11y tag audit, against a real page ─────────────────────────── */

/**
 * The tag hook is the one path where nobody wrote a step, so nothing else in a run would notice
 * if it quietly stopped failing. These run the real axe audit in Chromium against pages served
 * through a fulfilled route: a page with known violations must fail, the same page must pass when
 * the threshold or the scope honestly excludes them, and the report must be written either way.
 */
describe('@a11y scenario audit in a real browser', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  // image-alt is critical; color-contrast is serious; a <main> keeps landmark rules quiet.
  const BROKEN = `<!doctype html><html lang="en"><head><title>Broken</title></head><body><main>
    <h1>Shop</h1>
    <div id="hero"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>
    <p id="faint" style="color:#ccc;background:#fff">Low contrast text</p>
  </main></body></html>`;
  const CLEAN = `<!doctype html><html lang="en"><head><title>Clean</title></head><body><main>
    <h1>Shop</h1><p>Readable text</p></main></body></html>`;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    await context?.close();
    // @axe-core/playwright refuses a page from browser.newPage(); fixtures hand it a context page.
    context = await browser.newContext();
    page = await context.newPage();
  });

  async function serve(body: string) {
    await page.route('**/*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body }),
    );
    await page.goto('http://a11y.sdods.test/', { waitUntil: 'load' });
  }

  function deps(a11y: Record<string, unknown> = {}, status = 'passed') {
    const dir = mkdtempSync(join(tmpdir(), 'sdods-a11y-'));
    const attached: string[] = [];
    const scenario = {
      data: { runnerProject: 'shop--ui--chromium', fingerprint: '0123456789abcdef', retry: 0 },
      file: (rel: string) => {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        return join(dir, rel);
      },
    };
    return {
      dir,
      attached,
      scenario,
      input: {
        page,
        config: { project: { a11y } },
        scenario,
        testInfo: {
          status,
          attach: async (name: string) => {
            attached.push(name);
          },
        },
      },
    };
  }

  const report = (dir: string): A11yScenarioReport =>
    JSON.parse(
      readFileSync(join(dir, 'a11y', 'scenario--shop--ui--chromium.json'), 'utf8'),
    ) as A11yScenarioReport;

  it('fails the scenario on violations at or above the default serious threshold', async () => {
    await serve(BROKEN);
    const d = deps();
    const error = await auditScenarioEnd(d.input as never).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error?.message).toContain('@a11y:');
    expect(error?.message).toContain('image-alt');
    expect(error?.message).toContain('color-contrast');
    const written = report(d.dir);
    expect(written.status).toBe('audited');
    expect(written.blocking).toBeGreaterThanOrEqual(2);
    expect(written.blockingRules).toEqual(expect.arrayContaining(['image-alt', 'color-contrast']));
    expect(d.attached).toEqual(['sdods/a11y-scenario']);
  });

  it('applies a11y.failOn: critical fails on image-alt but not on contrast alone', async () => {
    await serve(BROKEN);
    const d = deps({ failOn: 'critical' });
    await expect(auditScenarioEnd(d.input as never)).rejects.toThrow(/image-alt/);
    expect(report(d.dir).blockingRules).toEqual(['image-alt']);
  });

  it('honours exclude: leaving out the regions that violate passes, and says so in the report', async () => {
    await serve(BROKEN);
    const d = deps({ exclude: ['#hero', '#faint'] });
    const result = await auditScenarioEnd(d.input as never);
    expect(result.blocking).toBe(0);
    expect(result.exclude).toEqual(['#hero', '#faint']);
  });

  it('honours include, and an include that matches nothing fails instead of scanning the void', async () => {
    await serve(BROKEN);
    expect((await auditScenarioEnd(deps({ include: ['h1'] }).input as never)).blocking).toBe(0);
    await expect(
      auditScenarioEnd(deps({ include: ['#does-not-exist'] }).input as never),
    ).rejects.toThrow(/found nothing to scan/);
  });

  it('passes a clean page and still writes the evidence', async () => {
    await serve(CLEAN);
    const d = deps();
    const result = await auditScenarioEnd(d.input as never);
    expect(result.status).toBe('audited');
    expect(result.violations).toBe(0);
    expect(result.results?.passes.length).toBeGreaterThan(0);
  });

  it('does not audit twice a URL an explicit whole-page step already audited', async () => {
    await serve(BROKEN);
    const d = deps();
    markPageAudited(d.scenario, page.url());
    const result = await auditScenarioEnd(d.input as never);
    expect(result.status).toBe('covered-by-step');
    expect(result.results).toBeUndefined();
  });

  it('skips a scenario that already failed, rather than burying its error', async () => {
    await serve(BROKEN);
    const result = await auditScenarioEnd(deps({}, 'failed').input as never);
    expect(result.status).toBe('skipped');
  });

  it('fails a scenario that never navigated: there is no page to audit', async () => {
    const d = deps();
    await expect(auditScenarioEnd(d.input as never)).rejects.toThrow(/never navigated/);
  });
});

/**
 * `a11y.scope: every-page` (#177). A scenario that goes through a page with a violation and ends on
 * a clean one passes under `final` and must fail under `every-page`, naming the violating URL. The
 * step boundary is simulated by calling `auditAfterStep` where playwright-bdd's AfterStep hook would.
 */
describe('@a11y every-page scope in a real browser', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  const SITE = 'http://pages.a11y.sdods.test';
  const BROKEN = `<!doctype html><html lang="en"><head><title>Login</title></head><body><main>
    <h1>Login</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    <a href="/clean">Continue</a></main></body></html>`;
  const CLEAN = `<!doctype html><html lang="en"><head><title>Cart</title></head><body><main>
    <h1>Cart</h1><p>Readable text</p><a href="/other">Other</a></main></body></html>`;
  const OTHER = `<!doctype html><html lang="en"><head><title>Other</title></head><body><main>
    <h1>Other</h1><p>Also fine</p></main></body></html>`;
  const REDIRECTS = `<!doctype html><html lang="en"><head><title>Hop</title></head><body><main>
    <h1>Hop</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    </main><script>location.replace('/clean')</script></body></html>`;

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
    const bodies: Record<string, string> = {
      '/broken': BROKEN,
      '/clean': CLEAN,
      '/other': OTHER,
      '/hop': REDIRECTS,
    };
    await page.route(`${SITE}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: bodies[new URL(route.request().url()).pathname] ?? CLEAN,
      }),
    );
  });

  function deps(a11y: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'sdods-a11y-pages-'));
    const attached: string[] = [];
    const scenario = {
      data: { runnerProject: 'shop--ui--chromium', fingerprint: '0123456789abcdef', retry: 0 },
      file: (rel: string) => {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        return join(dir, rel);
      },
    };
    const input = {
      page,
      config: { project: { a11y } },
      scenario,
      testInfo: {
        status: 'passed',
        attach: async (name: string) => {
          attached.push(name);
        },
      },
    };
    watchA11yPages(input as never);
    /** One scenario step: the action, then what the AfterStep hook does. */
    const step = async (title: string, action: () => Promise<unknown>) => {
      await action();
      return auditAfterStep({ ...input, step: title } as never);
    };
    const written = () =>
      JSON.parse(
        readFileSync(join(dir, 'a11y', 'scenario--shop--ui--chromium.json'), 'utf8'),
      ) as A11yScenarioReport;
    return { input, scenario, attached, step, written };
  }

  const flow = async (d: ReturnType<typeof deps>) => {
    await d.step('Given I navigate to the "login" page', () => page.goto(`${SITE}/broken`));
    await d.step('When I click the "Continue" link', () =>
      Promise.all([page.waitForURL(`${SITE}/clean`), page.getByRole('link').click()]),
    );
  };

  it('final (the default) audits only the page the scenario ends on, so it passes', async () => {
    const d = deps({});
    await flow(d);
    const report = await auditScenarioEnd(d.input as never);
    expect(report.status).toBe('audited');
    expect(report.url).toBe(`${SITE}/clean`);
    expect(report.blocking).toBe(0);
    expect(report.pages).toBeUndefined();
    expect(report.scope).toBeUndefined();
  });

  it('every-page fails on a violation mid-flow, naming the URL, and reports each URL on its own', async () => {
    const d = deps({ scope: 'every-page' });
    await flow(d);
    const error = await auditScenarioEnd(d.input as never).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error?.message).toContain('a11y.scope is "every-page"');
    expect(error?.message).toContain(`${SITE}/broken`);
    expect(error?.message).toContain('image-alt');
    expect(error?.message).not.toContain(`${SITE}/clean —`);

    const report = d.written();
    expect(report.scope).toBe('every-page');
    expect(report.url).toBe(`${SITE}/clean`);
    expect(report.pages?.map((p) => [p.url, p.status, p.blockingRules])).toEqual([
      [`${SITE}/broken`, 'audited', ['image-alt']],
      [`${SITE}/clean`, 'audited', []],
    ]);
    expect(report.pages?.[0]?.auditedAfter).toBe('Given I navigate to the "login" page');
    expect(report.pages?.every((p) => (p.results?.passes.length ?? 0) > 0)).toBe(true);
    expect(report.blocking).toBe(report.pages?.[0]?.blocking);
    expect(report.blockingRules).toEqual(['image-alt']);
    expect(d.attached).toEqual(['sdods/a11y-scenario']);
  });

  it('passes every-page when every URL is clean, auditing each distinct URL once', async () => {
    const d = deps({ scope: 'every-page' });
    await d.step('Given I open clean', () => page.goto(`${SITE}/clean`));
    // a step that stays on the page is not a new URL, and a revisit is not audited again
    expect(
      await d.step('Then I see the cart', () => page.getByRole('heading').waitFor()),
    ).toBeUndefined();
    await d.step('When I open other', () => page.goto(`${SITE}/other`));
    expect(await d.step('When I go back', () => page.goto(`${SITE}/clean`))).toBeUndefined();
    const report = await auditScenarioEnd(d.input as never);
    expect(report.pages?.map((p) => p.url)).toEqual([`${SITE}/clean`, `${SITE}/other`]);
    expect(report.pages?.every((p) => p.status === 'audited')).toBe(true);
    expect(report.blocking).toBe(0);
  });

  it('does not count a URL an explicit whole-page step covered, before or after the tag audited it', async () => {
    const before = deps({ scope: 'every-page' });
    markPageAudited(before.scenario, `${SITE}/broken`);
    await flow(before);
    const r1 = await auditScenarioEnd(before.input as never);
    expect(r1.pages?.[0]).toMatchObject({ url: `${SITE}/broken`, status: 'covered-by-step' });
    expect(r1.pages?.[0]?.results).toBeUndefined();
    expect(r1.blocking).toBe(0);

    const after = deps({ scope: 'every-page' });
    await flow(after);
    markPageAudited(after.scenario, `${SITE}/broken`); // the explicit step ran later
    const r2 = await auditScenarioEnd(after.input as never);
    expect(r2.pages?.[0]).toMatchObject({ url: `${SITE}/broken`, status: 'covered-by-step' });
    expect(r2.blocking).toBe(0);
  });

  it('lists a URL left within the step that reached it as not audited, and never audits a failed step', async () => {
    const d = deps({ scope: 'every-page' });
    await d.step('Given I open a page that redirects at once', () =>
      page.goto(`${SITE}/hop`).then(() => page.waitForURL(`${SITE}/clean`)),
    );
    expect(
      await auditAfterStep({ ...d.input, step: 'When it fails', failed: true } as never),
    ).toBeUndefined();
    const report = await auditScenarioEnd(d.input as never);
    expect(report.pages?.map((p) => [p.url, p.status])).toEqual([
      [`${SITE}/hop`, 'not-audited'],
      [`${SITE}/clean`, 'audited'],
    ]);
    expect(report.pages?.[0]?.reason).toContain('within the step');
    expect(report.blocking).toBe(0);
  });

  it('skips a scenario that failed, whatever it audited along the way', async () => {
    const d = deps({ scope: 'every-page' });
    await flow(d);
    const report = await auditScenarioEnd({
      ...d.input,
      testInfo: { status: 'failed', attach: async () => undefined },
    } as never);
    expect(report.status).toBe('skipped');
    expect(report.blocking).toBe(0);
  });
});
