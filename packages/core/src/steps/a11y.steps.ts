import { writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { attachmentNames, scenarioFiles } from '@sdods/contracts';
import './params.js';
import { Then } from '../fixtures/test.js';
import { renderStrict } from '../api/template.js';
import {
  IMPACT_ORDER,
  assertAxeChecked,
  describeViolations,
  markPageAudited,
  parseImpactFloor,
  runAxe,
  violationsAtOrAbove,
  type A11yResults,
} from '../a11y/audit.js';
import { SdodsError } from '../errors.js';
import { Logger } from '../logger.js';

/**
 * Accessibility steps: an axe-core audit plus the structural checks a rule engine cannot see.
 *
 * DESIGN — the browser gathers, node judges. Every DOM probe below returns plain serialisable
 * records and nothing else; the pass/fail decision lives in an exported pure function. That split
 * exists so the one rule that matters here is testable without a browser: a step that quantifies
 * over a set MUST fail when the set is empty. "Every image has an alt" over a page with no images
 * and "no violations" inside a region that does not exist are not passes, they are silence, and
 * silence is what makes an accessibility suite worthless. `assertRegion` and `assertGathered` are
 * the guards, and they throw rather than assert so the message can say what to do instead.
 *
 * WHY NO `heal.*` HERE. The rest of the UI library heals because it resolves ONE interactive
 * element by role/name/text, and a near-miss substitute is still the control the author meant.
 * These steps quantify over a POPULATION inside a region: healing a region selector to a
 * different element would silently re-point the audit at a different set of nodes and report a
 * green result for a surface nobody asked about. A missing region is a defect in the step, so it
 * is reported as one.
 */

// The audit and its judges moved to `../a11y/audit.ts` so the `@a11y` tag hook can share them
// without importing (and so re-registering) this step file. Re-exported for existing importers.
export {
  IMPACT_ORDER,
  WCAG_AA_TAGS,
  assertAxeChecked,
  describeViolations,
  impactRank,
  parseImpactFloor,
  violationsAtOrAbove,
  type A11yResults,
  type A11yViolation,
  type A11yViolationNode,
} from '../a11y/audit.js';

const log = new Logger('a11y');

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

export type RuleBucket = 'violations' | 'passes' | 'incomplete' | 'inapplicable' | 'none';

/** Which of axe's four result buckets a rule landed in. `none` means the rule never ran. */
export function ruleBucket(results: A11yResults, ruleId: string): RuleBucket {
  if (results.violations?.some((r) => r.id === ruleId)) return 'violations';
  if (results.passes?.some((r) => r.id === ruleId)) return 'passes';
  if (results.incomplete?.some((r) => r.id === ruleId)) return 'incomplete';
  if (results.inapplicable?.some((r) => r.id === ruleId)) return 'inapplicable';
  return 'none';
}

/**
 * PROVES a rule-scoped audit was capable of failing. `none` means the rule id does not exist, so
 * the run examined nothing; `inapplicable` means the rule found no matching element, so a green
 * result is silence rather than evidence. Both are reported as defects in the step.
 */
export function assertRuleRan(results: A11yResults, ruleId: string, where: string): RuleBucket {
  const bucket = ruleBucket(results, ruleId);
  if (bucket === 'none')
    throw new SdodsError('CONFIG_INVALID', `axe never ran the rule "${ruleId}".`, {
      hint: 'Check the rule id against https://dequeuniversity.com/rules/axe — a misspelt id reports zero violations and looks like a pass.',
    });
  if (bucket === 'inapplicable')
    throw new SdodsError(
      'RUN_FAILED',
      `axe reported "${ruleId}" inapplicable ${where}: nothing there for it to check.`,
      {
        hint: `A rule with no matching element cannot fail, so this assertion proves nothing. Point the step at a surface that exercises "${ruleId}", or use the whole-page audit instead.`,
      },
    );
  return bucket;
}

/** One record per element the browser gathered, plus whether the scoped region existed at all. */
export interface Gathered<T> {
  regionFound: boolean;
  items: T[];
}

/** PROVES the scoped region exists. A selector matching nothing must fail, never scan the void. */
export function assertRegion<T>(gathered: Gathered<T>, selector: string): T[] {
  if (!gathered.regionFound)
    throw new SdodsError('RUN_FAILED', `No element matches the selector "${selector}".`, {
      hint: 'A region that is absent cannot be audited, and scanning nothing would report a green result. Fix the selector, or wait for the region to render before this step.',
    });
  return gathered.items;
}

/**
 * PROVES the step had something to check. This is the guard the whole library turns on: without
 * it "every image carries an alt" is green on a page with no images, and "no focus indicator is
 * missing" is green on a region with no focusable elements.
 */
export function assertGathered<T>(items: T[], what: string, where: string): T[] {
  if (items.length === 0)
    throw new SdodsError('RUN_FAILED', `Found no ${what} ${where}; nothing was checked.`, {
      hint: `An assertion over an empty set passes without proving anything, so it is reported as a failure. Point the step at a surface that has ${what}, or drop the step.`,
    });
  return items;
}

export interface HeadingRecord {
  level: number;
  text: string;
}

/** Adjacent heading pairs that jump more than one level, described in document order. */
export function headingSkips(headings: HeadingRecord[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1]!;
    const cur = headings[i]!;
    if (cur.level - prev.level > 1)
      out.push(`h${prev.level} "${prev.text}" → h${cur.level} "${cur.text}"`);
  }
  return out;
}

export interface ImageRecord {
  src: string;
  hasAlt: boolean;
}

/**
 * A MISSING alt and `alt=""` are different bugs: the empty one is a decision that the image is
 * decorative, the absent one is an omission. axe's `image-alt` reports only the second, so this
 * judge keeps a distinction the rule blurs.
 */
export function imagesWithoutAlt(images: ImageRecord[]): string[] {
  return images.filter((i) => !i.hasAlt).map((i) => i.src || '(no src)');
}

export interface ControlRecord {
  tag: string;
  text: string;
  name: string;
  html: string;
}

/**
 * An accessible name that still looks like an i18n catalogue key ("nav.workspace.settings") is a
 * `t()` lookup that failed at render time. axe reports that only as a generic missing-name
 * violation, with no hint that the translation catalogue is the cause.
 */
export const RAW_I18N_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

/** Controls that render no text — the ones whose only name is an aria-label or a title. */
export function iconOnlyControls(controls: ControlRecord[]): ControlRecord[] {
  return controls.filter((c) => !c.text.trim());
}

export function unnamedControls(controls: ControlRecord[]): string[] {
  return controls
    .filter((c) => !c.name.trim() || RAW_I18N_KEY.test(c.name.trim()))
    .map(
      (c) =>
        `${c.tag}${c.name.trim() ? ` named "${c.name.trim()}" (raw i18n key)` : ' (no name)'}: ${c.html}`,
    );
}

export interface FocusRecord {
  label: string;
  rest: string;
  focused: string;
}

/** Focusable elements whose computed style is identical focused and unfocused. */
export function focusRingMissing(records: FocusRecord[]): string[] {
  return records.filter((r) => r.rest === r.focused).map((r) => r.label);
}

/* ── browser gatherers (serialised by page.evaluate — no outer references) ─ */

/*
 * TRAP, and the reason the bodies below repeat themselves instead of factoring out a helper:
 * `page.evaluate` ships a function by calling `toString()` on it, so the body must survive
 * transpilation intact. esbuild-based loaders (tsx, tsm, vite-node — how many projects run their
 * Playwright config) compile a NAMED inner function to `__name((el) => …, "sig")`, and the helper
 * `__name` does not exist in the browser. The outer arrow still serialises fine, so this fails at
 * run time with `ReferenceError: __name is not defined` inside a step that type-checks perfectly.
 * Anonymous inline callbacks are untouched; a `const fn = …` inside an evaluate body is not.
 */

/**
 * Visible headings in document order, `h1`–`h6` and `role="heading"` alike, with `aria-level`
 * winning over the tag. `checkVisibility()` is called WITHOUT the opacity check on purpose: a
 * visually-hidden ("sr-only") h1 is a correct, common pattern and still forms the outline.
 */
export const gatherHeadings = (sel: string | null) => {
  const root = sel ? document.querySelector(sel) : document.body;
  if (!root) return { regionFound: false, items: [] as { level: number; text: string }[] };
  const out: { level: number; text: string }[] = [];
  const nodes = root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (el.closest('[aria-hidden="true"]')) continue;
    const check = (el as unknown as { checkVisibility?: () => boolean }).checkVisibility;
    const visible = typeof check === 'function' ? check.call(el) : el.getClientRects().length > 0;
    if (!visible) continue;
    const aria = el.getAttribute('aria-level');
    const tagMatch = /^H([1-6])$/.exec(el.tagName);
    const level = aria ? Number(aria) : tagMatch ? Number(tagMatch[1]) : 2;
    if (!Number.isFinite(level) || level < 1) continue;
    out.push({ level, text: (el.textContent || '').trim().slice(0, 60) });
  }
  return { regionFound: true, items: out };
};

/** Every `<img>` in scope with whether it carries an alt ATTRIBUTE (empty counts as present). */
export const gatherImages = (sel: string | null) => {
  const root = sel ? document.querySelector(sel) : document.body;
  if (!root) return { regionFound: false, items: [] as { src: string; hasAlt: boolean }[] };
  const out: { src: string; hasAlt: boolean }[] = [];
  const nodes = root.querySelectorAll('img');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLImageElement;
    out.push({ src: (el.getAttribute('src') || '').slice(0, 120), hasAlt: el.hasAttribute('alt') });
  }
  return { regionFound: true, items: out };
};

/**
 * Visible controls in scope with their rendered text and their accessible name. The name is
 * resolved the way a screen reader does — aria-label, then aria-labelledby, then title, then a
 * contained `img[alt]`, then an `<svg><title>` — because reading only aria-label (as a naive
 * probe does) flags every correctly-labelled icon button that uses one of the other four.
 *
 * TRAP: text is read with `innerText`, not `textContent`. An `<svg><title>` is part of
 * `textContent` but is never painted, so a genuinely icon-only button named through its SVG title
 * would look like a button that renders a label and drop out of the audit entirely.
 */
export const gatherControls = (sel: string) => {
  const root = document.querySelector(sel);
  if (!root)
    return {
      regionFound: false,
      items: [] as { tag: string; text: string; name: string; html: string }[],
    };
  const out: { tag: string; text: string; name: string; html: string }[] = [];
  const nodes = root.querySelectorAll('button,a[href],[role="button"],[role="link"]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    const check = (el as unknown as { checkVisibility?: (o?: unknown) => boolean }).checkVisibility;
    const visible =
      typeof check === 'function'
        ? check.call(el, { checkVisibilityCSS: true, checkOpacity: true })
        : el.getClientRects().length > 0;
    if (!visible) continue;
    let name = (el.getAttribute('aria-label') || '').trim();
    if (!name) {
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      name = ids
        .map((id) => (document.getElementById(id)?.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
    }
    if (!name) name = (el.getAttribute('title') || '').trim();
    if (!name) name = (el.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
    if (!name) name = (el.querySelector('svg title')?.textContent || '').trim();
    out.push({
      tag: el.tagName.toLowerCase(),
      text: (typeof el.innerText === 'string' ? el.innerText : el.textContent || '').trim(),
      name,
      html: el.outerHTML.slice(0, 120),
    });
  }
  return { regionFound: true, items: out };
};

/**
 * Computed style of every visible focusable in scope, at rest and while focused.
 *
 * TRAP: modern apps style `:focus-visible` only, and the browser matches that pseudo-class from
 * the user's last INTERACTION modality, not from the `focus()` call. Measured across Chromium,
 * Firefox and WebKit: after any real mouse click, EVERY `:focus-visible`-styled control reports
 * an unchanged style — a total false failure on a perfectly accessible page. The step therefore
 * presses Tab first to restore keyboard modality; Tab is the only key that does so in all three
 * engines (Shift restores it in Chromium only, ArrowRight in Chromium and WebKit only).
 *
 * That Tab press lands focus on an element, which is the second half of the trap: sampling that
 * element's resting style while it is focused reports no change and accuses it wrongly. Hence the
 * guard below. Programmatic focus keeps the keyboard modality alive, so moving focus to a sibling
 * is safe; `blur()` is the fallback for a region holding a single control.
 *
 * `checkVisibility` replaces the `offsetParent !== null` idiom, which reports `null` for any
 * `position: fixed` element and would silently drop every floating control from the audit.
 */
export const gatherFocusIndicators = (sel: string) => {
  const root = document.querySelector(sel);
  if (!root)
    return { regionFound: false, items: [] as { label: string; rest: string; focused: string }[] };
  const out: { label: string; rest: string; focused: string }[] = [];
  const nodes = root.querySelectorAll(
    'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
  );
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue;
    const check = (el as unknown as { checkVisibility?: (o?: unknown) => boolean }).checkVisibility;
    const visible =
      typeof check === 'function'
        ? check.call(el, { checkVisibilityCSS: true, checkOpacity: true })
        : el.getClientRects().length > 0;
    if (!visible) continue;
    // The Tab press that restored keyboard modality landed focus on SOME element, possibly this
    // one. Sampling its resting style while it is already focused yields an identical signature
    // and accuses a perfectly ringed control. Move focus to a sibling first — programmatic focus
    // keeps keyboard modality alive; blur() is the last resort for a region with one control.
    if (document.activeElement === el) {
      for (let j = 0; j < nodes.length; j++) {
        if (nodes[j] !== el) {
          (nodes[j] as HTMLElement).focus();
          break;
        }
      }
      if (document.activeElement === el) el.blur();
    }
    const a = getComputedStyle(el);
    const rest = [
      a.outlineStyle,
      a.outlineWidth,
      a.outlineColor,
      a.outlineOffset,
      a.boxShadow,
      a.borderColor,
      a.borderWidth,
      a.backgroundColor,
      a.color,
      a.textDecorationLine,
      a.filter,
    ].join('|');
    el.focus();
    const b = getComputedStyle(el);
    const focused = [
      b.outlineStyle,
      b.outlineWidth,
      b.outlineColor,
      b.outlineOffset,
      b.boxShadow,
      b.borderColor,
      b.borderWidth,
      b.backgroundColor,
      b.color,
      b.textDecorationLine,
      b.filter,
    ].join('|');
    out.push({
      label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60),
      rest,
      focused,
    });
  }
  return { regionFound: true, items: out };
};

/**
 * Writes the full axe result next to the scenario and attaches it under `sdods/a11y/<step>`.
 * Always attached, pass or fail: on a failure it is what makes the verdict diagnosable, and on a
 * pass it is the evidence that the audit examined something.
 */
function attachA11y(
  deps: {
    scenario: { file(rel: string): string };
    testInfo: { attach(name: string, opts: { path: string; contentType: string }): Promise<void> };
    stepIndex: number;
  },
  results: A11yResults,
): void {
  try {
    const file = deps.scenario.file(scenarioFiles.a11yJson(deps.stepIndex));
    writeFileSync(file, JSON.stringify(results, null, 2));
    void deps.testInfo.attach(attachmentNames.a11y(deps.stepIndex), {
      path: file,
      contentType: 'application/json',
    });
  } catch (e) {
    log.debug(`could not attach a11y result: ${(e as Error).message}`);
  }
}

/** Region existence check for the axe steps, which need the SELECTOR (not a healed locator). */
async function requireRegion(page: Page, selector: string): Promise<void> {
  const count = await page.locator(selector).count();
  if (count === 0)
    throw new SdodsError('RUN_FAILED', `No element matches the selector "${selector}".`, {
      hint: 'axe would scan an empty context and report zero violations, which reads as a pass. Fix the selector, or wait for the region to render before this step.',
    });
}

/* ── axe audits ────────────────────────────────────────────────────────── */

/**
 * PROVES the page carries no WCAG 2.x A/AA violation that axe can detect automatically.
 * Roughly a third of WCAG is machine-checkable, so a pass is a floor, never a certificate.
 */
Then(
  'the page should have no accessibility violations',
  async ({ page, scenario, $bddContext, $testInfo }) => {
    const results = await runAxe(page, {});
    markPageAudited(scenario, page.url());
    attachA11y({ scenario, testInfo: $testInfo, stepIndex: $bddContext.stepIndex }, results);
    assertAxeChecked(results, `on ${page.url()}`);
    expect(
      results.violations.length,
      `${results.violations.length} WCAG A/AA violation(s) on ${page.url()}:\n${describeViolations(results.violations)}`,
    ).toBe(0);
  },
);

/**
 * PROVES one region of the page is clean, so a shared component can be audited without the rest
 * of the page's debt masking or drowning it. Fails when the selector matches nothing: axe scans
 * an empty context happily and reports zero violations, which is indistinguishable from a pass.
 */
Then(
  'the page should have no accessibility violations within {string}',
  async ({ page, scenario, apiContext, env, $bddContext, $testInfo }, selector: string) => {
    const sel = renderStrict(selector, ...scopesOf(apiContext, env));
    await requireRegion(page, sel);
    const results = await runAxe(page, { include: sel });
    attachA11y({ scenario, testInfo: $testInfo, stepIndex: $bddContext.stepIndex }, results);
    assertAxeChecked(results, `within "${sel}"`);
    expect(
      results.violations.length,
      `${results.violations.length} WCAG A/AA violation(s) within "${sel}" on ${page.url()}:\n${describeViolations(results.violations)}`,
    ).toBe(0);
  },
);

/**
 * PROVES nothing at or above a chosen severity is present, so a team can adopt a11y gating with a
 * critical-only bar and tighten it later. An invented level is rejected rather than matching
 * nothing — "or worse than banana" would otherwise be the greenest step in the suite.
 */
Then(
  'the page should have no accessibility violations of impact {string} or worse',
  async ({ page, scenario, apiContext, env, $bddContext, $testInfo }, level: string) => {
    const floor = parseImpactFloor(renderStrict(level, ...scopesOf(apiContext, env)));
    const results = await runAxe(page, {});
    markPageAudited(scenario, page.url());
    attachA11y({ scenario, testInfo: $testInfo, stepIndex: $bddContext.stepIndex }, results);
    assertAxeChecked(results, `on ${page.url()}`);
    const blocking = violationsAtOrAbove(results.violations, floor);
    expect(
      blocking.length,
      `${blocking.length} violation(s) at ${IMPACT_ORDER[floor]}+ on ${page.url()} (of ${results.violations.length} total):\n${describeViolations(blocking)}`,
    ).toBe(0);
  },
);

/** PROVES a region carries no violation at or above a severity — the scoped form of the above. */
Then(
  'the page should have no accessibility violations of impact {string} or worse within {string}',
  async (
    { page, scenario, apiContext, env, $bddContext, $testInfo },
    level: string,
    selector: string,
  ) => {
    const scopes = scopesOf(apiContext, env);
    const floor = parseImpactFloor(renderStrict(level, ...scopes));
    const sel = renderStrict(selector, ...scopes);
    await requireRegion(page, sel);
    const results = await runAxe(page, { include: sel });
    attachA11y({ scenario, testInfo: $testInfo, stepIndex: $bddContext.stepIndex }, results);
    assertAxeChecked(results, `within "${sel}"`);
    const blocking = violationsAtOrAbove(results.violations, floor);
    expect(
      blocking.length,
      `${blocking.length} violation(s) at ${IMPACT_ORDER[floor]}+ within "${sel}" on ${page.url()}:\n${describeViolations(blocking)}`,
    ).toBe(0);
  },
);

/**
 * PROVES one named axe rule holds on this page. Isolating a rule keeps a targeted regression
 * ("labels came back") legible instead of buried in a forty-violation dump.
 *
 * TRAP: a misspelt rule id and a rule with nothing to check BOTH report zero violations. This
 * step fails on either, because a rule that never ran cannot have passed.
 */
Then(
  'the page should have no accessibility violations of rule {string}',
  async ({ page, scenario, apiContext, env, $bddContext, $testInfo }, ruleId: string) => {
    const rule = renderStrict(ruleId, ...scopesOf(apiContext, env));
    const results = await runAxe(page, { rules: [rule] });
    attachA11y({ scenario, testInfo: $testInfo, stepIndex: $bddContext.stepIndex }, results);
    const bucket = assertRuleRan(results, rule, `on ${page.url()}`);
    const violations = results.violations.filter((v) => v.id === rule);
    expect(
      violations.length,
      `${violations.length} "${rule}" violation(s) on ${page.url()} (axe bucket: ${bucket}):\n${describeViolations(violations)}`,
    ).toBe(0);
  },
);

/**
 * PROVES text on this page meets the WCAG AA contrast ratio. Kept separate from the full audit
 * because a brand-palette or dark-mode change must fail ON CONTRAST rather than disappearing into
 * a general violation list — contrast is the single most common finding, and the one most often
 * introduced by a change that touched no markup at all.
 */
Then(
  'the page should have no colour-contrast violations',
  async ({ page, scenario, $bddContext, $testInfo }) => {
    const results = await runAxe(page, { rules: ['color-contrast'] });
    attachA11y({ scenario, testInfo: $testInfo, stepIndex: $bddContext.stepIndex }, results);
    const bucket = assertRuleRan(results, 'color-contrast', `on ${page.url()}`);
    expect(
      results.violations.length,
      `${results.violations.length} colour-contrast violation(s) on ${page.url()} (axe bucket: ${bucket}; "incomplete" means axe could not read the background, e.g. text over an image):\n${describeViolations(results.violations)}`,
    ).toBe(0);
  },
);

/** PROVES one region's text meets AA contrast — for auditing a themed component in isolation. */
Then(
  'the page should have no colour-contrast violations within {string}',
  async ({ page, scenario, apiContext, env, $bddContext, $testInfo }, selector: string) => {
    const sel = renderStrict(selector, ...scopesOf(apiContext, env));
    await requireRegion(page, sel);
    const results = await runAxe(page, { include: sel, rules: ['color-contrast'] });
    attachA11y({ scenario, testInfo: $testInfo, stepIndex: $bddContext.stepIndex }, results);
    const bucket = assertRuleRan(results, 'color-contrast', `within "${sel}"`);
    expect(
      results.violations.length,
      `${results.violations.length} colour-contrast violation(s) within "${sel}" on ${page.url()} (axe bucket: ${bucket}):\n${describeViolations(results.violations)}`,
    ).toBe(0);
  },
);

/* ── structure axe cannot judge ────────────────────────────────────────── */

/**
 * PROVES the document has exactly one top-level heading. Zero leaves a screen-reader user with no
 * landmark for "what is this page"; two or more make the outline ambiguous. axe's `page-has-h1`
 * is a best-practice rule (excluded from the A/AA audit above by design), and neither it nor any
 * WCAG rule catches the duplicate case.
 */
Then('the page should have exactly one level-1 heading', async ({ page }) => {
  const gathered = await page.evaluate(gatherHeadings, null);
  const level1 = gathered.items.filter((h) => h.level === 1);
  expect(
    level1.length,
    `expected exactly one level-1 heading, found ${level1.length} of ${gathered.items.length} heading(s): ${JSON.stringify(level1.map((h) => h.text))}`,
  ).toBe(1);
});

/**
 * PROVES the heading outline is navigable: no jump from h2 straight to h4, which is how a screen
 * reader user loses a whole section. Headings are read as rendered, so a level chosen by CSS
 * appearance rather than semantics shows up here.
 *
 * Fails when the page has NO heading at all — an empty outline is the strongest version of this
 * defect, and a step that quantifies over no headings would report it as a pass.
 */
Then('the heading levels should not skip a level', async ({ page }) => {
  const gathered = await page.evaluate(gatherHeadings, null);
  const headings = assertGathered(gathered.items, 'headings', `on ${page.url()}`);
  const skips = headingSkips(headings);
  expect(
    skips.length,
    `skipped heading level(s) across ${headings.length} heading(s) on ${page.url()}: ${skips.join(', ')}`,
  ).toBe(0);
});

/**
 * PROVES every image declares its alt text intent. Fails on a page with no images: the brief that
 * this library exists to answer named exactly that case — "every image has alt" over an empty set
 * is the archetype of an assertion that cannot fail.
 */
Then('every image on the page should carry an alt attribute', async ({ page }) => {
  const gathered = await page.evaluate(gatherImages, null);
  const images = assertGathered(gathered.items, 'img elements', `on ${page.url()}`);
  const missing = imagesWithoutAlt(images);
  expect(
    missing.length,
    `${missing.length} of ${images.length} img element(s) have no alt attribute: ${missing.join(', ')}`,
  ).toBe(0);
});

/** PROVES every image inside one region declares its alt intent — the scoped form of the above. */
Then(
  'every image within {string} should carry an alt attribute',
  async ({ page, apiContext, env }, selector: string) => {
    const sel = renderStrict(selector, ...scopesOf(apiContext, env));
    const gathered = await page.evaluate(gatherImages, sel);
    const images = assertGathered(assertRegion(gathered, sel), 'img elements', `within "${sel}"`);
    const missing = imagesWithoutAlt(images);
    expect(
      missing.length,
      `${missing.length} of ${images.length} img element(s) within "${sel}" have no alt attribute: ${missing.join(', ')}`,
    ).toBe(0);
  },
);

/**
 * PROVES every icon-only button or link in a region announces itself. An icon with no name is
 * simply "button" to a screen reader.
 *
 * TRAP: a name that is still a raw i18n catalogue key ("nav.settings") is counted as missing. Those
 * aria-labels resolve at render time, and a catalogue key that failed to resolve renders the key
 * itself — axe sees a non-empty name and passes it.
 */
Then(
  'every icon-only control within {string} should expose an accessible name',
  async ({ page, apiContext, env }, selector: string) => {
    const sel = renderStrict(selector, ...scopesOf(apiContext, env));
    const gathered = await page.evaluate(gatherControls, sel);
    const controls = assertRegion(gathered, sel);
    const iconOnly = assertGathered(
      iconOnlyControls(controls),
      'icon-only controls',
      `within "${sel}" (${controls.length} control(s) there render text)`,
    );
    const bad = unnamedControls(iconOnly);
    expect(
      bad.length,
      `${bad.length} of ${iconOnly.length} icon-only control(s) within "${sel}" have a missing or unresolved accessible name:\n${bad.join('\n')}`,
    ).toBe(0);
  },
);

/**
 * PROVES a keyboard user can see where they are inside a region (WCAG 2.2 AA 2.4.11/2.4.13). A
 * focus ring removed by a CSS reset is invisible to axe, which reads the accessibility tree and
 * never the painted style, so this is checked by comparing computed style at rest and focused.
 *
 * TRAP: `:focus-visible`-only styling (the Tailwind/shadcn default) matches on the last
 * interaction MODALITY, not on the focus() call, so the walk is preceded by a real Tab press to
 * enter keyboard modality and never blurs between elements.
 */
Then(
  'every focusable element within {string} should show a visible focus indicator',
  async ({ page, apiContext, env }, selector: string) => {
    const sel = renderStrict(selector, ...scopesOf(apiContext, env));
    await page.keyboard.press('Tab');
    const gathered = await page.evaluate(gatherFocusIndicators, sel);
    const focusables = assertGathered(
      assertRegion(gathered, sel),
      'focusable elements',
      `within "${sel}"`,
    );
    const bad = focusRingMissing(focusables);
    expect(
      bad.length,
      `${bad.length} of ${focusables.length} focusable element(s) within "${sel}" show no computed style change when focused: ${bad.join(', ')}`,
    ).toBe(0);
  },
);
