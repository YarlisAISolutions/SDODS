import { expect, type Locator, type Page } from '@playwright/test';
import './params.js';
import { Then, When } from '../fixtures/test.js';
import { render } from '../api/template.js';
import type { AriaRole } from '../heal/types.js';
import { SdodsError } from '../errors.js';

/**
 * DOM assertions the rest of the library cannot express.
 *
 * The library ships exactly one negative UI step (`I should not see the text`), so the deny
 * direction of an authorisation scenario — the only direction worth asserting against a
 * default-allow policy — is unwritable. These steps close that, plus the ordinal, counting,
 * focus and overlay vocabulary that a real onboarding had to hand-write.
 *
 * Two conventions hold throughout this file, both of them load-bearing:
 *
 * 1. EVERY string argument goes through `render()`, ids and role names included. A step that
 *    silently drops `{{vars}}` fails much later, in a scenario that looks unrelated; rendering a
 *    string with no placeholder in it is a no-op, so there is no cost to doing it everywhere.
 *
 * 2. Self-healing is applied on the ALLOW direction only — "this control is present / enabled /
 *    checked" — on the same terms as the built-in visibility assertion, where a heal onto a moved
 *    control keeps a true scenario green. It is withheld on the DENY direction, because a heal
 *    onto a similarly named element that happens to be disabled would manufacture the very pass
 *    an authorisation scenario exists to disprove. Ordinals and counts are never healed at all:
 *    healing rewrites the selector wholesale, which would silently renumber the match an ordinal
 *    points at, and change the population a count is over.
 */

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

/** Any open modal surface, in any of the three shapes React overlay libraries emit. */
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

/**
 * Radix/shadcn poppers, plus anything that declares itself a tooltip. Portalled overlays render
 * OUTSIDE the trigger's DOM subtree, so a locator scoped to the trigger misses them entirely.
 */
const POPOVER_SELECTOR =
  '[data-radix-popper-content-wrapper], [data-testid="popover-content"], [role="tooltip"]';

/** Everything the browser will stop on for a Tab press. Disabled controls are skipped. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Bound on the keyboard walk, so a region that is unreachable fails instead of hanging. */
const MAX_TAB_STOPS = 40;

/* ── shared helpers ───────────────────────────────────────────────────── */

/**
 * 1-based ordinals, validated. Playwright reads `nth(-1)` as "the last match", so an unchecked
 * `at position 0` would quietly assert against the WRONG element and pass — the exact class of
 * silent-pass this file exists to remove.
 */
function indexOfPosition(position: number, what: string): number {
  if (!Number.isInteger(position) || position < 1) {
    throw new SdodsError('RUN_FAILED', `"${position}" is not a valid position for ${what}.`, {
      hint: 'Positions are 1-based: the first match is position 1. Playwright treats a negative index as "the last match", so 0 or below would assert against the wrong element rather than failing.',
    });
  }
  return position - 1;
}

/** A count floor of 0 is satisfied by every page ever rendered — refuse it rather than lie. */
function assertMeaningfulFloor(count: number, what: string): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new SdodsError('RUN_FAILED', `"at least ${count}" is not an assertion about ${what}.`, {
      hint: 'An "at least 0" check passes on a blank page. Use "should have exactly 0 matches" or a "should not exist" step if absence is what you mean.',
    });
  }
}

function assertPositiveDuration(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new SdodsError('RUN_FAILED', `"${seconds}" is not a duration to hold an assertion for.`, {
      hint: 'Hold windows are whole seconds, 1 or more — a 0-second window is the plain assertion, which is what this step exists to strengthen.',
    });
  }
}

/** Fails naming the shortfall, rather than letting `nth()` time out against nothing. */
async function expectAtLeast(locator: Locator, wanted: number, what: string): Promise<void> {
  await expect
    .poll(async () => locator.count(), { message: `expected at least ${wanted} ${what}` })
    .toBeGreaterThanOrEqual(wanted);
}

interface FocusInfo {
  /** False when focus sits on `<body>` — i.e. nothing is really focused. */
  focused: boolean;
  tag: string;
  name: string;
  rendered: boolean;
  insideDialog: boolean;
  dialogPresent: boolean;
}

/**
 * Reads the focused element in one round trip. The `focused` flag exists because
 * `document.activeElement` defaults to `<body>`: treating that as "the focused element" makes
 * every "focus should be named X" assertion match the whole page's text, which passes for
 * essentially any X. Body focus is reported as no focus.
 */
async function readFocus(page: Page): Promise<FocusInfo> {
  return page.evaluate((dialogSelector) => {
    const el = document.activeElement as HTMLElement | null;
    const dialogPresent = Boolean(document.querySelector(dialogSelector));
    const isReal = Boolean(el) && el !== document.body && el !== document.documentElement;
    if (!el || !isReal) {
      return {
        focused: false,
        tag: el ? el.tagName.toLowerCase() : 'none',
        name: '',
        rendered: false,
        insideDialog: false,
        dialogPresent,
      };
    }
    const name = [
      el.getAttribute('aria-label') ?? '',
      el.getAttribute('title') ?? '',
      el.getAttribute('placeholder') ?? '',
      el.getAttribute('alt') ?? '',
      (el.innerText || el.textContent || '').trim(),
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      focused: true,
      tag: el.tagName.toLowerCase(),
      name,
      rendered:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0,
      insideDialog: Boolean(el.closest(dialogSelector)),
      dialogPresent,
    };
  }, DIALOG_SELECTOR);
}

/**
 * Every rendered string a human could read off the page: the visible text plus the values and
 * text-bearing attributes of rendered controls. Strictly wider than `getByText`, which sees no
 * input value, placeholder, title or alt text at all — so a leaked address sitting in a filled
 * field passes `I should not see the text` while being plainly on screen.
 */
async function readableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.body;
    if (!body) return '';
    const parts: string[] = [body.innerText || ''];
    const attrs = ['title', 'aria-label', 'placeholder', 'alt', 'value'];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.getClientRects().length === 0) continue;
      const control = el as HTMLInputElement;
      if (typeof control.value === 'string' && control.value) parts.push(control.value);
      for (const attr of attrs) {
        const v = el.getAttribute(attr);
        if (v) parts.push(v);
      }
    }
    return parts.join('\n').replace(/\s+/g, ' ').trim();
  });
}

interface DomScratch {
  focusWalk?: boolean[];
}

/** Per-scenario scratch, keyed on the test-scoped apiContext so nothing leaks between runs. */
const scratch = new WeakMap<object, DomScratch>();
function bag(key: object): DomScratch {
  let existing = scratch.get(key);
  if (!existing) {
    existing = {};
    scratch.set(key, existing);
  }
  return existing;
}

/* ── negative visibility and existence ────────────────────────────────── */

// Proves the element is not on screen. Passes when it is absent too, because "a user cannot see
// it" is the invariant — use the "should not exist" form when the DOM node itself is the point.
Then(
  'the element with test id {string} should not be visible',
  async ({ page, apiContext, env }, id: string) => {
    await expect(page.getByTestId(render(id, ...scopesOf(apiContext, env)))).toBeHidden();
  },
);

// Proves the node was never rendered — not merely hidden with CSS. The distinction is the point of
// a deny: a control the server refused to send is a different posture from one the client chose
// not to paint, which is one CSS toggle or one devtools edit away from being usable.
Then(
  'the element with test id {string} should not exist',
  async ({ page, apiContext, env }, id: string) => {
    await expect(page.getByTestId(render(id, ...scopesOf(apiContext, env)))).toHaveCount(0);
  },
);

// Proves a named control is not on screen — the deny half of `the {string} {role} should be
// visible`, which had no counterpart.
Then(
  'the {string} {role} should not be visible',
  async ({ page, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    await expect(page.getByRole(role as AriaRole, { name: n })).toBeHidden();
  },
);

// Proves the app rendered no such control at all. Distinct from "not visible": this is what an
// authorisation scenario wants when the claim is that the affordance was never offered.
Then(
  'no {string} {role} should exist',
  async ({ page, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    await expect(page.getByRole(role as AriaRole, { name: n })).toHaveCount(0);
  },
);

// Proves the absence is the SETTLED state, not the loading state. This is the trap that makes
// plain absence assertions untrustworthy: a permissions hook that reports "no" while its fetch is
// in flight renders the same empty surface for an admin as for a viewer, so a single-shot check
// passes for everyone as long as it lands first. Holding it across a window outlives the fetch.
Then(
  'the {string} {role} should stay absent for {int} seconds',
  async ({ page, apiContext, env }, name: string, role: string, seconds: number) => {
    assertPositiveDuration(seconds);
    const n = render(name, ...scopesOf(apiContext, env));
    const locator = page.getByRole(role as AriaRole, { name: n });
    const deadline = Date.now() + seconds * 1000;
    do {
      await expect(locator, `"${n}" ${role} appeared during the ${seconds}s hold`).toHaveCount(0, {
        timeout: 1000,
      });
      await page.waitForTimeout(250);
    } while (Date.now() < deadline);
  },
);

/* ── text anywhere on the page ────────────────────────────────────────── */

// Proves the string reached the user by ANY rendered route — visible text, an input's value, a
// placeholder, a title or alt. `I should see the text` resolves through `getByText`, which reads
// text nodes only, so a value prefilled into a field is invisible to it.
Then(
  'the text {string} should appear anywhere on the page',
  async ({ page, apiContext, env }, text: string) => {
    const wanted = render(text, ...scopesOf(apiContext, env));
    await expect
      .poll(async () => readableText(page), { message: `page never rendered "${wanted}"` })
      .toContain(wanted);
  },
);

// Proves the string leaked nowhere — the assertion a data-isolation or redaction scenario needs,
// and stronger than `I should not see the text` for the same reason as above.
// The blank-page guard is the point: on a surface that rendered nothing this check would pass for
// every string in existence, which is the vacuous pass this library refuses to ship.
Then(
  'the text {string} should not appear anywhere on the page',
  async ({ page, apiContext, env }, text: string) => {
    const unwanted = render(text, ...scopesOf(apiContext, env));
    const haystack = await readableText(page);
    if (haystack.length === 0) {
      throw new SdodsError('RUN_FAILED', 'The page has rendered no readable text at all.', {
        hint: `Asserting that "${unwanted}" is absent from an empty page proves nothing. Wait for the surface to render first — e.g. assert something that SHOULD be there.`,
      });
    }
    expect(haystack, `"${unwanted}" is rendered somewhere on this page`).not.toContain(unwanted);
  },
);

/* ── enabled / disabled / checked ─────────────────────────────────────── */

// Proves the control is offered AND actionable. Healed, on the same terms as the built-in
// visibility assertion — this is the allow direction. The deny direction below is not healed.
Then(
  'the {string} {role} should be enabled',
  async ({ page, heal, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    const locator = await heal.resolve(
      page.getByRole(role as AriaRole, { name: n }),
      { role: role as AriaRole, name: n, text: n, description: `${role} "${n}"` },
      'assert',
    );
    await expect(locator).toBeEnabled();
  },
);

// Proves the control is rendered but refuses to act. NOT healed, deliberately: this is a deny
// assertion, and healing onto a different, disabled element would fabricate the pass.
Then(
  'the {string} {role} should be disabled',
  async ({ page, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    await expect(page.getByRole(role as AriaRole, { name: n })).toBeDisabled();
  },
);

// Proves the disabled state is the settled one. `toBeDisabled()` retries until it passes, so a
// permissions hook that answers "no" for every role while it loads makes a plain check pass for an
// admin too — as long as the first poll lands before the fetch resolves. The hold outlives it.
Then(
  'the {string} {role} should stay disabled for {int} seconds',
  async ({ page, apiContext, env }, name: string, role: string, seconds: number) => {
    assertPositiveDuration(seconds);
    const n = render(name, ...scopesOf(apiContext, env));
    const locator = page.getByRole(role as AriaRole, { name: n });
    const deadline = Date.now() + seconds * 1000;
    do {
      await expect(
        locator,
        `"${n}" ${role} became enabled during the ${seconds}s hold`,
      ).toBeDisabled({
        timeout: 1000,
      });
      await page.waitForTimeout(250);
    } while (Date.now() < deadline);
  },
);

// Proves a denied action is not actionable, without pinning WHICH shape the denial takes. A
// destructive action legitimately renders either way depending on the surface — hidden on one,
// greyed on another — and pinning one makes the scenario brittle without making it stronger.
// Known weakness, stated rather than hidden: the absent branch is satisfied by a surface that has
// not rendered yet. Where that race is plausible, use "should stay absent for {int} seconds".
Then(
  'the {string} {role} should be absent or disabled',
  async ({ page, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    const locator = page.getByRole(role as AriaRole, { name: n });
    if ((await locator.count()) === 0) return;
    await expect(locator.first()).toBeDisabled();
  },
);

// Proves an element addressed by test id is actionable.
Then(
  'the element with test id {string} should be enabled',
  async ({ page, heal, apiContext, env }, id: string) => {
    const testId = render(id, ...scopesOf(apiContext, env));
    const locator = await heal.resolve(
      page.getByTestId(testId),
      { testId, description: `test id "${testId}"` },
      'assert',
    );
    await expect(locator).toBeEnabled();
  },
);

// Proves an element addressed by test id is rendered but inert. Not healed — deny direction.
Then(
  'the element with test id {string} should be disabled',
  async ({ page, apiContext, env }, id: string) => {
    await expect(page.getByTestId(render(id, ...scopesOf(apiContext, env)))).toBeDisabled();
  },
);

// Proves a test-id-addressed action is not actionable, in whichever shape the denial took.
Then(
  'the element with test id {string} should be absent or disabled',
  async ({ page, apiContext, env }, id: string) => {
    const locator = page.getByTestId(render(id, ...scopesOf(apiContext, env)));
    if ((await locator.count()) === 0) return;
    await expect(locator.first()).toBeDisabled();
  },
);

// Proves an opt-in is on.
Then(
  'the {string} checkbox should be checked',
  async ({ page, heal, apiContext, env }, label: string) => {
    const l = render(label, ...scopesOf(apiContext, env));
    const locator = await heal.resolve(
      page.getByLabel(l),
      { label: l, role: 'checkbox', name: l, description: `${l} checkbox` },
      'assert',
    );
    await expect(locator).toBeChecked();
  },
);

// Proves an opt-in defaults OFF — a default-on "trust this device" silently extends a session's
// blast radius, and "the control exists" does not catch that. Playwright already refuses to
// resolve `not.toBeChecked()` against a missing or ambiguous locator, so the count check buys no
// extra safety; what it buys is the failure MESSAGE — "no such checkbox is rendered" rather than a
// retry timeout that reads as though the assertion itself were wrong.
Then(
  'the {string} checkbox should not be checked',
  async ({ page, apiContext, env }, label: string) => {
    const l = render(label, ...scopesOf(apiContext, env));
    const locator = page.getByLabel(l);
    await expect(locator, `no "${l}" checkbox is rendered`).toHaveCount(1);
    await expect(locator).not.toBeChecked();
  },
);

/* ── ordinal selection ────────────────────────────────────────────────── */
//
// Every step here exists because Playwright's strict mode refuses to act on an ambiguous locator:
// a sidebar with two project rows renders two identical triggers, and the built-in step fails on
// the ambiguity rather than acting on one. None of them heal — see the file header.

// Proves the first of several identical elements is clickable, on a surface where the built-in
// step can only report ambiguity.
When(
  'I click the first element with test id {string}',
  async ({ page, apiContext, env }, id: string) => {
    const testId = render(id, ...scopesOf(apiContext, env));
    const locator = page.getByTestId(testId);
    await expectAtLeast(locator, 1, `elements with test id "${testId}"`);
    await locator.first().click();
  },
);

// Proves a specific row of a repeated list is reachable — the assertion a list scenario needs
// before it can act on row 2 at all.
When(
  'I click the element with test id {string} at position {int}',
  async ({ page, apiContext, env }, id: string, position: number) => {
    const testId = render(id, ...scopesOf(apiContext, env));
    const index = indexOfPosition(position, `elements with test id "${testId}"`);
    const locator = page.getByTestId(testId);
    await expectAtLeast(locator, position, `elements with test id "${testId}"`);
    await locator.nth(index).click();
  },
);

// Proves the first of several same-named controls is clickable.
When(
  'I click the first {string} {role}',
  async ({ page, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    const locator = page.getByRole(role as AriaRole, { name: n });
    await expectAtLeast(locator, 1, `"${n}" ${role} elements`);
    await locator.first().click();
  },
);

// Proves a specific one of several same-named controls is clickable.
When(
  'I click the {string} {role} at position {int}',
  async ({ page, apiContext, env }, name: string, role: string, position: number) => {
    const n = render(name, ...scopesOf(apiContext, env));
    const index = indexOfPosition(position, `"${n}" ${role} elements`);
    const locator = page.getByRole(role as AriaRole, { name: n });
    await expectAtLeast(locator, position, `"${n}" ${role} elements`);
    await locator.nth(index).click();
  },
);

// Proves the first of several identical fields accepts input.
When(
  'I fill the first element with test id {string} with {string}',
  async ({ page, apiContext, env }, id: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    const testId = render(id, ...scopes);
    const locator = page.getByTestId(testId);
    await expectAtLeast(locator, 1, `elements with test id "${testId}"`);
    await locator.first().fill(render(value, ...scopes));
  },
);

// Proves a specific row's field accepts input — editing row 3 of a repeated editor.
When(
  'I fill the element with test id {string} at position {int} with {string}',
  async ({ page, apiContext, env }, id: string, position: number, value: string) => {
    const scopes = scopesOf(apiContext, env);
    const testId = render(id, ...scopes);
    const index = indexOfPosition(position, `elements with test id "${testId}"`);
    const locator = page.getByTestId(testId);
    await expectAtLeast(locator, position, `elements with test id "${testId}"`);
    await locator.nth(index).fill(render(value, ...scopes));
  },
);

// Proves at least one such element rendered, where the built-in visibility step would report a
// strict-mode violation instead of an answer.
Then(
  'the first element with test id {string} should be visible',
  async ({ page, apiContext, env }, id: string) => {
    await expect(page.getByTestId(render(id, ...scopesOf(apiContext, env))).first()).toBeVisible();
  },
);

// Proves the Nth repeat rendered — i.e. that the list is at least N long AND that entry is shown.
Then(
  'the element with test id {string} at position {int} should be visible',
  async ({ page, apiContext, env }, id: string, position: number) => {
    const testId = render(id, ...scopesOf(apiContext, env));
    const index = indexOfPosition(position, `elements with test id "${testId}"`);
    await expect(
      page.getByTestId(testId).nth(index),
      `no element with test id "${testId}" at position ${position}`,
    ).toBeVisible();
  },
);

// Proves the Nth repeat carries the expected content — the row-level assertion that makes an
// ordering or pagination scenario mean something.
Then(
  'the element with test id {string} at position {int} should contain {string}',
  async ({ page, apiContext, env }, id: string, position: number, text: string) => {
    const scopes = scopesOf(apiContext, env);
    const testId = render(id, ...scopes);
    const index = indexOfPosition(position, `elements with test id "${testId}"`);
    await expect(
      page.getByTestId(testId).nth(index),
      `element with test id "${testId}" at position ${position}`,
    ).toContainText(render(text, ...scopes));
  },
);

// Proves at least one same-named control rendered and is shown.
Then(
  'the first {string} {role} should be visible',
  async ({ page, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    await expect(page.getByRole(role as AriaRole, { name: n }).first()).toBeVisible();
  },
);

// Proves the Nth same-named control rendered and is shown.
Then(
  'the {string} {role} at position {int} should be visible',
  async ({ page, apiContext, env }, name: string, role: string, position: number) => {
    const n = render(name, ...scopesOf(apiContext, env));
    const index = indexOfPosition(position, `"${n}" ${role} elements`);
    await expect(
      page.getByRole(role as AriaRole, { name: n }).nth(index),
      `no "${n}" ${role} at position ${position}`,
    ).toBeVisible();
  },
);

/* ── counting ─────────────────────────────────────────────────────────── */

// Proves the collection is exactly this size — the assertion that catches a duplicated render or
// a leaked row that a "should be visible" check happily ignores.
Then(
  'the element with test id {string} should have exactly {int} matches',
  async ({ page, apiContext, env }, id: string, count: number) => {
    await expect(page.getByTestId(render(id, ...scopesOf(apiContext, env)))).toHaveCount(count);
  },
);

// Proves the collection reached a floor, for lists whose exact length is not the point. A floor of
// 0 is refused: it would pass on a blank page, which is not an assertion.
Then(
  'the element with test id {string} should have at least {int} matches',
  async ({ page, apiContext, env }, id: string, count: number) => {
    const testId = render(id, ...scopesOf(apiContext, env));
    assertMeaningfulFloor(count, `elements with test id "${testId}"`);
    await expectAtLeast(page.getByTestId(testId), count, `elements with test id "${testId}"`);
  },
);

// Proves exactly N same-named controls rendered — e.g. that a "Delete" appears on every row and
// nowhere else.
Then(
  'there should be exactly {int} {string} {role} elements',
  async ({ page, apiContext, env }, count: number, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    await expect(page.getByRole(role as AriaRole, { name: n })).toHaveCount(count);
  },
);

// Proves at least N same-named controls rendered. A floor of 0 is refused for the same reason.
Then(
  'there should be at least {int} {string} {role} elements',
  async ({ page, apiContext, env }, count: number, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    assertMeaningfulFloor(count, `"${n}" ${role} elements`);
    await expectAtLeast(
      page.getByRole(role as AriaRole, { name: n }),
      count,
      `"${n}" ${role} elements`,
    );
  },
);

/* ── focus ────────────────────────────────────────────────────────────── */
//
// Tab order, focus visibility and focus trapping are invisible to a static rule engine: the
// accessibility tree records what an element IS, never where the caret went.

// Proves focus landed on the intended control after an interaction — the return-focus half of a
// dialog contract. The body-focus guard is essential: `document.activeElement` falls back to
// `<body>`, whose text is the whole page, so an unguarded name match passes for almost any string.
Then(
  'the focused element should be named {string}',
  async ({ page, apiContext, env }, name: string) => {
    const wanted = render(name, ...scopesOf(apiContext, env));
    const info = await readFocus(page);
    expect(
      info.focused,
      `nothing is focused — <${info.tag}> holds focus, so no element is named "${wanted}"`,
    ).toBe(true);
    expect(
      info.name.toLowerCase(),
      `focus is on <${info.tag}> named "${info.name}", not on "${wanted}"`,
    ).toContain(wanted.toLowerCase());
  },
);

// Proves a keyboard user can SEE where they are: an off-screen, zero-size or transparent control
// still takes focus, stranding them on something they cannot find.
Then('the focused element should be visible', async ({ page }) => {
  const info = await readFocus(page);
  expect(info.focused, `nothing is focused — <${info.tag}> holds focus`).toBe(true);
  expect(
    info.rendered,
    `the focused <${info.tag}> ("${info.name}") is not painted — a keyboard user cannot see where they are`,
  ).toBe(true);
});

// Proves focus is inside the modal rather than on the page behind it. Fails distinctly when no
// dialog is open at all, so "the dialog never opened" cannot read as "focus is fine".
Then('the focused element should be inside the open dialog', async ({ page }) => {
  const info = await readFocus(page);
  expect(info.dialogPresent, 'no dialog is open, so focus cannot be inside one').toBe(true);
  expect(info.focused, `nothing is focused — <${info.tag}> holds focus`).toBe(true);
  expect(
    info.insideDialog,
    `focus escaped to <${info.tag}> ("${info.name}") outside the dialog — Tab leaked to the page behind it`,
  ).toBe(true);
});

// Proves focus is on one specific named control, resolved the same way a user's screen reader
// would name it.
Then(
  'focus should be on the {string} {role}',
  async ({ page, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    await expect(page.locator(':focus'), 'nothing on the page is focused').toHaveCount(1);
    await expect(page.getByRole(role as AriaRole, { name: n }).first()).toBeFocused();
  },
);

// Proves an auto-focused, unlabelled field accepts a replacement value. Inline-rename affordances
// swap the label for a bare focused input with no label, id or test id, so neither `I fill the
// {string} field` (which resolves through the label) nor a test-id step can reach them.
When(
  'I replace the focused field with {string}',
  async ({ page, apiContext, env }, value: string) => {
    const focused = page.locator('input:focus, textarea:focus, [contenteditable="true"]:focus');
    await expect(
      focused,
      'no editable element is focused — did the rename affordance open?',
    ).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(render(value, ...scopesOf(apiContext, env)));
  },
);

/* ── keyboard ─────────────────────────────────────────────────────────── */

// Proves a repeated key press is expressible at all — walking a tab ring or a listbox needs it,
// and repeating `I press` N times in the feature file hides the intent.
When(
  'I press {string} {int} times',
  async ({ page, apiContext, env }, key: string, times: number) => {
    if (!Number.isInteger(times) || times < 1) {
      throw new SdodsError('RUN_FAILED', `"${times}" is not a number of key presses.`, {
        hint: 'Press counts are whole numbers, 1 or more. A 0-press step does nothing, and any assertion that follows it would be about an untouched page.',
      });
    }
    const k = render(key, ...scopesOf(apiContext, env));
    for (let i = 0; i < times; i += 1) await page.keyboard.press(k);
  },
);

// Proves nothing on its own — it RECORDS the walk that the next step judges. Split from the
// assertion so a scenario reads as "walk the ring, then say what must have held".
When(
  'I press {string} {int} times recording every focused element',
  async ({ page, apiContext, env }, key: string, times: number) => {
    if (!Number.isInteger(times) || times < 1) {
      throw new SdodsError('RUN_FAILED', `"${times}" is not a number of key presses.`, {
        hint: 'A focus walk of 0 presses records nothing, and "every recorded focus stayed inside" would then be true of an empty list.',
      });
    }
    const k = render(key, ...scopesOf(apiContext, env));
    const walk: boolean[] = [];
    for (let i = 0; i < times; i += 1) {
      await page.keyboard.press(k);
      const info = await readFocus(page);
      walk.push(info.focused && info.insideDialog);
    }
    bag(apiContext).focusWalk = walk;
  },
);

// Proves the modal TRAPS focus — the property a single-shot check cannot see, because focus
// escapes on a PARTICULAR press, not on every press. The empty-walk guard is the whole reason this
// is a separate step: "every element of []" is true, so without it the assertion would pass
// hardest exactly when the walk never ran.
Then('every recorded focus should have stayed inside the dialog', async ({ apiContext }) => {
  const walk = bag(apiContext).focusWalk;
  if (!walk) {
    throw new SdodsError('RUN_FAILED', 'No focus walk has been recorded in this scenario.', {
      hint: 'Run `When I press "Tab" <n> times recording every focused element` before this step.',
    });
  }
  expect(walk.length, 'the recorded focus walk is empty').toBeGreaterThan(0);
  const escapes = walk.filter((inside) => !inside).length;
  expect(escapes, `focus left the dialog on ${escapes} of ${walk.length} presses`).toBe(0);
});

// Proves a region is KEYBOARD REACHABLE, by walking real tab stops. Calling `.focus()` instead
// would pass even if every entry in the region were a click-only <div> — which is precisely the
// bug this step is for. A region whose first control ALREADY holds focus passes without a walk:
// the loop checks before it presses, because blurring first can dismiss the very overlay under
// test.
When(
  'I tab to the first focusable element inside the {string} {role}',
  async ({ page, heal, apiContext, env }, name: string, role: string) => {
    const n = render(name, ...scopesOf(apiContext, env));
    const region = await heal.resolve(
      page.getByRole(role as AriaRole, { name: n }),
      { role: role as AriaRole, name: n, text: n, description: `${role} "${n}"` },
      'assert',
    );
    await tabToFirstFocusable(page, region.first(), `the "${n}" ${role}`);
  },
);

// Proves the same for a region that carries a test id rather than an accessible name.
When(
  'I tab to the first focusable element inside the element with test id {string}',
  async ({ page, heal, apiContext, env }, id: string) => {
    const testId = render(id, ...scopesOf(apiContext, env));
    const region = await heal.resolve(
      page.getByTestId(testId),
      { testId, description: `test id "${testId}"` },
      'assert',
    );
    await tabToFirstFocusable(page, region.first(), `the element with test id "${testId}"`);
  },
);

async function tabToFirstFocusable(
  page: Page,
  region: Locator,
  description: string,
): Promise<void> {
  const first = region.locator(FOCUSABLE_SELECTOR).filter({ visible: true }).first();
  await expect(
    first,
    `${description} contains no visible focusable element, so no keyboard user can enter it`,
  ).toBeVisible();
  for (let stop = 0; stop < MAX_TAB_STOPS; stop += 1) {
    if (await first.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new SdodsError(
    'RUN_FAILED',
    `Tab never reached the first focusable element inside ${description} in ${MAX_TAB_STOPS} stops.`,
    {
      hint: 'Either the region is off the tab ring (click-only elements, or tabindex="-1"), or something before it traps focus.',
    },
  );
}

/* ── open overlays ────────────────────────────────────────────────────── */
//
// Portalled overlays — every Radix-derived dialog, alert dialog and popover — render OUTSIDE the
// trigger's DOM subtree, so a locator scoped to the trigger never finds them. They also routinely
// hold ONE unlabelled input, which `I fill the {string} field with {string}` cannot reach at all
// and `I fill the element with test id "input"` matches ambiguously the moment anything else on
// the page renders one. Scoping to the overlay's role is what makes them addressable.

// Proves a modal surface actually opened.
Then('a dialog should be open', async ({ page }) => {
  await expect(page.locator(DIALOG_SELECTOR).first()).toBeVisible();
});

// Proves the modal closed — the Escape-dismisses and cancel-discards contracts, which otherwise
// have no observable.
Then('no dialog should be open', async ({ page }) => {
  await expect(page.locator(DIALOG_SELECTOR)).toHaveCount(0);
});

// Proves the dialog's single unlabelled field accepts input.
When(
  'I fill the open dialog field with {string}',
  async ({ page, apiContext, env }, value: string) => {
    await fillOverlayField(
      page.getByRole('dialog').last(),
      'dialog',
      render(value, ...scopesOf(apiContext, env)),
    );
  },
);

// Proves the same for an alert dialog. Kept separate from `dialog` because a confirm prompt is
// routinely stacked ON TOP of an already-open dialog, and only the role tells them apart.
When(
  'I fill the open alert dialog field with {string}',
  async ({ page, apiContext, env }, value: string) => {
    await fillOverlayField(
      page.getByRole('alertdialog').last(),
      'alert dialog',
      render(value, ...scopesOf(apiContext, env)),
    );
  },
);

// Proves an unlabelled popover editor accepts input — a loop-count or filter popper typically
// holds one bare <input> with no label, id or test id.
When(
  'I fill the open popover field with {string}',
  async ({ page, apiContext, env }, value: string) => {
    await fillOverlayField(
      page.locator(POPOVER_SELECTOR).last(),
      'popover',
      render(value, ...scopesOf(apiContext, env)),
    );
  },
);

// Proves a NAMED field inside the open dialog accepts input. Needed even though the field has a
// label: the form behind the overlay usually carries the same label, which makes an unscoped
// `getByLabel` ambiguous rather than wrong.
When(
  'I fill the {string} field of the open dialog with {string}',
  async ({ page, apiContext, env }, label: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    const l = render(label, ...scopes);
    const dialog = page.getByRole('dialog').last();
    await expect(dialog, 'no dialog is open').toBeVisible();
    const field = dialog.getByLabel(l);
    await expect(field, `the open dialog has no "${l}" field`).toHaveCount(1);
    await field.fill(render(value, ...scopes));
  },
);

/**
 * The topmost overlay of a kind is the LAST in DOM order — portals append to <body>, so a confirm
 * stacked on a dialog sorts after it. Fails loudly when the overlay is not open, rather than
 * filling something on the page behind it.
 */
async function fillOverlayField(
  overlay: Locator,
  description: string,
  value: string,
): Promise<void> {
  const field = overlay
    .locator('input, textarea, [contenteditable="true"]')
    .filter({ visible: true })
    .first();
  await expect(field, `no open ${description} with an editable field`).toBeVisible();
  await field.fill(value);
}
