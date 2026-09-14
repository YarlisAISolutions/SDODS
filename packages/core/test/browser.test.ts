import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DARK_MAX_CHANNEL,
  LIGHT_MIN_CHANNEL,
  findUntranslated,
  firstPaintedColour,
  looksLikeMessageKey,
} from '../src/steps/browser.steps.js';
import { emulationFromTags } from '../src/config/emulation.js';
import { SdodsError } from '../src/errors.js';

/**
 * The step bodies are reached through playwright-bdd's own registry, so these tests exercise the
 * SAME functions a feature file would run — not a re-implementation of them. Each step is invoked
 * with fake fixtures, which lets every guard be proven by asserting that it FAILS when the thing
 * it checks is absent. A step library whose guards are never seen to fail is a library of
 * decorations.
 */

const require_ = createRequire(import.meta.url);
const bddEntry = require_.resolve('playwright-bdd');
const { stepDefinitions } = require_(join(dirname(bddEntry), 'steps', 'stepRegistry.js')) as {
  stepDefinitions: Array<{
    patternString: string;
    keyword: string;
    uri: string;
    fn: (...args: unknown[]) => Promise<void>;
  }>;
};

const mine = () => stepDefinitions.filter((d) => d.uri.includes('browser.steps'));

function step(pattern: string) {
  const found = mine().find((d) => d.patternString === pattern);
  if (!found) throw new Error(`step not registered: ${pattern}`);
  return found;
}

/** Runs a step body and returns the rejection, or undefined when it passed. */
async function failure(
  pattern: string,
  fixtures: unknown,
  ...args: unknown[]
): Promise<Error | undefined> {
  try {
    await step(pattern).fn(fixtures, ...args);
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

/** Asserts a step passed — used so a "should not throw" expectation reports the real error. */
async function run(pattern: string, fixtures: unknown, ...args: unknown[]): Promise<void> {
  const err = await failure(pattern, fixtures, ...args);
  if (err) throw err;
}

/* ── fakes ────────────────────────────────────────────────────────────── */

interface FakeCookie {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  sameSite?: string;
  expires?: number;
}

function fakePage(opts: { url?: string; cookies?: FakeCookie[]; evaluates?: unknown[] } = {}) {
  let jar: FakeCookie[] = [...(opts.cookies ?? [])];
  const queue = [...(opts.evaluates ?? [])];
  const calls = {
    initScripts: [] as Array<{ arg: unknown }>,
    evaluates: [] as Array<{ arg: unknown }>,
    viewport: [] as Array<{ width: number; height: number }>,
    media: [] as unknown[],
    reloads: 0,
    headers: [] as Array<Record<string, string>>,
    clearCookies: 0,
    added: [] as FakeCookie[],
    listeners: [] as Array<{ event: string; handler: (arg: never) => void }>,
  };
  const page = {
    url: () => opts.url ?? 'about:blank',
    context: () => ({
      cookies: async () => jar.slice(),
      clearCookies: async () => {
        calls.clearCookies += 1;
        jar = [];
      },
      addCookies: async (cookies: FakeCookie[]) => {
        calls.added.push(...cookies);
        jar = jar.concat(cookies);
      },
    }),
    addInitScript: async (_fn: unknown, arg?: unknown) => {
      calls.initScripts.push({ arg });
    },
    evaluate: async (_fn: unknown, arg?: unknown) => {
      calls.evaluates.push({ arg });
      return queue.length ? queue.shift() : undefined;
    },
    setViewportSize: async (size: { width: number; height: number }) => {
      calls.viewport.push(size);
    },
    emulateMedia: async (media: unknown) => {
      calls.media.push(media);
    },
    reload: async () => {
      calls.reloads += 1;
    },
    setExtraHTTPHeaders: async (headers: Record<string, string>) => {
      calls.headers.push(headers);
    },
    on: (event: string, handler: (arg: never) => void) => {
      calls.listeners.push({ event, handler });
    },
  };
  return { page, calls, jar: () => jar };
}

function fakeContext(vars: Record<string, unknown> = {}) {
  return { vars: { toObject: () => vars } };
}

// `baseUrl: null` means the environment declares none. It cannot be `undefined`: an explicit
// undefined re-triggers the default parameter, which would silently restore the base URL.
function fakeEnv(vars: Record<string, unknown> = {}, baseUrl: string | null = 'https://app.test') {
  return { vars, ui: baseUrl === null ? undefined : { baseUrl } };
}

/* ── the registered surface ───────────────────────────────────────────── */

const EXPECTED: Array<[string, string]> = [
  ['Given', 'I set the browser cookie {string} to {string}'],
  ['Given', 'I clear the browser cookie {string}'],
  ['Given', 'I clear all browser cookies'],
  ['Then', 'the browser cookie {string} should equal {string}'],
  ['Then', 'the browser cookie {string} should exist'],
  ['Then', 'the browser cookie {string} should not exist'],
  ['Then', 'the browser cookie {string} should carry {string} equal to {string}'],
  ['Given', 'I seed local storage {string} with {string}'],
  ['Given', 'I seed session storage {string} with {string}'],
  ['Given', 'I clear the local storage key {string}'],
  ['Given', 'I clear all browser storage'],
  ['Then', 'local storage {string} should equal {string}'],
  ['Then', 'local storage {string} should be absent'],
  ['Then', 'session storage {string} should equal {string}'],
  ['Then', 'session storage {string} should be absent'],
  ['When', 'I resize the viewport to {int} by {int}'],
  ['Then', 'the page should not scroll horizontally'],
  ['Then', 'the element matching {string} should not overflow horizontally'],
  ['Given', 'I emulate the {string} colour scheme'],
  ['Given', 'I record the background painted on the first frame'],
  ['Then', 'the html element should carry the {string} class'],
  ['Then', 'the html element should not carry the {string} class'],
  ['Then', 'the painted page background should be dark'],
  ['Then', 'the painted page background should be light'],
  ['Then', 'the element matching {string} should paint a dark background'],
  ['Then', 'the first painted frame should have been dark'],
  ['Then', 'the first painted frame should have been light'],
  ['Given', 'I switch the interface locale to {string} using the {string} cookie'],
  ['Given', 'I request the locale {string} with the Accept-Language header'],
  ['Then', 'the html lang attribute should be {string}'],
  ['Then', 'the html dir attribute should be absent or ltr'],
  ['Then', 'no visible text should look like a raw message key'],
  ['Given', 'I start recording console messages'],
  ['Then', 'no console error should have been recorded'],
  ['Then', 'no console error should match {string}'],
  ['Then', 'no console warning should match {string}'],
  ['Then', 'a console error matching {string} should have been recorded'],
  ['Then', 'no uncaught page error should have been recorded'],
  ['Given', 'I use the locale {string}'],
  ['Given', 'I use the timezone {string}'],
  ['Given', 'I use the {string} color scheme'],
  ['Given', 'I use the viewport {int} by {int}'],
  ['Given', 'I use the device {string}'],
  ['Then', 'the page should reflow without horizontal scrolling'],
  ['Then', 'the page should have no untranslated keys'],
  ['Then', 'the page should have no untranslated keys matching {string}'],
];

describe('browser steps: registration', () => {
  it('registers every documented pattern under the intended keyword', () => {
    for (const [keyword, pattern] of EXPECTED) {
      const def = mine().find((d) => d.patternString === pattern);
      expect(def, `missing step: ${pattern}`).toBeTruthy();
      expect(def?.keyword, pattern).toBe(keyword);
    }
  });

  it('registers no pattern twice', () => {
    // matchKeywords is off in this runner, so a pattern registered twice makes bddgen report
    // "Multiple definitions matched" and takes the whole library down, not just the step.
    const patterns = mine().map((d) => d.patternString);
    expect(patterns.length).toBe(new Set(patterns).size);
  });

  it('registers nothing beyond the documented surface', () => {
    expect(
      mine()
        .map((d) => d.patternString)
        .sort(),
    ).toEqual(EXPECTED.map(([, p]) => p).sort());
  });
});

/* ── cookies ──────────────────────────────────────────────────────────── */

describe('browser steps: cookies', () => {
  it('interpolates the cookie name and value, and scopes to env.ui.baseUrl', async () => {
    const { page, calls } = fakePage();
    await run(
      'I set the browser cookie {string} to {string}',
      { page, apiContext: fakeContext({ suffix: 'session' }), env: fakeEnv({ tenant: 'acme' }) },
      'mbb_{{suffix}}',
      'tenant-{{tenant}}',
    );
    expect(calls.added).toEqual([
      { name: 'mbb_session', value: 'tenant-acme', url: 'https://app.test' },
    ]);
  });

  it('scopes to the env base URL rather than page.url(), so it works before the first navigation', async () => {
    const { page, calls } = fakePage({ url: 'about:blank' });
    await run(
      'I set the browser cookie {string} to {string}',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      'a',
      'b',
    );
    expect(calls.added[0]?.url).toBe('https://app.test');
  });

  it('refuses to plant a cookie when the environment declares no UI base URL', async () => {
    const { page } = fakePage();
    const err = await failure(
      'I set the browser cookie {string} to {string}',
      { page, apiContext: fakeContext(), env: fakeEnv({}, null) },
      'a',
      'b',
    );
    expect(err).toBeInstanceOf(SdodsError);
    expect((err as SdodsError).code).toBe('CONFIG_INVALID');
  });

  it('clears ONE cookie by restoring the others Playwright forces it to drop', async () => {
    const { page, calls, jar } = fakePage({
      cookies: [
        { name: '__session', value: 's', domain: 'app.test', path: '/' },
        { name: 'NEXT_LOCALE', value: 'fr', domain: 'app.test', path: '/' },
        { name: 'consent', value: 'yes', domain: 'app.test', path: '/' },
      ],
    });
    await run(
      'I clear the browser cookie {string}',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      '__session',
    );
    expect(calls.clearCookies).toBe(1);
    expect(
      jar()
        .map((c) => c.name)
        .sort(),
    ).toEqual(['NEXT_LOCALE', 'consent']);
  });

  it('leaves the jar untouched when the named cookie was never there', async () => {
    const { page, calls, jar } = fakePage({
      cookies: [{ name: 'consent', value: 'yes', domain: 'app.test', path: '/' }],
    });
    await run(
      'I clear the browser cookie {string}',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      '__session',
    );
    expect(calls.clearCookies).toBe(0);
    expect(jar()).toHaveLength(1);
  });

  it('fails rather than passing vacuously when the asserted cookie is absent', async () => {
    const { page } = fakePage({ cookies: [] });
    const err = await failure(
      'the browser cookie {string} should equal {string}',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      'mbb_ref',
      'anything',
    );
    expect(err?.message).toContain('cookie "mbb_ref" is not in the jar');
  });

  it('interpolates the expected cookie value', async () => {
    const { page } = fakePage({ cookies: [{ name: 'mbb_ref', value: 'yid_abc', path: '/' }] });
    const fixtures = { page, apiContext: fakeContext({ referral: 'yid_abc' }), env: fakeEnv() };
    await run(
      'the browser cookie {string} should equal {string}',
      fixtures,
      'mbb_ref',
      '{{referral}}',
    );
    const err = await failure(
      'the browser cookie {string} should equal {string}',
      fixtures,
      'mbb_ref',
      '{{referral}}x',
    );
    expect(err, 'a wrong expectation must fail').toBeTruthy();
  });

  it('asserts absence in both directions', async () => {
    const present = fakePage({ cookies: [{ name: '__session', value: 's' }] });
    const empty = fakePage({ cookies: [] });
    await run(
      'the browser cookie {string} should not exist',
      { page: empty.page, apiContext: fakeContext(), env: fakeEnv() },
      '__session',
    );
    expect(
      await failure(
        'the browser cookie {string} should not exist',
        { page: present.page, apiContext: fakeContext(), env: fakeEnv() },
        '__session',
      ),
    ).toBeTruthy();
  });

  it('refuses an attribute name that is not a cookie attribute', async () => {
    // Without the allowlist this reads back as undefined and compares equal to "undefined",
    // so the step would pass while asserting nothing at all.
    const { page } = fakePage({ cookies: [{ name: '__session', value: 's', httpOnly: true }] });
    const err = await failure(
      'the browser cookie {string} should carry {string} equal to {string}',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      '__session',
      'httponly',
      'undefined',
    );
    expect(err).toBeInstanceOf(SdodsError);
    expect((err as SdodsError).hint).toContain('httpOnly');
  });

  it('compares a real cookie flag', async () => {
    const { page } = fakePage({
      cookies: [{ name: '__session', value: 's', httpOnly: true, sameSite: 'Lax' }],
    });
    const fixtures = { page, apiContext: fakeContext(), env: fakeEnv() };
    await run(
      'the browser cookie {string} should carry {string} equal to {string}',
      fixtures,
      '__session',
      'httpOnly',
      'true',
    );
    expect(
      await failure(
        'the browser cookie {string} should carry {string} equal to {string}',
        fixtures,
        '__session',
        'sameSite',
        'None',
      ),
    ).toBeTruthy();
  });
});

/* ── storage ──────────────────────────────────────────────────────────── */

describe('browser steps: web storage', () => {
  it('seeds through an init script before the first navigation, with both parts interpolated', async () => {
    const { page, calls } = fakePage({ url: 'about:blank' });
    await run(
      'I seed local storage {string} with {string}',
      { page, apiContext: fakeContext({ key: 'theme' }), env: fakeEnv({ mode: 'dark' }) },
      'app-{{key}}',
      '{{mode}}',
    );
    expect(calls.initScripts).toEqual([
      { arg: { kind: 'local', key: 'app-theme', value: 'dark' } },
    ]);
    // Nothing is written in-page: there is no page yet, and an evaluate here would throw.
    expect(calls.evaluates).toHaveLength(0);
  });

  it('also writes in place once a page is open, so a mid-scenario seed is not a silent no-op', async () => {
    const { page, calls } = fakePage({ url: 'https://app.test/x', evaluates: [{ ok: true }] });
    await run(
      'I seed session storage {string} with {string}',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      'k',
      'v',
    );
    expect(calls.initScripts).toHaveLength(1);
    expect(calls.evaluates).toEqual([{ arg: { kind: 'session', key: 'k', value: 'v' } }]);
  });

  it('surfaces a blocked in-page write instead of pretending it worked', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ ok: false, reason: 'SecurityError' }],
    });
    const err = await failure(
      'I seed local storage {string} with {string}',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      'k',
      'v',
    );
    expect(err).toBeInstanceOf(SdodsError);
    expect(err?.message).toContain('SecurityError');
  });

  it('refuses to read storage on a page that never navigated', async () => {
    // The guard that matters: an unguarded read returns nothing, and "nothing" would make
    // `should be absent` pass in exactly the case where the step observed nothing at all.
    const { page } = fakePage({ url: 'about:blank' });
    const err = await failure(
      'local storage {string} should be absent',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      'theme',
    );
    expect(err).toBeInstanceOf(SdodsError);
    expect((err as SdodsError).hint).toContain('Navigate first');
  });

  it('refuses a storage-blocked read rather than reporting the key as absent', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ ok: false, reason: 'access denied' }],
    });
    const err = await failure(
      'local storage {string} should be absent',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      'theme',
    );
    expect(err).toBeInstanceOf(SdodsError);
    expect(err?.message).toContain('access denied');
  });

  it('asserts a stored value and its absence', async () => {
    const stored = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ ok: true, value: 'dark' }],
    });
    await run(
      'local storage {string} should equal {string}',
      { page: stored.page, apiContext: fakeContext({ want: 'dark' }), env: fakeEnv() },
      'theme',
      '{{want}}',
    );
    const missing = fakePage({ url: 'https://app.test/x', evaluates: [{ ok: true, value: null }] });
    await run(
      'local storage {string} should be absent',
      { page: missing.page, apiContext: fakeContext(), env: fakeEnv() },
      'theme',
    );
    const sessionMissing = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ ok: true, value: null }],
    });
    await run(
      'session storage {string} should be absent',
      { page: sessionMissing.page, apiContext: fakeContext(), env: fakeEnv() },
      'draft',
    );
    const present = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ ok: true, value: 'dark' }],
    });
    expect(
      await failure(
        'local storage {string} should be absent',
        { page: present.page, apiContext: fakeContext(), env: fakeEnv() },
        'theme',
      ),
    ).toBeTruthy();
  });

  it('arms removal as an init script so the next navigation cannot resurrect the key', async () => {
    const { page, calls } = fakePage({ url: 'about:blank' });
    await run(
      'I clear the local storage key {string}',
      { page, apiContext: fakeContext({ k: 'theme' }), env: fakeEnv() },
      '{{k}}',
    );
    expect(calls.initScripts).toEqual([{ arg: 'theme' }]);
  });
});

/* ── viewport ─────────────────────────────────────────────────────────── */

describe('browser steps: viewport and reflow', () => {
  it('resizes and refuses a nonsensical size', async () => {
    const { page, calls } = fakePage();
    await run('I resize the viewport to {int} by {int}', { page }, 320, 800);
    expect(calls.viewport).toEqual([{ width: 320, height: 800 }]);
    const err = await failure('I resize the viewport to {int} by {int}', { page }, 0, 800);
    expect(err).toBeInstanceOf(SdodsError);
  });

  it('fails on a blank document instead of blessing it as reflow-clean', async () => {
    // A page that rendered nothing also does not scroll sideways. Without this guard the
    // whole reflow axis goes green on a page that failed to render.
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ bodyChildren: 0, scrollWidth: 320, clientWidth: 320, offenders: [] }],
    });
    const err = await failure('the page should not scroll horizontally', { page });
    expect(err?.message).toContain('the document body is empty');
  });

  it('names the offending elements when the page does overflow', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [
        {
          bodyChildren: 3,
          scrollWidth: 412,
          clientWidth: 320,
          offenders: ['nav.header-actions right=412', 'div.hero right=380'],
        },
      ],
    });
    const err = await failure('the page should not scroll horizontally', { page });
    expect(err?.message).toContain('nav.header-actions right=412');
    expect(err?.message).toContain('320px viewport');
  });

  it('tolerates a single sub-pixel and passes a clean layout', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ bodyChildren: 5, scrollWidth: 321, clientWidth: 320, offenders: [] }],
    });
    await run('the page should not scroll horizontally', { page });
  });

  it('refuses to judge containment for a selector that matches nothing', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ found: false, scrollWidth: 0, clientWidth: 0 }],
    });
    const err = await failure(
      'the element matching {string} should not overflow horizontally',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      '.data-table',
    );
    expect(err?.message).toContain('no element matches ".data-table"');
  });
});

/* ── colour scheme ────────────────────────────────────────────────────── */

describe('firstPaintedColour', () => {
  it('walks past a transparent layer instead of reading it as black', () => {
    // The trap this exists for: `transparent` computes to `rgba(0, 0, 0, 0)`, and a naive read
    // makes an unpainted body look like the darkest possible surface.
    const painted = firstPaintedColour([
      { tag: 'body', colour: 'rgba(0, 0, 0, 0)' },
      { tag: 'html', colour: 'rgb(255, 255, 255)' },
    ]);
    expect(painted).toEqual({ rgb: [255, 255, 255], from: 'html' });
  });

  it('returns null when nothing in the chain is painted', () => {
    expect(
      firstPaintedColour([
        { tag: 'body', colour: 'rgba(0, 0, 0, 0)' },
        { tag: 'html', colour: 'rgba(0, 0, 0, 0)' },
      ]),
    ).toBeNull();
  });

  it('accepts a partially transparent layer as painted', () => {
    expect(firstPaintedColour([{ tag: 'body', colour: 'rgba(10, 12, 14, 0.5)' }])?.rgb).toEqual([
      10, 12, 14,
    ]);
  });

  it('parses both comma and slash alpha syntax', () => {
    expect(firstPaintedColour([{ tag: 'body', colour: 'rgb(9 9 9 / 0.9)' }])?.rgb).toEqual([
      9, 9, 9,
    ]);
    expect(firstPaintedColour([{ tag: 'body', colour: 'rgb(9 9 9 / 0)' }])).toBeNull();
  });

  it('skips a colour space it cannot read rather than inventing a value', () => {
    expect(
      firstPaintedColour([
        { tag: 'body', colour: 'color(display-p3 0 0 0)' },
        { tag: 'html', colour: 'rgb(17, 17, 17)' },
      ]),
    ).toEqual({ rgb: [17, 17, 17], from: 'html' });
  });
});

describe('browser steps: colour scheme', () => {
  it('emulates a valid scheme and refuses an invalid one', async () => {
    const { page, calls } = fakePage();
    const fixtures = { page, apiContext: fakeContext(), env: fakeEnv() };
    await run('I emulate the {string} colour scheme', fixtures, 'dark');
    expect(calls.media).toEqual([{ colorScheme: 'dark' }]);
    const err = await failure('I emulate the {string} colour scheme', fixtures, 'darkk');
    expect(err).toBeInstanceOf(SdodsError);
    expect((err as SdodsError).hint).toContain('no-preference');
  });

  it('does not accept a transparent body as a dark surface', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [
        {
          found: true,
          chain: [
            { tag: 'body', colour: 'rgba(0, 0, 0, 0)' },
            { tag: 'html', colour: 'rgb(255, 255, 255)' },
          ],
        },
      ],
    });
    const err = await failure('the painted page background should be dark', { page });
    expect(err?.message).toContain('not a dark surface');
    expect(err?.message).toContain('255');
  });

  it('passes on a genuinely dark surface and fails a mid-grey', async () => {
    const dark = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ found: true, chain: [{ tag: 'body', colour: 'rgb(10, 12, 16)' }] }],
    });
    await run('the painted page background should be dark', { page: dark.page });
    const grey = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ found: true, chain: [{ tag: 'body', colour: 'rgb(128, 128, 128)' }] }],
    });
    // A mid-grey is neither: both directions must reject it rather than one silently accepting it.
    expect(
      await failure('the painted page background should be dark', { page: grey.page }),
    ).toBeTruthy();
    const grey2 = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ found: true, chain: [{ tag: 'body', colour: 'rgb(128, 128, 128)' }] }],
    });
    expect(
      await failure('the painted page background should be light', { page: grey2.page }),
    ).toBeTruthy();
    expect(DARK_MAX_CHANNEL).toBeLessThan(LIGHT_MIN_CHANNEL);
  });

  it('fails when every ancestor is transparent, rather than guessing', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [
        {
          found: true,
          chain: [
            { tag: 'body', colour: 'rgba(0, 0, 0, 0)' },
            { tag: 'html', colour: 'rgba(0, 0, 0, 0)' },
          ],
        },
      ],
    });
    const err = await failure('the painted page background should be light', { page });
    expect(err?.message).toContain('transparent');
  });

  it('fails a per-element paint assertion when the selector matches nothing', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ found: false, chain: [] }],
    });
    const err = await failure(
      'the element matching {string} should paint a dark background',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      '.sidebar',
    );
    expect(err?.message).toContain('no element matches ".sidebar"');
  });

  it('asserts the html class list in both directions', async () => {
    const on = fakePage({ url: 'https://app.test/x', evaluates: ['dark antialiased'] });
    await run(
      'the html element should carry the {string} class',
      { page: on.page, apiContext: fakeContext(), env: fakeEnv() },
      'dark',
    );
    const off = fakePage({ url: 'https://app.test/x', evaluates: ['antialiased'] });
    const err = await failure(
      'the html element should carry the {string} class',
      { page: off.page, apiContext: fakeContext(), env: fakeEnv() },
      'dark',
    );
    expect(err?.message).toContain('html class list is "antialiased"');
    const off2 = fakePage({ url: 'https://app.test/x', evaluates: ['antialiased'] });
    await run(
      'the html element should not carry the {string} class',
      { page: off2.page, apiContext: fakeContext(), env: fakeEnv() },
      'dark',
    );
  });

  it('tells the author to arm the first-frame sample instead of passing without one', async () => {
    const { page } = fakePage({ url: 'https://app.test/x', evaluates: [undefined] });
    const err = await failure('the first painted frame should have been dark', { page });
    expect(err).toBeInstanceOf(SdodsError);
    expect((err as SdodsError).hint).toContain('BEFORE the navigation');
  });

  it('catches a light flash recorded on the first frame', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [
        [
          { tag: 'body', colour: 'rgba(0, 0, 0, 0)' },
          { tag: 'html', colour: 'rgb(255, 255, 255)' },
        ],
      ],
    });
    const err = await failure('the first painted frame should have been dark', { page });
    expect(err?.message).toContain('the first painted frame painted rgb(255, 255, 255)');
  });

  it('arms the first-frame sampler as an init script', async () => {
    const { page, calls } = fakePage({ url: 'about:blank' });
    await run('I record the background painted on the first frame', { page });
    expect(calls.initScripts).toHaveLength(1);
    expect(calls.initScripts[0]?.arg).toBe('__sdodsFirstPaintedBackground');
  });
});

/* ── locale ───────────────────────────────────────────────────────────── */

describe('looksLikeMessageKey', () => {
  it('recognises a raw catalogue key', () => {
    for (const key of ['nav.settings', 'billing.plan.upgrade', 'a.b', 'errors.auth.expired_token'])
      expect(looksLikeMessageKey(key), key).toBe(true);
  });

  it('does not mistake ordinary dotted text for a key', () => {
    for (const text of [
      'example.com',
      'app.mybotbox.com',
      'config.json',
      'index.mjs',
      'logo.svg',
      'v1.2.3',
      'x.0',
      'Nav.Settings',
      '3.14',
      'Hello world',
      'settings',
      '',
    ])
      expect(looksLikeMessageKey(text), text).toBe(false);
  });
});

describe('browser steps: locale', () => {
  it('refuses to reload a page that never navigated', async () => {
    // A reload of about:blank succeeds, so without this the locale scenario goes green
    // having proved nothing whatsoever about negotiation.
    const { page } = fakePage({ url: 'about:blank' });
    const err = await failure(
      'I switch the interface locale to {string} using the {string} cookie',
      { page, apiContext: fakeContext(), env: fakeEnv() },
      'fr',
      'NEXT_LOCALE',
    );
    expect(err).toBeInstanceOf(SdodsError);
  });

  it('plants the locale cookie and reloads, interpolating both arguments', async () => {
    const { page, calls } = fakePage({ url: 'https://app.test/x' });
    await run(
      'I switch the interface locale to {string} using the {string} cookie',
      {
        page,
        apiContext: fakeContext({ locale: 'ja' }),
        env: fakeEnv({ cookieName: 'NEXT_LOCALE' }),
      },
      '{{locale}}',
      '{{cookieName}}',
    );
    expect(calls.added).toEqual([{ name: 'NEXT_LOCALE', value: 'ja', url: 'https://app.test' }]);
    expect(calls.reloads).toBe(1);
  });

  it('negotiates through Accept-Language and reloads', async () => {
    const { page, calls } = fakePage({ url: 'https://app.test/x' });
    await run(
      'I request the locale {string} with the Accept-Language header',
      { page, apiContext: fakeContext({ want: 'de-DE' }), env: fakeEnv() },
      '{{want}}',
    );
    expect(calls.headers).toEqual([{ 'Accept-Language': 'de-DE' }]);
    expect(calls.reloads).toBe(1);
  });

  it('asserts the served html lang', async () => {
    const ok = fakePage({ url: 'https://app.test/x', evaluates: ['ja'] });
    await run(
      'the html lang attribute should be {string}',
      { page: ok.page, apiContext: fakeContext({ l: 'ja' }), env: fakeEnv() },
      '{{l}}',
    );
    const missing = fakePage({ url: 'https://app.test/x', evaluates: [null] });
    expect(
      await failure(
        'the html lang attribute should be {string}',
        { page: missing.page, apiContext: fakeContext(), env: fakeEnv() },
        'ja',
      ),
    ).toBeTruthy();
  });

  it('accepts an absent or ltr direction and rejects rtl', async () => {
    for (const dir of [null, '', 'ltr']) {
      const { page } = fakePage({ url: 'https://app.test/x', evaluates: [dir] });
      await run('the html dir attribute should be absent or ltr', { page });
    }
    const rtl = fakePage({ url: 'https://app.test/x', evaluates: ['rtl'] });
    const err = await failure('the html dir attribute should be absent or ltr', { page: rtl.page });
    expect(err?.message).toContain('html dir="rtl"');
  });

  it('fails on a page with no visible text rather than reporting no raw keys', async () => {
    const { page } = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ sampled: 0, tokens: [] }],
    });
    const err = await failure('no visible text should look like a raw message key', { page });
    expect(err?.message).toContain('rendered no visible text at all');
  });

  it('reports the raw keys it found and passes a translated page', async () => {
    const bad = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ sampled: 40, tokens: ['Settings', 'nav.workspaces', 'example.com'] }],
    });
    const err = await failure('no visible text should look like a raw message key', {
      page: bad.page,
    });
    expect(err?.message).toContain('nav.workspaces');
    const good = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ sampled: 40, tokens: ['Settings', 'example.com', 'v2.1.0'] }],
    });
    await run('no visible text should look like a raw message key', { page: good.page });
  });
});

/* ── console ──────────────────────────────────────────────────────────── */

describe('browser steps: console and page errors', () => {
  let apiContext: ReturnType<typeof fakeContext>;
  beforeEach(() => {
    apiContext = fakeContext();
  });

  const emit = (calls: ReturnType<typeof fakePage>['calls'], event: string, payload: unknown) => {
    for (const l of calls.listeners)
      if (l.event === event) (l.handler as (a: unknown) => void)(payload);
  };
  const consoleMsg = (type: string, text: string) => ({ type: () => type, text: () => text });

  it('refuses every assertion when the recorder was never armed', async () => {
    for (const pattern of [
      'no console error should have been recorded',
      'no uncaught page error should have been recorded',
    ]) {
      const err = await failure(pattern, { apiContext, env: fakeEnv() });
      expect(err, pattern).toBeInstanceOf(SdodsError);
      expect((err as SdodsError).hint).toContain('BEFORE the navigation');
    }
  });

  it('is idempotent, so a Background and a Scenario cannot double-count', async () => {
    const { page, calls } = fakePage();
    await run('I start recording console messages', { page, apiContext });
    await run('I start recording console messages', { page, apiContext });
    expect(calls.listeners.filter((l) => l.event === 'console')).toHaveLength(1);
  });

  it('keeps errors, warnings and uncaught exceptions in separate buckets', async () => {
    const { page, calls } = fakePage();
    await run('I start recording console messages', { page, apiContext });
    emit(calls, 'console', consoleMsg('warning', 'MISSING_MESSAGE: nav.settings'));
    emit(calls, 'console', consoleMsg('info', 'hello'));
    emit(calls, 'pageerror', { message: 'Cannot read properties of undefined' });

    // A warning is not an error: folding them together would widen "no console error" into
    // something no team can hold green, and this proves it does not.
    await run('no console error should have been recorded', { apiContext });
    expect(
      await failure(
        'no console warning should match {string}',
        { apiContext, env: fakeEnv() },
        'MISSING_MESSAGE',
      ),
    ).toBeTruthy();

    // An uncaught exception is not a console error either.
    const pageErr = await failure('no uncaught page error should have been recorded', {
      apiContext,
    });
    expect(pageErr?.message).toContain('Cannot read properties of undefined');
  });

  it('matches an error pattern and interpolates it', async () => {
    const { page, calls } = fakePage();
    await run('I start recording console messages', { page, apiContext });
    emit(calls, 'console', consoleMsg('error', 'Hydration failed for workspace acme'));
    const env = fakeEnv({ tenant: 'acme' });
    const err = await failure(
      'no console error should match {string}',
      { apiContext, env },
      'workspace {{tenant}}',
    );
    expect(err?.message).toContain('workspace acme');
    await run('no console error should match {string}', { apiContext, env }, 'workspace other');
  });

  it('refuses an unusable pattern as a misuse rather than throwing a bare SyntaxError', async () => {
    const { page } = fakePage();
    await run('I start recording console messages', { page, apiContext });
    const err = await failure(
      'no console error should match {string}',
      { apiContext, env: fakeEnv() },
      '[',
    );
    expect(err).toBeInstanceOf(SdodsError);
    expect((err as SdodsError).hint).toContain('regular expression');
  });

  it('provides the positive direction, which is what keeps the negative ones honest', async () => {
    const { page, calls } = fakePage();
    await run('I start recording console messages', { page, apiContext });
    const env = fakeEnv();
    const before = await failure(
      'a console error matching {string} should have been recorded',
      { apiContext, env },
      'quota',
    );
    expect(before?.message).toContain('(none)');
    emit(calls, 'console', consoleMsg('error', 'quota exceeded'));
    await run(
      'a console error matching {string} should have been recorded',
      { apiContext, env },
      'quota',
    );
  });

  it('scopes the recording to one scenario, never to the module', async () => {
    const first = fakeContext();
    const second = fakeContext();
    const { page, calls } = fakePage();
    await run('I start recording console messages', { page, apiContext: first });
    emit(calls, 'console', consoleMsg('error', 'boom'));
    expect(
      await failure('no console error should have been recorded', { apiContext: first }),
    ).toBeTruthy();
    // A different scenario must not inherit the recording, and must say so rather than pass.
    const err = await failure('no console error should have been recorded', { apiContext: second });
    expect(err).toBeInstanceOf(SdodsError);
  });
});

/* ── per-scenario emulation: the `I use …` family (#116) ─────────────── */

describe('browser steps: emulation', () => {
  const base = () => ({ apiContext: fakeContext({ lang: 'fr-FR' }), env: fakeEnv() });

  it('I use the locale passes when the context already has it, canonicalising case', async () => {
    await run('I use the locale {string}', { ...base(), locale: 'fr-FR' }, '{{lang}}');
    await run('I use the locale {string}', { ...base(), locale: 'fr-FR' }, 'fr-fr');
  });

  it('I use the locale fails on an open context with another locale, naming the tag', async () => {
    const err = await failure('I use the locale {string}', { ...base(), locale: 'en-US' }, 'de-DE');
    expect(err).toBeInstanceOf(SdodsError);
    expect(err?.message).toContain('"en-US"');
    expect(err?.message).toContain('@locale:de-DE');
  });

  it('I use the locale refuses a value that is not a locale', async () => {
    const err = await failure('I use the locale {string}', { ...base(), locale: 'en-US' }, 'fr_FR');
    expect(err?.message).toContain('hyphen');
  });

  it('I use the timezone passes on a match and names @timezone: otherwise', async () => {
    await run('I use the timezone {string}', { ...base(), timezoneId: 'Asia/Tokyo' }, 'Asia/Tokyo');
    const err = await failure(
      'I use the timezone {string}',
      { ...base(), timezoneId: undefined },
      'Asia/Tokyo',
    );
    expect(err?.message).toContain('(the system default)');
    expect(err?.message).toContain('@timezone:Asia/Tokyo');
    expect(
      (await failure('I use the timezone {string}', { ...base() }, 'Mars/Olympus'))?.message,
    ).toContain('IANA');
  });

  it('I use the color scheme applies on the live page and refuses a typo', async () => {
    const { page, calls } = fakePage();
    await run('I use the {string} color scheme', { ...base(), page }, 'dark');
    expect(calls.media).toEqual([{ colorScheme: 'dark' }]);
    const err = await failure('I use the {string} color scheme', { ...base(), page }, 'dim');
    expect((err as SdodsError).hint).toContain('no-preference');
  });

  it('I use the viewport resizes the live page and refuses a zero dimension', async () => {
    const { page, calls } = fakePage();
    await run('I use the viewport {int} by {int}', { page }, 320, 640);
    expect(calls.viewport).toEqual([{ width: 320, height: 640 }]);
    expect(await failure('I use the viewport {int} by {int}', { page }, 0, 640)).toBeInstanceOf(
      SdodsError,
    );
  });

  it('I use the device passes only when @device: created the context with it', async () => {
    const tagged = { ...base(), $sdodsEmulation: emulationFromTags(['@device:iPhone-15']) };
    await run('I use the device {string}', tagged, 'iPhone 15');
    const untagged = { ...base(), $sdodsEmulation: emulationFromTags([]) };
    const err = await failure('I use the device {string}', untagged, 'iPhone 15');
    expect(err?.message).toContain('@device:iPhone-15');
    expect((await failure('I use the device {string}', untagged, 'Nokia 3310'))?.message).toContain(
      'not a Playwright device',
    );
  });

  it('the reflow phrasing runs the same measurement, blank-page guard included', async () => {
    const blank = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ bodyChildren: 0, scrollWidth: 320, clientWidth: 320, offenders: [] }],
    });
    expect(
      (await failure('the page should reflow without horizontal scrolling', { page: blank.page }))
        ?.message,
    ).toContain('the document body is empty');
    const wide = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ bodyChildren: 2, scrollWidth: 412, clientWidth: 320, offenders: ['nav.x'] }],
    });
    expect(
      (await failure('the page should reflow without horizontal scrolling', { page: wide.page }))
        ?.message,
    ).toContain('nav.x');
  });
});

describe('untranslated keys', () => {
  it('flags raw keys, unrendered placeholders and library missing markers', () => {
    expect(
      findUntranslated([
        'Settings',
        'nav.settings',
        'Hello {{ name }}',
        '[missing "fr.nav.home" translation]',
        'translation missing: fr.nav.home',
      ]),
    ).toEqual([
      'nav.settings',
      'Hello {{ name }}',
      '[missing "fr.nav.home" translation]',
      'translation missing: fr.nav.home',
    ]);
  });

  it('does not flag file names, hostnames, versions, prose or empty braces', () => {
    expect(
      findUntranslated(['docs.sdods.com', 'report.pdf', 'v2.1.0', 'e.g. this', 'Use {} here']),
    ).toEqual([]);
  });

  it('a custom pattern replaces the defaults', () => {
    expect(findUntranslated(['SETTINGS_TITLE', 'nav.settings'], /^[A-Z0-9_]{3,}$/)).toEqual([
      'SETTINGS_TITLE',
    ]);
  });

  it('fails on a page with no visible text, and reports what it found', async () => {
    const empty = fakePage({ url: 'https://app.test/x', evaluates: [{ sampled: 0, texts: [] }] });
    expect(
      (await failure('the page should have no untranslated keys', { page: empty.page }))?.message,
    ).toContain('rendered no visible text at all');
    const bad = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ sampled: 2, texts: ['Bonjour', 'Hi {{user}}'] }],
    });
    expect(
      (await failure('the page should have no untranslated keys', { page: bad.page }))?.message,
    ).toContain('Hi {{user}}');
    const custom = fakePage({
      url: 'https://app.test/x',
      evaluates: [{ sampled: 2, texts: ['Bonjour', 'NAV_HOME'] }],
    });
    const err = await failure(
      'the page should have no untranslated keys matching {string}',
      { page: custom.page, apiContext: fakeContext(), env: fakeEnv() },
      '^[A-Z_]+$',
    );
    expect(err?.message).toContain('NAV_HOME');
  });

  it('refuses to run before the page navigated', async () => {
    const { page } = fakePage();
    expect(await failure('the page should have no untranslated keys', { page })).toBeInstanceOf(
      SdodsError,
    );
  });
});
