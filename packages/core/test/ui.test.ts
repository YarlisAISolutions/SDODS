import { createRequire } from 'node:module';
import { chromium, type Browser, type Page } from '@playwright/test';
import type * as PlaywrightTestModule from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Shrinks Playwright's expect retry window, so a "must fail" case costs a second, not five. */
vi.mock('@playwright/test', async (importOriginal) => {
  const actual = await importOriginal<typeof PlaywrightTestModule>();
  return { ...actual, expect: actual.expect.configure({ timeout: 1500 }) };
});

import { ApiContext } from '../src/fixtures/api-context.js';
import { SdodsError } from '../src/errors.js';
import { Healer } from '../src/heal/healer.js';
import '../src/steps/ui.steps.js';
import '../src/steps/api.steps.js';

/**
 * The built-in ui steps, driven against a real Chromium page. Two properties are checked here:
 * every string argument is rendered through the one strict renderer (an unset variable fails the
 * step rather than being matched literally), and the field steps address the labelled field
 * itself rather than every control whose label merely contains the text.
 */

type StepFn = (fixtures: Record<string, unknown>, ...args: unknown[]) => Promise<unknown>;

/** playwright-bdd keeps one global registry; it is not reachable through the package exports. */
function registeredSteps(): Map<string, StepFn> {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('playwright-bdd');
  const registry = require(entry.replace(/index\.js$/, 'steps/stepRegistry.js')) as {
    stepDefinitions: Array<{ pattern: string | RegExp; fn: StepFn }>;
  };
  return new Map(registry.stepDefinitions.map((d) => [String(d.pattern), d.fn]));
}

let browser: Browser;
let page: Page;
let apiContext: ApiContext;
let heal: Healer;
let steps: Map<string, StepFn>;

const env = { vars: {} as Record<string, unknown> };

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
  return runWith({}, pattern, ...args);
}

function runWith(extra: Record<string, unknown>, pattern: string, ...args: unknown[]) {
  const fn = steps.get(pattern);
  if (!fn) throw new Error(`step is not registered: "${pattern}"`);
  return Promise.resolve(fn({ page, heal, apiContext, env, ...extra }, ...args));
}

/** Asserts the step failed AND that it failed for the stated reason, not incidentally. */
async function failsWith(
  pattern: string,
  args: unknown[],
  match: RegExp,
  extra: Record<string, unknown> = {},
): Promise<Error> {
  let caught: unknown;
  try {
    await runWith(extra, pattern, ...args);
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
  page = await browser.newPage();
  steps = registeredSteps();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(() => {
  apiContext = new ApiContext();
  heal = makeHealer();
  env.vars = {};
});

/* ── #92: {{var}} rendering ───────────────────────────────────────────── */

describe('{{var}} rendering in the built-in ui steps', () => {
  it('renders the page URL needle', async () => {
    await page.route('http://sdods.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Workspace</title>' }),
    );
    await page.goto('http://sdods.test/workspace/ws-7');
    apiContext.vars.set('wsId', 'ws-7');
    await run('the page URL should contain {string}', '/workspace/{{wsId}}');
    await page.unrouteAll();
  }, 60_000);

  it('renders the page title needle, falling back to env vars', async () => {
    env.vars = { tenant: 'Acme' };
    await setContent('<title>Acme workspace</title>');
    await run('the page title should contain {string}', '{{tenant}} workspace');
  }, 60_000);

  it('refuses an unset variable instead of matching the literal braces', async () => {
    await setContent('<title>Acme workspace</title>');
    const [url, title] = await Promise.all([
      failsWith(
        'the page URL should contain {string}',
        ['/workspace/{{fixtureWorkspaceId}}'],
        /no such variable: fixtureWorkspaceId/,
      ),
      failsWith(
        'the page title should contain {string}',
        ['{{tenant}}'],
        /no such variable: tenant/,
      ),
    ]);
    expect(url).toBeInstanceOf(SdodsError);
    expect((title as SdodsError).code).toBe('CONFIG_UNRESOLVED_VAR');
  }, 60_000);

  it('fails a negative text assertion on an unset variable instead of passing vacuously', async () => {
    await setContent('<p>tenant A datasets only</p>');
    // Before the strict renderer this passed: the literal "{{tenantBDatasetId}}" is never on the
    // page, so "should not see" was green whatever the page showed.
    await failsWith(
      'I should not see the text {string}',
      ['{{tenantBDatasetId}}'],
      /no such variable: tenantBDatasetId/,
    );
  }, 60_000);

  it('renders test ids, field labels and dropdown options', async () => {
    apiContext.vars.set('rowId', '7');
    apiContext.vars.set('field', 'Workspace name');
    apiContext.vars.set('plan', 'Team');
    await setContent(`
      <div data-testid="row-7">Row seven</div>
      <label for="n">Workspace name</label><input id="n">
      <label for="p">Plan</label><select id="p"><option>Free</option><option>Team</option></select>
    `);
    await run(
      'the element with test id {string} should contain {string}',
      'row-{{rowId}}',
      'seven',
    );
    await run('I fill the {string} field with {string}', '{{field}}', 'Acme');
    await run('I select {string} in the {string} dropdown', '{{plan}}', 'Plan');
    expect(await page.locator('#n').inputValue()).toBe('Acme');
    expect(await page.locator('#p').inputValue()).toBe('Team');
  }, 60_000);

  it('does not mistake a variable whose value contains braces for an unset one', async () => {
    apiContext.vars.set('greeting', 'Hello {{name}}');
    await setContent('<p>Hello {{name}}</p>');
    await run('I should see the text {string}', '{{greeting}}');
  }, 60_000);

  it('refuses an API request path with an unset variable before sending it', async () => {
    const api = { send: vi.fn(async () => undefined) };
    await failsWith(
      'I send a {method} request to {string}',
      ['GET', '/datasets/{{tenantBDatasetId}}'],
      /no such variable: tenantBDatasetId/,
      { api },
    );
    // A request to the literal path would 404, and "the response status should be 404" would
    // then pass as if tenant isolation held.
    expect(api.send).not.toHaveBeenCalled();
  }, 60_000);
});

/* ── #85: field steps address the labelled field ──────────────────────── */

describe('field steps pick the labelled field, not a control whose label contains it', () => {
  it('fills a password field that has a "Show password" toggle', async () => {
    await setContent(`
      <label for="pw">Password</label><input id="pw" type="password">
      <button type="button" aria-label="Show password">show</button>
    `);
    await run('I fill the {string} field with {string}', 'Password', 'hunter2');
    expect(await page.locator('#pw').inputValue()).toBe('hunter2');
    expect(heal.events).toHaveLength(0);
  }, 60_000);

  it('fills through the form table on the same terms', async () => {
    await setContent(`
      <label for="pw">Password</label><input id="pw" type="password">
      <button type="button" aria-label="Show password">show</button>
    `);
    await run('I fill the form:', { hashes: () => [{ field: 'Password', value: 's3cret' }] });
    expect(await page.locator('#pw').inputValue()).toBe('s3cret');
  }, 60_000);

  it('selects from a dropdown that sits next to a help button with a similar label', async () => {
    await setContent(`
      <label for="c">Country</label><select id="c"><option>Chile</option><option>France</option></select>
      <button type="button" aria-label="Country help">?</button>
    `);
    await run('I select {string} in the {string} dropdown', 'France', 'Country');
    expect(await page.locator('#c').inputValue()).toBe('France');
  }, 60_000);

  it('checks a checkbox that sits next to an info button with a similar label', async () => {
    await setContent(`
      <input type="checkbox" id="r"><label for="r">Remember me</label>
      <button type="button" aria-label="Remember me info">i</button>
    `);
    await run('I check the {string} checkbox', 'Remember me');
    expect(await page.locator('#r').isChecked()).toBe(true);
  }, 60_000);

  it('still falls back to a partial label when no label matches exactly', async () => {
    await setContent('<label for="e">Email address</label><input id="e" type="email">');
    await run('I fill the {string} field with {string}', 'Email', 'u@acme.test');
    expect(await page.locator('#e').inputValue()).toBe('u@acme.test');
  }, 60_000);

  it('still fills a labelled contenteditable, which has no fillable role', async () => {
    await setContent('<div id="notes" contenteditable="true" aria-label="Notes"></div>');
    await run('I fill the {string} field with {string}', 'Notes', 'hello');
    expect(await page.locator('#notes').textContent()).toBe('hello');
  }, 60_000);
});
