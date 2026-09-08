import { expect } from '@playwright/test';
import type { Cookie, Page } from '@playwright/test';
import { Given, Then, When } from '../fixtures/test.js';
import { render } from '../api/template.js';
import { SdodsError } from '../errors.js';

/**
 * Browser-state steps: cookies, web storage, viewport, colour scheme, locale and console.
 *
 * Every step here is generic capability that any web application needs and that the library
 * previously lacked, which forced each onboarding to hand-write it. Each comment states what the
 * step PROVES; where a step exists because of a specific trap, the trap is named.
 *
 * Two rules govern the whole file:
 *   * every string argument is interpolated through `render()`, so `{{vars}}` work everywhere;
 *   * no assertion may pass over an empty set. A selector that matches nothing, a body that
 *     rendered no text, a recorder that was never armed and a page that never navigated are all
 *     failures, because a green step that observed nothing is worse than no step at all.
 */

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

/** A page that never navigated has no origin: storage throws, and a reload proves nothing. */
function requireNavigated(page: Pick<Page, 'url'>, step: string): string {
  const url = page.url();
  if (!url || url === 'about:blank')
    throw new SdodsError('RUN_FAILED', `"${step}" ran before the page had navigated anywhere.`, {
      hint: 'Navigate first (`Given I navigate to the "..." page`). Steps that must run BEFORE the first navigation — seeding storage, planting a cookie, arming the console recorder — are the `Given I seed …` / `Given I set the browser cookie …` / `Given I start recording …` family.',
    });
  return url;
}

function baseUrlOf(env: { ui?: { baseUrl?: string } }, step: string): string {
  const url = env.ui?.baseUrl;
  if (!url)
    throw new SdodsError('CONFIG_INVALID', `"${step}" needs env.ui.baseUrl, which is not set.`, {
      hint: 'Add `ui: { baseUrl: https://… }` to the environment yaml, or run this scenario on the ui layer.',
    });
  return url;
}

/* ── cookies ──────────────────────────────────────────────────────────── */

// Proves a session, consent or attribution gate can be seeded before the app ever loads.
// TRAP: the cookie is scoped to `env.ui.baseUrl`, never to `page.url()`. Before the first
// navigation the page is on `about:blank`, and Playwright rejects a cookie scoped to it — so a
// step written against `page.url()` works only in the middle of a scenario and fails in a
// Background, which is exactly where session seeding belongs.
Given(
  'I set the browser cookie {string} to {string}',
  async ({ page, apiContext, env }, name: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    await page.context().addCookies([
      {
        name: render(name, ...scopes),
        value: render(value, ...scopes),
        url: baseUrlOf(env, 'I set the browser cookie'),
      },
    ]);
  },
);

// Proves the app re-gates on a missing cookie rather than serving a cached authenticated shell.
// TRAP: Playwright exposes only `clearCookies()` for the WHOLE context, so removing one cookie is
// read-filter-restore. Clearing the jar to drop a session cookie would also drop the consent and
// locale cookies the scenario set up, and the failure would look like a bug in the app.
Given('I clear the browser cookie {string}', async ({ page, apiContext, env }, name: string) => {
  const wanted = render(name, ...scopesOf(apiContext, env));
  const context = page.context();
  const all = await context.cookies();
  const survivors = all.filter((c) => c.name !== wanted);
  if (survivors.length === all.length) return; // nothing to clear; do not disturb the jar
  await context.clearCookies();
  await context.addCookies(survivors);
});

// Proves a first-visit experience: no session, no consent record, no attribution.
Given('I clear all browser cookies', async ({ page }) => {
  await page.context().clearCookies();
});

// Proves the app wrote the value it claims to write. An httpOnly cookie is invisible to
// `document.cookie`, so the browser context is the only place its value is observable at all.
Then(
  'the browser cookie {string} should equal {string}',
  async ({ page, apiContext, env }, name: string, expected: string) => {
    const scopes = scopesOf(apiContext, env);
    const wanted = render(name, ...scopes);
    const cookie = await findCookie(page, wanted);
    expect(cookie, `cookie "${wanted}" is not in the jar`).toBeTruthy();
    expect((cookie as Cookie).value, `cookie "${wanted}"`).toBe(render(expected, ...scopes));
  },
);

// Proves the cookie was issued at all, for cases where the value is opaque or random.
Then(
  'the browser cookie {string} should exist',
  async ({ page, apiContext, env }, name: string) => {
    const wanted = render(name, ...scopesOf(apiContext, env));
    expect(await findCookie(page, wanted), `cookie "${wanted}" is not in the jar`).toBeTruthy();
  },
);

// Proves a logout, a rejected consent or a declined attribution left nothing behind.
Then(
  'the browser cookie {string} should not exist',
  async ({ page, apiContext, env }, name: string) => {
    const wanted = render(name, ...scopesOf(apiContext, env));
    expect(await findCookie(page, wanted), `unexpected cookie "${wanted}"`).toBeUndefined();
  },
);

/** The attributes Playwright actually reports. Anything else is an authoring mistake. */
const COOKIE_ATTRIBUTES = ['domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite'] as const;

// Proves the FLAGS, not just the value — the flags are the security contract. A session cookie
// readable from script is a theft surface and `SameSite=None` lets any third-party embed replay it.
// TRAP: an unrecognised attribute name would read back as `undefined` and compare equal to the
// string "undefined", so the step would pass while asserting nothing; the allowlist refuses it.
Then(
  'the browser cookie {string} should carry {string} equal to {string}',
  async ({ page, apiContext, env }, name: string, attribute: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    const wanted = render(name, ...scopes);
    const attr = render(attribute, ...scopes);
    if (!(COOKIE_ATTRIBUTES as readonly string[]).includes(attr))
      throw new SdodsError('RUN_FAILED', `"${attr}" is not a cookie attribute.`, {
        hint: `Use one of: ${COOKIE_ATTRIBUTES.join(', ')}.`,
      });
    const cookie = await findCookie(page, wanted);
    expect(cookie, `cookie "${wanted}" is not in the jar`).toBeTruthy();
    const actual = (cookie as unknown as Record<string, unknown>)[attr];
    expect(String(actual), `${wanted}.${attr}`).toBe(render(value, ...scopes));
  },
);

async function findCookie(
  page: { context(): { cookies(): Promise<Cookie[]> } },
  name: string,
): Promise<Cookie | undefined> {
  return (await page.context().cookies()).find((c) => c.name === name);
}

/* ── local and session storage ────────────────────────────────────────── */

type StorageKind = 'local' | 'session';

interface StorageResult {
  ok: boolean;
  value?: string | null;
  reason?: string;
}

/**
 * Seeding is an init script FIRST, because the values an app reads during its blocking inline
 * script — a theme preference, a feature-flag bootstrap, a dismissed banner — are read before the
 * first frame. A seed written with `evaluate` after navigating is already too late: the app has
 * read the empty value and rendered against it. The in-page write is the second half, so that
 * seeding mid-scenario (with the page already open) is not silently a no-op until the next reload.
 */
async function seedStorage(
  page: Page,
  kind: StorageKind,
  key: string,
  value: string,
): Promise<void> {
  await page.addInitScript(
    (args: { kind: StorageKind; key: string; value: string }) => {
      try {
        const store = args.kind === 'local' ? window.localStorage : window.sessionStorage;
        store.setItem(args.key, args.value);
      } catch {
        /* about:blank, or a context with storage blocked — the in-page write reports it instead */
      }
    },
    { kind, key, value },
  );
  if (isNavigated(page)) {
    const result = (await page.evaluate(
      (args: { kind: StorageKind; key: string; value: string }) => {
        try {
          const store = args.kind === 'local' ? window.localStorage : window.sessionStorage;
          store.setItem(args.key, args.value);
          return { ok: true };
        } catch (e) {
          return { ok: false, reason: String((e as Error)?.message ?? e) };
        }
      },
      { kind, key, value },
    )) as StorageResult;
    if (!result.ok)
      throw new SdodsError(
        'RUN_FAILED',
        `Could not write ${kind} storage "${key}": ${result.reason}`,
        {
          hint: 'The browser context blocks storage for this origin (third-party cookie blocking, or a file:// page).',
        },
      );
  }
}

function isNavigated(page: Pick<Page, 'url'>): boolean {
  const url = page.url();
  return Boolean(url) && url !== 'about:blank';
}

/**
 * Reading is deliberately NOT tolerant. A storage-blocked or never-navigated context returns no
 * value, and treating that as "the key is absent" would make `should be absent` pass in exactly
 * the situation where the step observed nothing at all.
 */
async function readStorage(page: Page, kind: StorageKind, key: string): Promise<string | null> {
  requireNavigated(page, `reading ${kind} storage`);
  const result = (await page.evaluate(
    (args: { kind: StorageKind; key: string }) => {
      try {
        const store = args.kind === 'local' ? window.localStorage : window.sessionStorage;
        return { ok: true, value: store.getItem(args.key) };
      } catch (e) {
        return { ok: false, reason: String((e as Error)?.message ?? e) };
      }
    },
    { kind, key },
  )) as StorageResult;
  if (!result.ok)
    throw new SdodsError(
      'RUN_FAILED',
      `Could not read ${kind} storage "${key}": ${result.reason}`,
      {
        hint: 'The browser context blocks storage for this origin, so no assertion about it can mean anything.',
      },
    );
  return result.value ?? null;
}

// Proves a value the app reads during its first blocking script — theme, flag bootstrap, dismissed
// banner — reaches it before the first paint rather than after it.
Given(
  'I seed local storage {string} with {string}',
  async ({ page, apiContext, env }, key: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    await seedStorage(page, 'local', render(key, ...scopes), render(value, ...scopes));
  },
);

// Same contract as local storage, for the per-tab values an app keeps out of the persistent store.
Given(
  'I seed session storage {string} with {string}',
  async ({ page, apiContext, env }, key: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    await seedStorage(page, 'session', render(key, ...scopes), render(value, ...scopes));
  },
);

// Proves the DEFAULT path: what the app does for a visitor with no stored preference. Removal is
// armed as an init script as well as applied in place, so the next navigation cannot resurrect it.
Given('I clear the local storage key {string}', async ({ page, apiContext, env }, key: string) => {
  const wanted = render(key, ...scopesOf(apiContext, env));
  await page.addInitScript((k: string) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* about:blank, or storage blocked */
    }
  }, wanted);
  if (isNavigated(page))
    await page.evaluate((k: string) => {
      try {
        window.localStorage.removeItem(k);
      } catch {
        /* storage blocked */
      }
    }, wanted);
});

// Proves a genuinely first-visit state. Init scripts run in registration order, so a `seed` step
// written after this one still wins on the next navigation — clear first, then seed.
Given('I clear all browser storage', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* about:blank, or storage blocked */
    }
  });
  if (isNavigated(page))
    await page.evaluate(() => {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        /* storage blocked */
      }
    });
});

// Proves the app PERSISTED the choice, not merely that the UI moved. A preference that never
// reaches storage looks identical on screen until the next page load.
Then(
  'local storage {string} should equal {string}',
  async ({ page, apiContext, env }, key: string, expected: string) => {
    const scopes = scopesOf(apiContext, env);
    const k = render(key, ...scopes);
    expect(await readStorage(page, 'local', k), `local storage "${k}"`).toBe(
      render(expected, ...scopes),
    );
  },
);

// Proves a sign-out, a reset or a decline actually removed the key rather than blanking the UI.
Then('local storage {string} should be absent', async ({ page, apiContext, env }, key: string) => {
  const k = render(key, ...scopesOf(apiContext, env));
  expect(await readStorage(page, 'local', k), `local storage "${k}"`).toBeNull();
});

// Per-tab equivalent of the local-storage absence assertion, so a tab-scoped value that outlives
// the flow which set it fails as loudly as a persisted one.
Then(
  'session storage {string} should be absent',
  async ({ page, apiContext, env }, key: string) => {
    const k = render(key, ...scopesOf(apiContext, env));
    expect(await readStorage(page, 'session', k), `session storage "${k}"`).toBeNull();
  },
);

// Per-tab equivalent of the local-storage assertion.
Then(
  'session storage {string} should equal {string}',
  async ({ page, apiContext, env }, key: string, expected: string) => {
    const scopes = scopesOf(apiContext, env);
    const k = render(key, ...scopes);
    expect(await readStorage(page, 'session', k), `session storage "${k}"`).toBe(
      render(expected, ...scopes),
    );
  },
);

/* ── viewport and reflow ──────────────────────────────────────────────── */

// Proves a layout at a width the project's fixed viewport never visits. WCAG 2.2 reflow is a
// property of a DIFFERENT viewport (320 CSS pixels), so without a per-scenario resize it is
// unwritable — the run would simply re-test the one size already covered.
When('I resize the viewport to {int} by {int}', async ({ page }, width: number, height: number) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new SdodsError('RUN_FAILED', `Viewport ${width}x${height} is not a usable size.`, {
      hint: 'Both dimensions must be positive integers, e.g. `When I resize the viewport to 320 by 800`.',
    });
  await page.setViewportSize({ width, height });
});

interface OverflowReport {
  bodyChildren: number;
  scrollWidth: number;
  clientWidth: number;
  offenders: string[];
}

/**
 * Measures the DOCUMENT, so a legitimately scrollable inner container never trips it — only
 * page-level overflow does. Naming the offending elements is the point: "the page scrolls
 * sideways" is unactionable, "nav.header-actions extends to 412px in a 320px viewport" is a fix.
 */
function probeHorizontalOverflow(): OverflowReport {
  const doc = document.documentElement;
  const limit = doc.clientWidth;
  const offenders: string[] = [];
  if (doc.scrollWidth > limit + 1) {
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.right > limit + 1 && rect.width > 0) {
        const cls = String(el.className || '').split(/\s+/)[0];
        offenders.push(
          `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} right=${Math.round(rect.right)}`,
        );
        if (offenders.length >= 8) break;
      }
    }
  }
  return {
    bodyChildren: document.body ? document.body.children.length : 0,
    scrollWidth: doc.scrollWidth,
    clientWidth: limit,
    offenders,
  };
}

// Proves the 320px reflow contract: no content is reachable only by scrolling sideways.
// TRAP: a blank document also does not scroll sideways. The body-children guard is what stops this
// step going green on a page that failed to render, which is the one case it must not bless.
Then('the page should not scroll horizontally', async ({ page }) => {
  requireNavigated(page, 'the page should not scroll horizontally');
  const report = (await page.evaluate(probeHorizontalOverflow)) as OverflowReport;
  expect(
    report.bodyChildren,
    'the document body is empty — a blank page cannot prove anything about reflow',
  ).toBeGreaterThan(0);
  expect(
    report.scrollWidth,
    `the document is ${report.scrollWidth}px wide inside a ${report.clientWidth}px viewport. Offenders: ${report.offenders.join(', ') || '(none measurable)'}`,
  ).toBeLessThanOrEqual(report.clientWidth + 1);
});

// Proves ONE container contains its own width — a table, a code block or a chart that is allowed
// to scroll internally must not push the page. Fails when the selector matches nothing, because a
// containment claim about an element that is not on the page is not a claim.
Then(
  'the element matching {string} should not overflow horizontally',
  async ({ page, apiContext, env }, selector: string) => {
    const sel = render(selector, ...scopesOf(apiContext, env));
    const info = (await page.evaluate((s: string) => {
      const el = document.querySelector(s) as HTMLElement | null;
      if (!el) return { found: false, scrollWidth: 0, clientWidth: 0 };
      return { found: true, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    }, sel)) as { found: boolean; scrollWidth: number; clientWidth: number };
    expect(info.found, `no element matches "${sel}"`).toBe(true);
    expect(
      info.scrollWidth,
      `"${sel}" lays out ${info.scrollWidth}px of content in a ${info.clientWidth}px box`,
    ).toBeLessThanOrEqual(info.clientWidth + 1);
  },
);

/* ── colour scheme and the painted theme ─────────────────────────────── */

const COLOUR_SCHEMES = ['light', 'dark', 'no-preference'] as const;

// Proves the app honours the OS-level preference. This is the media query only; an app that stores
// its own preference is seeded with `Given I seed local storage …` instead, and a complete dark-mode
// scenario usually needs both.
Given('I emulate the {string} colour scheme', async ({ page, apiContext, env }, scheme: string) => {
  const wanted = render(scheme, ...scopesOf(apiContext, env));
  if (!(COLOUR_SCHEMES as readonly string[]).includes(wanted))
    throw new SdodsError('RUN_FAILED', `"${wanted}" is not a colour scheme.`, {
      hint: `Use one of: ${COLOUR_SCHEMES.join(', ')}.`,
    });
  await page.emulateMedia({ colorScheme: wanted as 'light' | 'dark' | 'no-preference' });
});

/** Max channel below this is unambiguously a dark surface. */
export const DARK_MAX_CHANNEL = 90;
/** Min channel above this is unambiguously a light surface. */
export const LIGHT_MIN_CHANNEL = 160;

export interface BackgroundLayer {
  tag: string;
  colour: string;
}

export interface PaintedColour {
  rgb: [number, number, number];
  from: string;
}

/**
 * The first layer in an element-to-`<html>` chain that actually paints.
 *
 * TRAP: `background-color: transparent` computes to `rgba(0, 0, 0, 0)`. Read naively that is pure
 * black, so a page with a transparent body reads as "dark" and every dark-mode assertion passes
 * over a surface that was never painted. Alpha zero means "not painted here" — keep walking.
 */
export function firstPaintedColour(chain: BackgroundLayer[]): PaintedColour | null {
  for (const layer of chain) {
    const match = /^rgba?\(([^)]+)\)/.exec((layer.colour ?? '').trim());
    if (!match?.[1]) continue;
    // Both syntaxes reach here: the legacy `rgba(9, 9, 9, 0.5)` and the modern
    // `rgb(9 9 9 / 0.5)` some engines now return from getComputedStyle.
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((p) => Number.parseFloat(p));
    const [r, g, b, a] = parts;
    if (r === undefined || g === undefined || b === undefined) continue;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    if (a !== undefined && a === 0) continue;
    return { rgb: [r, g, b], from: layer.tag };
  }
  return null;
}

/** Collects the raw computed backgrounds; every judgement about them is made in Node. */
function collectBackgroundChain(selector: string | null): {
  found: boolean;
  chain: BackgroundLayer[];
} {
  const start = selector ? document.querySelector(selector) : document.body;
  if (!start) return { found: false, chain: [] };
  const chain: BackgroundLayer[] = [];
  let el: Element | null = start;
  while (el) {
    chain.push({ tag: el.tagName.toLowerCase(), colour: getComputedStyle(el).backgroundColor });
    el = el.parentElement;
  }
  return { found: true, chain };
}

async function paintedColour(
  page: Page,
  selector: string | null,
  step: string,
): Promise<PaintedColour> {
  requireNavigated(page, step);
  const result = (await page.evaluate(collectBackgroundChain, selector)) as {
    found: boolean;
    chain: BackgroundLayer[];
  };
  expect(result.found, `no element matches "${selector}"`).toBe(true);
  const painted = firstPaintedColour(result.chain);
  expect(
    painted,
    `every element from <${result.chain[0]?.tag ?? '?'}> up to <html> paints a transparent background, so nothing was painted to judge`,
  ).not.toBeNull();
  return painted as PaintedColour;
}

function expectDark(painted: PaintedColour, subject: string): void {
  expect(
    Math.max(...painted.rgb),
    `${subject} painted rgb(${painted.rgb.join(', ')}) from <${painted.from}> — that is not a dark surface`,
  ).toBeLessThan(DARK_MAX_CHANNEL);
}

function expectLight(painted: PaintedColour, subject: string): void {
  expect(
    Math.min(...painted.rgb),
    `${subject} painted rgb(${painted.rgb.join(', ')}) from <${painted.from}> — that is not a light surface`,
  ).toBeGreaterThan(LIGHT_MIN_CHANNEL);
}

// Proves the CLASS was applied. Necessary but never sufficient: a `dark` class with no CSS behind
// it is not dark mode, which is why the painted-background steps exist alongside it.
Then(
  'the html element should carry the {string} class',
  async ({ page, apiContext, env }, cls: string) => {
    const wanted = render(cls, ...scopesOf(apiContext, env));
    const classes = await page.evaluate(() => document.documentElement.className);
    expect(
      String(classes).split(/\s+/).filter(Boolean),
      `html class list is "${classes}"`,
    ).toContain(wanted);
  },
);

// Proves the theme class was REMOVED — the direction that catches a toggle which only ever adds.
Then(
  'the html element should not carry the {string} class',
  async ({ page, apiContext, env }, cls: string) => {
    const wanted = render(cls, ...scopesOf(apiContext, env));
    const classes = await page.evaluate(() => document.documentElement.className);
    expect(
      String(classes).split(/\s+/).filter(Boolean),
      `html class list is "${classes}"`,
    ).not.toContain(wanted);
  },
);

// Proves what the user actually SAW. This is the assertion a class check cannot make: the class
// can be present while the stylesheet that acts on it never loaded, and the page renders white.
Then('the painted page background should be dark', async ({ page }) => {
  expectDark(await paintedColour(page, null, 'the painted page background should be dark'), 'body');
});

// The light-mode direction, so a theme stuck in dark fails as loudly as one stuck in light.
Then('the painted page background should be light', async ({ page }) => {
  expectLight(
    await paintedColour(page, null, 'the painted page background should be light'),
    'body',
  );
});

// Proves ONE surface themed — a panel, a modal, a sidebar. Whole-page checks miss the component
// that kept a hardcoded white while everything around it went dark.
Then(
  'the element matching {string} should paint a dark background',
  async ({ page, apiContext, env }, selector: string) => {
    const sel = render(selector, ...scopesOf(apiContext, env));
    expectDark(await paintedColour(page, sel, `the element matching "${sel}"`), `"${sel}"`);
  },
);

/** Where the first-frame sample is parked. Stable by design: the assertion step reads it back. */
const FIRST_FRAME_KEY = '__sdodsFirstPaintedBackground';

// Arms a one-shot sample of the FIRST rendered frame, before the app's own scripts can repaint.
// TRAP: a flash of white is invisible to every assertion taken after load — by then the theme has
// resolved and the page looks correct. Catching a flash requires sampling before it is over, so
// this step must be written BEFORE the navigation whose first frame it is about to judge.
Given('I record the background painted on the first frame', async ({ page }) => {
  await page.addInitScript((key: string) => {
    // The walk is repeated here rather than shared, because an init script is serialised on its
    // own and cannot reference a module-scope helper. It collects raw colours only; the judgement
    // of which layer counts as painted lives in one place, `firstPaintedColour()`.
    const sample = () => {
      requestAnimationFrame(() => {
        const store = window as unknown as Record<string, unknown>;
        if (store[key] !== undefined) return;
        const chain: Array<{ tag: string; colour: string }> = [];
        let el: Element | null = document.body;
        while (el) {
          chain.push({
            tag: el.tagName.toLowerCase(),
            colour: getComputedStyle(el).backgroundColor,
          });
          el = el.parentElement;
        }
        store[key] = chain;
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sample, { once: true });
    } else {
      sample();
    }
  }, FIRST_FRAME_KEY);
});

async function firstFramePainted(page: Page): Promise<PaintedColour> {
  requireNavigated(page, 'the first painted frame assertions');
  const chain = (await page.evaluate(
    (key: string) => (window as unknown as Record<string, unknown>)[key],
    FIRST_FRAME_KEY,
  )) as BackgroundLayer[] | undefined;
  if (!chain)
    throw new SdodsError('RUN_FAILED', 'No first-frame background was sampled.', {
      hint: 'Add `Given I record the background painted on the first frame` BEFORE the navigation you want to judge — arming it afterwards samples nothing.',
    });
  const painted = firstPaintedColour(chain);
  expect(
    painted,
    'the first frame painted nothing: every layer from <body> up to <html> was transparent',
  ).not.toBeNull();
  return painted as PaintedColour;
}

// Proves there was NO light flash before the dark theme resolved — the defect a post-load
// assertion structurally cannot see.
Then('the first painted frame should have been dark', async ({ page }) => {
  expectDark(await firstFramePainted(page), 'the first painted frame');
});

// The same guarantee for a light theme: no dark flash on the way in.
Then('the first painted frame should have been light', async ({ page }) => {
  expectLight(await firstFramePainted(page), 'the first painted frame');
});

/* ── locale ───────────────────────────────────────────────────────────── */

// Proves the app resolves the locale from ITS OWN cookie, which is what a language switcher
// actually writes. The cookie name is an argument because it is app-specific.
// TRAP: a reload on `about:blank` succeeds and proves nothing, so the step refuses it — plant the
// cookie with `Given I set the browser cookie` if you need it before the first navigation.
Given(
  'I switch the interface locale to {string} using the {string} cookie',
  async ({ page, apiContext, env }, locale: string, cookieName: string) => {
    const scopes = scopesOf(apiContext, env);
    requireNavigated(page, 'I switch the interface locale');
    await page.context().addCookies([
      {
        name: render(cookieName, ...scopes),
        value: render(locale, ...scopes),
        url: baseUrlOf(env, 'I switch the interface locale'),
      },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
  },
);

// Proves negotiation from the browser's own preference, which is the path a first-time visitor
// takes before any cookie exists.
// TRAP: `setExtraHTTPHeaders` REPLACES the page's whole extra-header map on every call, so a
// second call elsewhere in the scenario silently drops this one. Set the locale once.
Given(
  'I request the locale {string} with the Accept-Language header',
  async ({ page, apiContext, env }, locale: string) => {
    requireNavigated(page, 'I request the locale with the Accept-Language header');
    await page.setExtraHTTPHeaders({
      'Accept-Language': render(locale, ...scopesOf(apiContext, env)),
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  },
);

// Proves the document declared the language it served. Screen readers, hyphenation and every
// `:lang()` rule key off this, and it is the one machine-checkable trace of the negotiation.
Then(
  'the html lang attribute should be {string}',
  async ({ page, apiContext, env }, lang: string) => {
    const wanted = render(lang, ...scopesOf(apiContext, env));
    const actual = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    expect(actual, 'html lang attribute').toBe(wanted);
  },
);

// Proves no right-to-left locale was added without the layout work behind it. An `dir="rtl"`
// document in a layout built for LTR is broken in a way no text assertion notices.
Then('the html dir attribute should be absent or ltr', async ({ page }) => {
  const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  expect(
    dir === null || dir === '' || dir === 'ltr',
    `html dir="${dir}" — a right-to-left locale is being served into a left-to-right layout`,
  ).toBe(true);
});

/** Dotted tokens that are not message keys: file names, hostnames and version strings. */
const NOT_A_KEY_SUFFIX =
  /\.(com|io|ai|dev|org|net|app|co|uk|de|jp|cn|json|js|mjs|cjs|ts|tsx|jsx|css|scss|html|xml|yml|yaml|md|txt|pdf|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2)$/i;

/**
 * A missing translation surfaces as the raw catalogue key rendered into the page — `nav.settings`
 * where "Settings" belongs. Nothing throws, nothing logs, and the layout is unchanged, so only the
 * shape of the text gives it away.
 */
export function looksLikeMessageKey(text: string): boolean {
  const token = text.trim();
  if (!/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/.test(token)) return false;
  if (NOT_A_KEY_SUFFIX.test(token)) return false;
  const segments = token.split('.');
  // `v1.2.3`, `x.0` — a version, not a key.
  if (segments.slice(1).every((s) => /^\d+$/.test(s))) return false;
  return true;
}

/** Returns the visible single-word tokens plus how much text was examined at all. */
function collectVisibleTokens(): { sampled: number; tokens: string[] } {
  const skip = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE'];
  const tokens = new Set<string>();
  let sampled = 0;
  if (!document.body) return { sampled, tokens: [] };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const text = (node.textContent ?? '').trim();
    if (text && parent && skip.indexOf(parent.tagName) === -1) {
      const el = parent as HTMLElement & { checkVisibility?: () => boolean };
      const visible =
        typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.offsetParent !== null;
      if (visible) {
        sampled += 1;
        if (text.length < 80 && !/\s/.test(text)) tokens.add(text);
      }
    }
    node = walker.nextNode();
  }
  return { sampled, tokens: Array.from(tokens) };
}

// Proves the catalogue actually resolved for this locale. A framework that deep-merges English
// under every locale hides a missing translation completely; remove that fallback and the raw key
// is what ships, and this is the only assertion that sees it.
// TRAP: a page that rendered no text at all would satisfy "no key-shaped text" trivially. The
// sampled-count guard turns that case into a failure instead of a free pass.
Then('no visible text should look like a raw message key', async ({ page }) => {
  requireNavigated(page, 'no visible text should look like a raw message key');
  const seen = (await page.evaluate(collectVisibleTokens)) as { sampled: number; tokens: string[] };
  expect(
    seen.sampled,
    'the page rendered no visible text at all, so this step examined nothing',
  ).toBeGreaterThan(0);
  const suspects = seen.tokens.filter(looksLikeMessageKey);
  expect(suspects, 'raw message keys rendered as visible text').toEqual([]);
});

/* ── console and page errors ─────────────────────────────────────────── */

interface ConsoleRecording {
  errors: string[];
  warnings: string[];
  pageErrors: string[];
}

/**
 * Per-scenario, keyed on the scenario's own `apiContext` — never a module-level array, which would
 * leak one scenario's console output into the next and into every parallel worker.
 */
const recordings = new WeakMap<object, ConsoleRecording>();

function recordingFor(apiContext: object, step: string): ConsoleRecording {
  const found = recordings.get(apiContext);
  if (!found)
    throw new SdodsError('RUN_FAILED', `"${step}" ran without a console recording.`, {
      hint: 'Add `Given I start recording console messages` BEFORE the navigation that would emit — a recorder armed afterwards has already missed everything.',
    });
  return found;
}

/**
 * A pattern that will not compile is an authoring mistake, not a test failure. Left bare it
 * surfaces as a `SyntaxError` from deep inside the step, naming neither the step nor the pattern.
 */
function compilePattern(pattern: string, step: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (e) {
    throw new SdodsError('RUN_FAILED', `"${step}" was given the unusable pattern /${pattern}/.`, {
      hint: 'The pattern is a JavaScript regular expression; escape literal dots, brackets and parentheses.',
      cause: e,
    });
  }
}

// Arms the recorder. Buckets are kept separate on purpose: a failed third-party beacon logs to
// `console.error` and is not an uncaught exception, and folding warnings into errors would widen
// "no console error" into something no team can keep green.
// TRAP: listeners attached after the navigation see nothing that the navigation emitted, so this
// belongs before it. Calling it twice is a no-op rather than a second set of listeners, so a
// Background and a Scenario can both declare it without double-counting every message.
Given('I start recording console messages', async ({ page, apiContext }) => {
  if (recordings.has(apiContext)) return;
  const recording: ConsoleRecording = { errors: [], warnings: [], pageErrors: [] };
  recordings.set(apiContext, recording);
  page.on('console', (msg) => {
    if (msg.type() === 'error') recording.errors.push(msg.text());
    else if (msg.type() === 'warning') recording.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => {
    recording.pageErrors.push(String(err?.message ?? err));
  });
});

// Proves the page rendered without complaining. "The empty state rendered" and "the component
// threw and rendered nothing" look identical to every visual assertion; the console tells them apart.
Then('no console error should have been recorded', async ({ apiContext }) => {
  const recording = recordingFor(apiContext, 'no console error should have been recorded');
  expect(recording.errors, 'console errors').toEqual([]);
});

// The targeted form: proves one named class of error is absent — a missing translation key, a
// hydration mismatch, a blocked request — while tolerating noise the team has accepted.
Then('no console error should match {string}', async ({ apiContext, env }, pattern: string) => {
  const recording = recordingFor(apiContext, 'no console error should match');
  const rendered = render(pattern, apiContext.vars.toObject(), env.vars);
  const re = compilePattern(rendered, 'no console error should match');
  expect(
    recording.errors.filter((line) => re.test(line)),
    `console errors matching /${rendered}/`,
  ).toEqual([]);
});

// The same for warnings, which is where several frameworks report a missing message or a
// deprecated API — never at error level.
Then('no console warning should match {string}', async ({ apiContext, env }, pattern: string) => {
  const recording = recordingFor(apiContext, 'no console warning should match');
  const rendered = render(pattern, apiContext.vars.toObject(), env.vars);
  const re = compilePattern(rendered, 'no console warning should match');
  expect(
    recording.warnings.filter((line) => re.test(line)),
    `console warnings matching /${rendered}/`,
  ).toEqual([]);
});

// The POSITIVE direction, and the reason the negative steps above can be trusted: a scenario that
// deliberately breaks something asserts the error WAS reported. Without one of these in the suite,
// a recorder that silently stopped working would leave every "no console error" step green.
Then(
  'a console error matching {string} should have been recorded',
  async ({ apiContext, env }, pattern: string) => {
    const recording = recordingFor(
      apiContext,
      'a console error matching … should have been recorded',
    );
    const rendered = render(pattern, apiContext.vars.toObject(), env.vars);
    const re = compilePattern(rendered, 'a console error matching … should have been recorded');
    expect(
      recording.errors.filter((line) => re.test(line)).length,
      `no console error matched /${rendered}/. Recorded: ${recording.errors.slice(0, 10).join(' | ') || '(none)'}`,
    ).toBeGreaterThan(0);
  },
);

// Proves nothing THREW. Distinct from a console error: an uncaught exception stops a render, and
// a page that threw is broken whatever it managed to paint before it did.
Then('no uncaught page error should have been recorded', async ({ apiContext }) => {
  const recording = recordingFor(apiContext, 'no uncaught page error should have been recorded');
  expect(recording.pageErrors, 'uncaught page errors').toEqual([]);
});
