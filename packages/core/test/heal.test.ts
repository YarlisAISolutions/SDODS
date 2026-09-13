import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HealConfig } from '@sdods/contracts';
import { SdodsError } from '../src/errors.js';
import { Healer } from '../src/heal/healer.js';

/**
 * `Healer.resolve()` against a real page. A locator that is visible but matches several elements
 * used to be returned as-is, so the action threw a strict-mode violation that healing never saw.
 */

let browser: Browser;
let page: Page;
let heal: Healer;

function makeHealer(overrides: Partial<HealConfig> = {}) {
  return new Healer({
    config: {
      enabled: true,
      primaryTimeoutMs: 400,
      probeTimeoutMs: 300,
      minScore: 0.6,
      actions: ['click', 'fill', 'select', 'assert', 'hover', 'check'],
      ...overrides,
    },
  });
}

async function setContent(html: string): Promise<void> {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
}

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(() => {
  heal = makeHealer();
});

describe('Healer.resolve() on an ambiguous locator', () => {
  it('heals to the element whose role fits a fill, and records the heal', async () => {
    await setContent(`
      <input id="pw" type="password" aria-label="Password">
      <button type="button" aria-label="Password">show</button>
    `);
    const loc = await heal.resolve(
      page.getByLabel('Password'),
      { label: 'Password', description: 'Password field' },
      'fill',
    );
    await loc.fill('hunter2');
    expect(await page.locator('#pw').inputValue()).toBe('hunter2');
    expect(heal.events).toHaveLength(1);
    expect(heal.events[0]).toMatchObject({
      action: 'fill',
      succeeded: true,
      strategyUsed: 'role-filter',
      healedSelector: expect.stringContaining("getByRole('textbox')"),
    });
  }, 60_000);

  it('heals to the element whose role fits a click', async () => {
    await setContent(`
      <input id="q" aria-label="Delete">
      <button id="del" type="button" aria-label="Delete" onclick="this.dataset.clicked = 'yes'">x</button>
    `);
    await heal.click(page.getByLabel('Delete'), { label: 'Delete', description: 'Delete' });
    expect(await page.locator('#del').getAttribute('data-clicked')).toBe('yes');
    expect(heal.events[0]?.strategyUsed).toBe('role-filter');
  }, 60_000);

  it('fails with a recorded event when no role settles the ambiguity', async () => {
    await setContent(`
      <label>Name <input id="a"></label>
      <label>Name <input id="b"></label>
    `);
    let caught: unknown;
    try {
      await heal.fill(page.getByLabel('Name'), { label: 'Name', description: 'Name field' }, 'x');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SdodsError);
    expect((caught as SdodsError).code).toBe('HEAL_FAILED');
    expect((caught as Error).message).toMatch(/matched 2 elements/);
    expect(heal.events).toHaveLength(1);
    expect(heal.events[0]?.succeeded).toBe(false);
  }, 60_000);

  it('leaves a single match alone and records nothing', async () => {
    await setContent('<label for="e">Email</label><input id="e">');
    const primary = page.getByLabel('Email');
    expect(await heal.resolve(primary, { label: 'Email', description: 'Email' }, 'fill')).toBe(
      primary,
    );
    expect(heal.events).toHaveLength(0);
  }, 60_000);

  it('returns an ambiguous locator unchanged for an assertion, which has no role to prefer', async () => {
    await setContent('<p>Row</p><p>Row</p>');
    const primary = page.getByText('Row');
    expect(await heal.resolve(primary, { text: 'Row', description: 'rows' }, 'assert')).toBe(
      primary,
    );
    expect(heal.events).toHaveLength(0);
  }, 60_000);

  it('returns an ambiguous locator unchanged when healing is disabled', async () => {
    heal = makeHealer({ enabled: false });
    await setContent(`
      <input aria-label="Password">
      <button type="button" aria-label="Password">show</button>
    `);
    const primary = page.getByLabel('Password');
    expect(
      await heal.resolve(primary, { label: 'Password', description: 'Password field' }, 'fill'),
    ).toBe(primary);
    expect(heal.events).toHaveLength(0);
  }, 60_000);
});
