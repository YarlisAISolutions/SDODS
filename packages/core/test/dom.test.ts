import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import type * as PlaywrightTestModule from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Shrinks Playwright's default expect retry window for the steps under test. The matchers are
 * unchanged — only how long they retry before giving up — so a "must fail" case costs a second
 * rather than five. The two hold-window steps pass their own explicit timeouts and are unaffected.
 */
vi.mock('@playwright/test', async (importOriginal) => {
  const actual = await importOriginal<typeof PlaywrightTestModule>();
  return { ...actual, expect: actual.expect.configure({ timeout: 1500 }) };
});

import { ApiContext } from '../src/fixtures/api-context.js';
import { SdodsError } from '../src/errors.js';
import { Healer } from '../src/heal/healer.js';
import '../src/steps/dom.steps.js';

/**
 * These tests drive the real step functions against a real Chromium page, because the property
 * that matters — "no step may pass vacuously when the thing it checks is absent" — is only
 * observable by running the step and watching it FAIL. Every assertion step below is exercised in
 * both directions; a step that could only be shown to pass has not been tested at all.
 *
 * Failure cases are awaited concurrently wherever the DOM is read-only, so the suite pays one
 * Playwright retry window rather than one per assertion.
 */

type StepFn = (fixtures: Record<string, unknown>, ...args: unknown[]) => Promise<unknown>;
interface RegisteredStep {
  keyword: string;
  pattern: string;
  fn: StepFn;
}

interface RawStepDefinition {
  keyword: string;
  pattern: string | RegExp;
  fn: StepFn;
  matchStepText(text: string): unknown;
}

/** playwright-bdd keeps one global registry; it is not reachable through the package exports. */
function rawSteps(): RawStepDefinition[] {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('playwright-bdd');
  const registry = require(entry.replace(/index\.js$/, 'steps/stepRegistry.js')) as {
    stepDefinitions: RawStepDefinition[];
  };
  return registry.stepDefinitions;
}

function registeredSteps(): RegisteredStep[] {
  return rawSteps().map((d) => ({ keyword: d.keyword, pattern: String(d.pattern), fn: d.fn }));
}

const STEPS_DIR = fileURLToPath(new URL('../src/steps/', import.meta.url));

/** Loads every sibling step library, so ambiguity is judged against the whole shipped set. */
async function loadEveryStepLibrary(): Promise<string[]> {
  const files = readdirSync(STEPS_DIR)
    .filter((f) => f.endsWith('.steps.ts'))
    .sort();
  for (const file of files) await import(pathToFileURL(join(STEPS_DIR, file)).href);
  return files;
}

/** One concrete Gherkin line per pattern, so ambiguity is tested the way bddgen sees it. */
function concreteStepText(pattern: string): string {
  return pattern
    .replace(/\{string\}/g, '"x"')
    .replace(/\{int\}/g, '1')
    .replace(/\{float\}/g, '1.5')
    .replace(/\{role\}/g, 'button')
    .replace(/\{method\}/g, 'GET')
    .replace(/\{word\}/g, 'x');
}

const DOM_PATTERNS = [
  'the element with test id {string} should not be visible',
  'the element with test id {string} should not exist',
  'the {string} {role} should not be visible',
  'no {string} {role} should exist',
  'the {string} {role} should stay absent for {int} seconds',
  'the text {string} should appear anywhere on the page',
  'the text {string} should not appear anywhere on the page',
  'the {string} {role} should be enabled',
  'the {string} {role} should be disabled',
  'the {string} {role} should stay disabled for {int} seconds',
  'the {string} {role} should be absent or disabled',
  'the element with test id {string} should be enabled',
  'the element with test id {string} should be disabled',
  'the element with test id {string} should be absent or disabled',
  'the {string} checkbox should be checked',
  'the {string} checkbox should not be checked',
  'I click the first element with test id {string}',
  'I click the element with test id {string} at position {int}',
  'I click the first {string} {role}',
  'I click the {string} {role} at position {int}',
  'I fill the first element with test id {string} with {string}',
  'I fill the element with test id {string} at position {int} with {string}',
  'the first element with test id {string} should be visible',
  'the element with test id {string} at position {int} should be visible',
  'the element with test id {string} at position {int} should contain {string}',
  'the first {string} {role} should be visible',
  'the {string} {role} at position {int} should be visible',
  'the element with test id {string} should have exactly {int} matches',
  'the element with test id {string} should have at least {int} matches',
  'there should be exactly {int} {string} {role} elements',
  'there should be at least {int} {string} {role} elements',
  'the focused element should be named {string}',
  'the focused element should be visible',
  'the focused element should be inside the open dialog',
  'focus should be on the {string} {role}',
  'I replace the focused field with {string}',
  'I press {string} {int} times',
  'I press {string} {int} times recording every focused element',
  'every recorded focus should have stayed inside the dialog',
  'I tab to the first focusable element inside the {string} {role}',
  'I tab to the first focusable element inside the element with test id {string}',
  'a dialog should be open',
  'no dialog should be open',
  'I fill the open dialog field with {string}',
  'I fill the open alert dialog field with {string}',
  'I fill the open popover field with {string}',
  'I fill the {string} field of the open dialog with {string}',
] as const;

let browser: Browser;
let page: Page;
let apiContext: ApiContext;
let heal: Healer;
let steps: Map<string, StepFn>;

const env = { vars: {} as Record<string, unknown> };

/** Short windows so a failing assertion costs a second, not five. */
function makeHealer() {
  return new Healer({
    config: {
      enabled: true,
      primaryTimeoutMs: 400,
      probeTimeoutMs: 300,
      minScore: 0.6,
      actions: ['click', 'fill', 'select', 'assert', 'hover', 'check'],
    },
  });
}

function run(pattern: string, ...args: unknown[]): Promise<unknown> {
  const fn = steps.get(pattern);
  if (!fn) throw new Error(`step is not registered: "${pattern}"`);
  return Promise.resolve(fn({ page, heal, apiContext, env }, ...args));
}

/** Asserts the step failed AND that it failed for the stated reason, not incidentally. */
async function failsWith(pattern: string, args: unknown[], match: RegExp): Promise<Error> {
  let caught: unknown;
  try {
    await run(pattern, ...args);
  } catch (e) {
    caught = e;
  }
  expect(caught, `"${pattern}" passed but should have failed`).toBeDefined();
  const error = caught as Error;
  expect(`${error.message}`, `"${pattern}" failed for the wrong reason: ${error.message}`).toMatch(
    match,
  );
  return error;
}

async function setContent(html: string): Promise<void> {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
}

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  steps = new Map(registeredSteps().map((s) => [s.pattern, s.fn]));
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(() => {
  apiContext = new ApiContext();
  heal = makeHealer();
  env.vars = {};
});

/* ── registration ─────────────────────────────────────────────────────── */

describe('dom.steps registration', () => {
  it('registers every documented pattern exactly once', () => {
    const mine = registeredSteps().filter((s) =>
      (DOM_PATTERNS as readonly string[]).includes(s.pattern),
    );
    for (const pattern of DOM_PATTERNS) {
      expect(mine.filter((s) => s.pattern === pattern).length, `pattern "${pattern}"`).toBe(1);
    }
  });

  it('leaves no step TEXT ambiguous across the whole shipped library', async () => {
    // Exact-string uniqueness is not the property bddgen enforces: it refuses a step whose TEXT
    // matches more than one definition, and two different patterns can both match one line. This
    // loads every sibling step file — an ambiguity introduced anywhere breaks generation for all
    // of them, so the check has to be over the whole set, not just this file's.
    const files = await loadEveryStepLibrary();
    expect(files, 'no step libraries were loaded').toContain('dom.steps.ts');
    const all = rawSteps();
    for (const pattern of DOM_PATTERNS) {
      const text = concreteStepText(pattern);
      const matched = all
        .filter((d) => Boolean(d.matchStepText(text)))
        .map((d) => String(d.pattern));
      expect(matched, `"${text}" is matched by more than one step definition`).toEqual([pattern]);
    }
  });
});

/* ── negative visibility and existence ────────────────────────────────── */

describe('negative visibility and existence', () => {
  it('passes when the element is hidden, absent, or was never rendered', async () => {
    await setContent(`
      <div data-testid="hidden-row" style="display:none">Row</div>
      <button style="display:none">Delete</button>
    `);
    await run('the element with test id {string} should not be visible', 'hidden-row');
    await run('the element with test id {string} should not exist', 'never-rendered');
    await run('the {string} {role} should not be visible', 'Delete', 'button');
    await run('no {string} {role} should exist', 'Archive', 'button');
  }, 60_000);

  it('fails when the element is present — every one of them', async () => {
    await setContent(`<div data-testid="row">Row</div><button>Delete</button>`);
    await Promise.all([
      failsWith(
        'the element with test id {string} should not be visible',
        ['row'],
        /hidden|visible/i,
      ),
      failsWith('the element with test id {string} should not exist', ['row'], /count|expected/i),
      failsWith(
        'the {string} {role} should not be visible',
        ['Delete', 'button'],
        /hidden|visible/i,
      ),
      failsWith('no {string} {role} should exist', ['Delete', 'button'], /count|expected/i),
    ]);
  }, 60_000);

  it('holds an absence across a window, so a late render cannot slip past', async () => {
    await setContent(`
      <div id="host"></div>
      <script>
        setTimeout(() => {
          const b = document.createElement('button');
          b.textContent = 'Delete';
          document.getElementById('host').append(b);
        }, 600);
      </script>
    `);
    await failsWith(
      'the {string} {role} should stay absent for {int} seconds',
      ['Delete', 'button', 3],
      /appeared during the 3s hold|count/i,
    );
  }, 60_000);

  it('refuses a zero-second hold rather than degrading to a single-shot check', async () => {
    await setContent('<p>empty</p>');
    const error = await failsWith(
      'the {string} {role} should stay absent for {int} seconds',
      ['Delete', 'button', 0],
      /not a duration/i,
    );
    expect(error).toBeInstanceOf(SdodsError);
  }, 60_000);
});

/* ── interpolation ────────────────────────────────────────────────────── */

describe('{{var}} interpolation', () => {
  it('renders the test id, so a templated locator resolves to the real node', async () => {
    apiContext.vars.set('rowId', '7');
    await setContent('<div data-testid="row-7">Row seven</div>');
    // If the id were NOT rendered, the locator would look for the literal "row-{{rowId}}",
    // match nothing, and this negative step would pass — the silent-no-interpolation defect.
    await failsWith(
      'the element with test id {string} should not exist',
      ['row-{{rowId}}'],
      /count|expected/i,
    );
    await run('the element with test id {string} should not exist', 'row-{{rowId}}-missing');
  }, 60_000);

  it('renders the accessible name of a role locator', async () => {
    apiContext.vars.set('label', 'Delete workspace');
    await setContent('<button>Delete workspace</button>');
    await failsWith('no {string} {role} should exist', ['{{label}}', 'button'], /count|expected/i);
  }, 60_000);

  it('falls back to env vars when the scenario has not set one', async () => {
    env.vars = { tenant: 'acme' };
    await setContent('<div data-testid="ws-acme">Acme</div>');
    await run('the first element with test id {string} should be visible', 'ws-{{tenant}}');
    await failsWith(
      'the element with test id {string} should not exist',
      ['ws-{{tenant}}'],
      /count|expected/i,
    );
  }, 60_000);

  it('renders values written into an overlay field', async () => {
    apiContext.vars.set('keyName', 'ci-token');
    await setContent('<div role="dialog"><input id="f" aria-label="Name"></div>');
    await run('I fill the open dialog field with {string}', '{{keyName}}');
    expect(await page.locator('#f').inputValue()).toBe('ci-token');
  }, 60_000);

  it('renders the needle of a page-wide text assertion', async () => {
    apiContext.vars.set('secret', 'sk-live-42');
    await setContent('<p>token sk-live-42 leaked</p>');
    await failsWith(
      'the text {string} should not appear anywhere on the page',
      ['{{secret}}'],
      /rendered somewhere/i,
    );
  }, 60_000);
});

/* ── enabled / disabled / checked ─────────────────────────────────────── */

describe('enabled, disabled and checked state', () => {
  it('reads the settled state in both directions', async () => {
    await setContent(`
      <button disabled>Delete</button>
      <button>Save</button>
      <div data-testid="run"><button disabled>x</button></div>
      <input data-testid="live" >
      <label for="trust">Trust this device</label><input id="trust" type="checkbox">
      <label for="news">Newsletter</label><input id="news" type="checkbox" checked>
    `);
    await run('the {string} {role} should be disabled', 'Delete', 'button');
    await run('the {string} {role} should be enabled', 'Save', 'button');
    await run('the {string} {role} should be absent or disabled', 'Delete', 'button');
    await run('the {string} {role} should be absent or disabled', 'Archive', 'button');
    await run('the element with test id {string} should be enabled', 'live');
    await run('the {string} checkbox should not be checked', 'Trust this device');
    await run('the {string} checkbox should be checked', 'Newsletter');
  }, 60_000);

  it('fails when the control is actionable, missing, or checked by default', async () => {
    await setContent(`
      <button>Delete</button>
      <button disabled>Save</button>
      <label for="trust">Trust this device</label><input id="trust" type="checkbox" checked>
    `);
    await Promise.all([
      failsWith('the {string} {role} should be disabled', ['Delete', 'button'], /disabled/i),
      failsWith(
        'the {string} {role} should be disabled',
        ['Ghost', 'button'],
        /disabled|not found|resolve/i,
      ),
      failsWith('the {string} {role} should be enabled', ['Save', 'button'], /enabled/i),
      failsWith(
        'the {string} {role} should be absent or disabled',
        ['Delete', 'button'],
        /disabled/i,
      ),
      failsWith('the {string} checkbox should not be checked', ['Trust this device'], /checked/i),
    ]);
  }, 90_000);

  it('names the missing checkbox rather than timing out on it', async () => {
    // Playwright fails `not.toBeChecked()` on a missing locator anyway; the guard is here so the
    // failure says which checkbox was never rendered instead of reading as a flaky assertion.
    await setContent('<p>no checkbox here</p>');
    await failsWith(
      'the {string} checkbox should not be checked',
      ['Trust this device'],
      /no "Trust this device" checkbox is rendered/i,
    );
  }, 60_000);

  it('catches a control that is only disabled while its permissions load', async () => {
    await setContent(`
      <button id="danger" disabled>Delete</button>
      <script>setTimeout(() => { document.getElementById('danger').disabled = false }, 600)</script>
    `);
    // The plain assertion passes here — that is precisely the trap.
    await run('the {string} {role} should be disabled', 'Delete', 'button');
    await failsWith(
      'the {string} {role} should stay disabled for {int} seconds',
      ['Delete', 'button', 3],
      /became enabled during the 3s hold|disabled/i,
    );
  }, 60_000);
});

/* ── ordinal selection ────────────────────────────────────────────────── */

describe('ordinal selection', () => {
  const list = `
    <ul>
      <li data-testid="row"><button>Open</button><span>alpha</span></li>
      <li data-testid="row"><button>Open</button><span>beta</span></li>
      <li data-testid="row"><button>Open</button><span>gamma</span></li>
    </ul>
    <input data-testid="cell"><input data-testid="cell"><input data-testid="cell">
    <p id="log"></p>
    <script>
      document.querySelectorAll('[data-testid="row"] button').forEach((b, i) => {
        b.addEventListener('click', () => { document.getElementById('log').textContent = 'row' + (i + 1) })
      })
    </script>`;

  it('acts on the first match where the built-in step can only report ambiguity', async () => {
    await setContent(list);
    await run('I click the first {string} {role}', 'Open', 'button');
    expect(await page.locator('#log').textContent()).toBe('row1');
    await run('the first element with test id {string} should be visible', 'row');
    await run('the first {string} {role} should be visible', 'Open', 'button');
  }, 60_000);

  it('addresses the nth match, 1-based', async () => {
    await setContent(list);
    await run('I click the {string} {role} at position {int}', 'Open', 'button', 3);
    expect(await page.locator('#log').textContent()).toBe('row3');
    await run('the element with test id {string} at position {int} should be visible', 'row', 2);
    await run(
      'the element with test id {string} at position {int} should contain {string}',
      'row',
      2,
      'beta',
    );
    await run(
      'I fill the element with test id {string} at position {int} with {string}',
      'cell',
      2,
      'B',
    );
    expect(await page.locator('[data-testid="cell"]').nth(1).inputValue()).toBe('B');
    await run('I fill the first element with test id {string} with {string}', 'cell', 'A');
    expect(await page.locator('[data-testid="cell"]').nth(0).inputValue()).toBe('A');
  }, 60_000);

  it('refuses position 0, which Playwright would read as "the last match"', async () => {
    await setContent(list);
    for (const [pattern, args] of [
      ['I click the element with test id {string} at position {int}', ['row', 0]],
      ['the element with test id {string} at position {int} should be visible', ['row', 0]],
      ['the {string} {role} at position {int} should be visible', ['Open', 'button', -1]],
    ] as Array<[string, unknown[]]>) {
      const error = await failsWith(pattern, args, /not a valid position/i);
      expect(error).toBeInstanceOf(SdodsError);
      expect((error as SdodsError).hint).toMatch(/1-based/i);
    }
    // The trap made concrete: nth(-1) is the LAST row, so an unguarded step would have passed.
    expect(await page.locator('[data-testid="row"]').nth(-1).textContent()).toContain('gamma');
  }, 60_000);

  it('fails when the list is shorter than the position asked for', async () => {
    await setContent(list);
    await Promise.all([
      failsWith(
        'the element with test id {string} at position {int} should be visible',
        ['row', 9],
        /position 9|visible/i,
      ),
      failsWith(
        'I click the {string} {role} at position {int}',
        ['Open', 'button', 9],
        /at least 9/i,
      ),
    ]);
    expect(await page.locator('#log').textContent()).toBe('');
  }, 60_000);
});

/* ── counting ─────────────────────────────────────────────────────────── */

describe('counting', () => {
  it('counts exact and floor matches', async () => {
    await setContent(`
      <div data-testid="row">1</div><div data-testid="row">2</div><div data-testid="row">3</div>
      <button>Open</button><button>Open</button>
    `);
    await run('the element with test id {string} should have exactly {int} matches', 'row', 3);
    await run('the element with test id {string} should have at least {int} matches', 'row', 2);
    await run('there should be exactly {int} {string} {role} elements', 2, 'Open', 'button');
    await run('there should be at least {int} {string} {role} elements', 1, 'Open', 'button');
  }, 60_000);

  it('fails on the wrong count and on an unmet floor', async () => {
    await setContent('<div data-testid="row">1</div>');
    await Promise.all([
      failsWith(
        'the element with test id {string} should have exactly {int} matches',
        ['row', 3],
        /count|expected/i,
      ),
      failsWith(
        'the element with test id {string} should have at least {int} matches',
        ['row', 4],
        /at least 4/i,
      ),
      failsWith(
        'there should be exactly {int} {string} {role} elements',
        [1, 'Open', 'button'],
        /count|expected/i,
      ),
    ]);
  }, 60_000);

  it('refuses "at least 0", which every page on earth satisfies', async () => {
    await setContent('<p>nothing</p>');
    for (const [pattern, args] of [
      ['the element with test id {string} should have at least {int} matches', ['row', 0]],
      ['there should be at least {int} {string} {role} elements', [0, 'Open', 'button']],
    ] as Array<[string, unknown[]]>) {
      const error = await failsWith(pattern, args, /is not an assertion about/i);
      expect(error).toBeInstanceOf(SdodsError);
    }
  }, 60_000);
});

/* ── focus ────────────────────────────────────────────────────────────── */

describe('focus', () => {
  it('reads the focused element and where it sits', async () => {
    await setContent(`
      <div role="dialog"><button id="ok" aria-label="Confirm delete">OK</button></div>
      <script>document.getElementById('ok').focus()</script>
    `);
    await run('the focused element should be named {string}', 'Confirm delete');
    await run('the focused element should be visible');
    await run('the focused element should be inside the open dialog');
    await run('focus should be on the {string} {role}', 'Confirm delete', 'button');
  }, 60_000);

  it('does NOT treat body focus as "the focused element"', async () => {
    // The trap: document.activeElement falls back to <body>, whose text is the whole page. An
    // unguarded name match therefore passes for essentially any string on the page.
    await setContent('<p>Confirm delete</p><div role="dialog">dialog text</div>');
    await Promise.all([
      failsWith(
        'the focused element should be named {string}',
        ['Confirm delete'],
        /nothing is focused/i,
      ),
      failsWith('the focused element should be visible', [], /nothing is focused/i),
      failsWith('the focused element should be inside the open dialog', [], /nothing is focused/i),
      failsWith(
        'focus should be on the {string} {role}',
        ['Confirm delete', 'button'],
        /nothing on the page is focused/i,
      ),
    ]);
  }, 60_000);

  it('fails when focus is on the wrong element, outside the dialog, or unpainted', async () => {
    await setContent(`
      <button id="outside">Cancel</button>
      <div role="dialog"><button>OK</button></div>
      <script>document.getElementById('outside').focus()</script>
    `);
    await failsWith('the focused element should be named {string}', ['OK'], /not on "OK"/i);
    await failsWith(
      'the focused element should be inside the open dialog',
      [],
      /escaped to <button>/i,
    );

    // The classic keyboard dead end: a control parked off-screen that still takes focus.
    await setContent(`
      <button id="ghost" style="position:absolute;left:-9999px;top:-9999px">Ghost</button>
      <script>document.getElementById('ghost').focus()</script>
    `);
    await failsWith('the focused element should be visible', [], /not painted/i);
  }, 60_000);

  it('says "no dialog is open" rather than "focus escaped" when there is no dialog', async () => {
    await setContent(
      '<button id="b">Go</button><script>document.getElementById("b").focus()</script>',
    );
    await failsWith(
      'the focused element should be inside the open dialog',
      [],
      /no dialog is open/i,
    );
  }, 60_000);

  it('replaces the value of an auto-focused, unlabelled field', async () => {
    apiContext.vars.set('newName', 'Renamed');
    await setContent(
      '<input id="rename" value="old"><script>document.getElementById("rename").focus()</script>',
    );
    await run('I replace the focused field with {string}', '{{newName}}');
    expect(await page.locator('#rename').inputValue()).toBe('Renamed');
  }, 60_000);

  it('refuses to type when nothing editable is focused', async () => {
    await setContent('<p>nothing focused</p>');
    await failsWith(
      'I replace the focused field with {string}',
      ['x'],
      /no editable element is focused|count/i,
    );
  }, 60_000);
});

/* ── keyboard ─────────────────────────────────────────────────────────── */

describe('keyboard walks', () => {
  const trap = `
    <div role="dialog" id="d">
      <button>One</button><button>Two</button><button>Three</button>
    </div>
    <script>
      const d = document.getElementById('d')
      const items = () => Array.from(d.querySelectorAll('button'))
      items()[0].focus()
      d.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return
        e.preventDefault()
        const list = items()
        const i = list.indexOf(document.activeElement)
        list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus()
      })
    </script>`;

  it('records a focus walk and proves the dialog trapped it', async () => {
    await setContent(trap);
    await run('I press {string} {int} times recording every focused element', 'Tab', 5);
    await run('every recorded focus should have stayed inside the dialog');
  }, 60_000);

  it('catches focus that leaks out of a dialog that does not trap', async () => {
    await setContent(`
      <div role="dialog"><button id="first">One</button></div>
      <button>Behind</button>
      <script>document.getElementById('first').focus()</script>
    `);
    await run('I press {string} {int} times recording every focused element', 'Tab', 3);
    await failsWith(
      'every recorded focus should have stayed inside the dialog',
      [],
      /focus left the dialog on \d+ of 3 presses/i,
    );
  }, 60_000);

  it('refuses to judge a walk that was never recorded', async () => {
    await setContent(trap);
    const error = await failsWith(
      'every recorded focus should have stayed inside the dialog',
      [],
      /no focus walk has been recorded/i,
    );
    expect(error).toBeInstanceOf(SdodsError);
    expect((error as SdodsError).hint).toMatch(/recording every focused element/);
  }, 60_000);

  it('refuses a zero-press walk, which "every recorded focus" would call clean', async () => {
    await setContent(trap);
    for (const pattern of [
      'I press {string} {int} times',
      'I press {string} {int} times recording every focused element',
    ]) {
      const error = await failsWith(pattern, ['Tab', 0], /not a number of key presses/i);
      expect(error).toBeInstanceOf(SdodsError);
    }
  }, 60_000);

  it('presses a key the requested number of times, interpolating the key', async () => {
    apiContext.vars.set('letter', 'a');
    await setContent('<input id="i"><script>document.getElementById("i").focus()</script>');
    await run('I press {string} {int} times', '{{letter}}', 4);
    expect(await page.locator('#i').inputValue()).toBe('aaaa');
  }, 60_000);

  it('walks real tab stops into a region, not a programmatic focus', async () => {
    await setContent(`
      <button>Before</button>
      <nav aria-label="Sections" data-testid="sections">
        <button>General</button><button>Members</button>
      </nav>
    `);
    await run(
      'I tab to the first focusable element inside the {string} {role}',
      'Sections',
      'navigation',
    );
    await run('focus should be on the {string} {role}', 'General', 'button');

    await setContent(`
      <button>Before</button>
      <nav aria-label="Sections" data-testid="sections">
        <button>General</button>
      </nav>
    `);
    await run(
      'I tab to the first focusable element inside the element with test id {string}',
      'sections',
    );
    await run('focus should be on the {string} {role}', 'General', 'button');
  }, 60_000);

  it('fails when the region is off the tab ring — the click-only-div bug', async () => {
    await setContent(`
      <nav aria-label="Sections" data-testid="sections">
        <div onclick="void 0">General</div><div onclick="void 0">Members</div>
      </nav>
    `);
    const error = await failsWith(
      'I tab to the first focusable element inside the {string} {role}',
      ['Sections', 'navigation'],
      /no visible focusable element|visible/i,
    );
    expect(error).toBeTruthy();
  }, 60_000);
});

/* ── overlays ─────────────────────────────────────────────────────────── */

describe('open overlays', () => {
  it('detects an open and a closed modal surface', async () => {
    await setContent('<div role="dialog">Confirm?</div>');
    await run('a dialog should be open');
    await failsWith('no dialog should be open', [], /count|expected/i);

    await setContent('<p>closed</p>');
    await run('no dialog should be open');
    await failsWith('a dialog should be open', [], /visible/i);
  }, 60_000);

  it('reaches the unlabelled field of a portalled overlay outside the trigger subtree', async () => {
    await setContent(`
      <div id="trigger"><button>Rename</button></div>
      <div role="dialog"><input id="dialog-field" placeholder="New name"></div>
      <div data-radix-popper-content-wrapper><input id="popover-field"></div>
    `);
    await run('I fill the open dialog field with {string}', 'renamed');
    expect(await page.locator('#dialog-field').inputValue()).toBe('renamed');
    await run('I fill the open popover field with {string}', '12');
    expect(await page.locator('#popover-field').inputValue()).toBe('12');
    // The point of the step: the field is NOT inside the trigger's subtree.
    expect(await page.locator('#trigger input').count()).toBe(0);
  }, 60_000);

  it('targets the alert dialog stacked on top of an already-open dialog', async () => {
    await setContent(`
      <div role="dialog"><input id="behind" value="untouched"></div>
      <div role="alertdialog"><input id="confirm"></div>
    `);
    await run('I fill the open alert dialog field with {string}', 'DELETE');
    expect(await page.locator('#confirm').inputValue()).toBe('DELETE');
    expect(await page.locator('#behind').inputValue()).toBe('untouched');
  }, 60_000);

  it('scopes a labelled fill to the dialog when the page behind shares the label', async () => {
    await setContent(`
      <form><label for="page-name">Name</label><input id="page-name" value="page"></form>
      <div role="dialog"><label for="dialog-name">Name</label><input id="dialog-name"></div>
    `);
    await run('I fill the {string} field of the open dialog with {string}', 'Name', 'inside');
    expect(await page.locator('#dialog-name').inputValue()).toBe('inside');
    expect(await page.locator('#page-name').inputValue()).toBe('page');
  }, 60_000);

  it('means the DIALOG, not a confirm stacked on top of it', async () => {
    // "the open dialog" has to name the same surface in every dialog step; an alertdialog has its
    // own step, and a labelled fill that drifted onto the confirm would type into the wrong box.
    await setContent(`
      <div role="dialog"><label for="d-name">Name</label><input id="d-name"></div>
      <div role="alertdialog"><label for="a-name">Name</label><input id="a-name"></div>
    `);
    await run('I fill the {string} field of the open dialog with {string}', 'Name', 'dialog');
    expect(await page.locator('#d-name').inputValue()).toBe('dialog');
    expect(await page.locator('#a-name').inputValue()).toBe('');
  }, 60_000);

  it('fails rather than filling the page behind when no overlay is open', async () => {
    await setContent('<input id="loose">');
    await Promise.all([
      failsWith('I fill the open dialog field with {string}', ['x'], /no open dialog|visible/i),
      failsWith(
        'I fill the open alert dialog field with {string}',
        ['x'],
        /no open alert dialog|visible/i,
      ),
      failsWith('I fill the open popover field with {string}', ['x'], /no open popover|visible/i),
      failsWith(
        'I fill the {string} field of the open dialog with {string}',
        ['Name', 'x'],
        /no dialog is open|visible/i,
      ),
    ]);
    expect(await page.locator('#loose').inputValue()).toBe('');
  }, 90_000);
});

/* ── text anywhere on the page ────────────────────────────────────────── */

describe('text anywhere on the page', () => {
  it('sees text that getByText cannot — an input value', async () => {
    await setContent('<input value="alice@example.com" aria-label="Email">');
    // The built-in text steps resolve through getByText, which reads text nodes only.
    expect(await page.getByText('alice@example.com', { exact: false }).count()).toBe(0);
    await run('the text {string} should appear anywhere on the page', 'alice@example.com');
    await failsWith(
      'the text {string} should not appear anywhere on the page',
      ['alice@example.com'],
      /rendered somewhere/i,
    );
  }, 60_000);

  it('passes the negative only when the string is genuinely absent', async () => {
    await setContent('<p>nothing sensitive here</p>');
    await run('the text {string} should not appear anywhere on the page', 'alice@example.com');
    await failsWith(
      'the text {string} should appear anywhere on the page',
      ['alice@example.com'],
      /never rendered/i,
    );
  }, 60_000);

  it('refuses the negative on a page that rendered nothing at all', async () => {
    await setContent('');
    const error = await failsWith(
      'the text {string} should not appear anywhere on the page',
      ['anything'],
      /no readable text at all/i,
    );
    expect(error).toBeInstanceOf(SdodsError);
    expect((error as SdodsError).hint).toMatch(/proves nothing/i);
  }, 60_000);

  it('ignores text hidden from the user', async () => {
    await setContent('<p style="display:none">secret-token</p><p>visible</p>');
    await run('the text {string} should not appear anywhere on the page', 'secret-token');
  }, 60_000);
});
