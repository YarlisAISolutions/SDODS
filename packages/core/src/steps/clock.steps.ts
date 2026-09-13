import { expect } from '@playwright/test';
import './params.js';
import { Given, Then } from '../fixtures/test.js';
import { renderStrict } from '../api/template.js';
import { SdodsError } from '../errors.js';

/**
 * Clock control.
 *
 * DESIGN — installing the clock is a SEPARATE step from moving it, and it must
 * come first. `page.clock.install()` has to run before the page under test
 * reads `Date.now()`, so a scenario installs the clock, then navigates, then
 * advances. Folding the two together would produce a step that appears to work
 * and silently does nothing on an already-loaded page, which is worse than one
 * that refuses.
 *
 * WHAT THIS UNBLOCKS — trials, expiry, scheduled runs and session TTLs. None of
 * these can be tested by waiting: a 55-minute session TTL is not a thing a
 * suite can sit through, so without clock control those scenarios are not slow,
 * they are unwritable.
 */

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

/** ISO-8601, or a relative offset like "+2 days" / "-30 minutes". */
export function resolveTime(spec: string, from: Date): Date {
  const rel = /^([+-])\s*(\d+)\s*(second|minute|hour|day|week)s?$/i.exec(spec.trim());
  if (rel) {
    const [, sign, amount, unit] = rel as unknown as [string, string, string, string];
    const ms =
      { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 }[unit.toLowerCase()] ?? 0;
    const delta = Number(amount) * ms * (sign === '-' ? -1 : 1);
    return new Date(from.getTime() + delta);
  }
  const abs = new Date(spec);
  if (Number.isNaN(abs.getTime())) {
    throw new SdodsError('CONFIG_INVALID', `Cannot read "${spec}" as a time.`, {
      hint: 'Use an ISO-8601 instant (2026-01-31T12:00:00Z) or a relative offset ("+2 days", "-30 minutes").',
    });
  }
  return abs;
}

Given('I install a fake clock', async ({ page }) => {
  await page.clock.install();
});

Given('I install a fake clock set to {string}', async ({ page, apiContext, env }, when: string) => {
  const at = resolveTime(renderStrict(when, ...scopesOf(apiContext, env)), new Date());
  await page.clock.install({ time: at });
});

/**
 * Jumps the clock without running the timers in between. This is what a trial
 * expiring "two weeks later" means — and running two weeks of intervals would
 * hang the test rather than simulate it.
 */
Given('the clock jumps to {string}', async ({ page, apiContext, env }, when: string) => {
  const at = resolveTime(renderStrict(when, ...scopesOf(apiContext, env)), new Date());
  await page.clock.setFixedTime(at);
});

/** Runs timers as it goes, so polling and countdowns actually fire. */
Given('the clock advances by {string}', async ({ page, apiContext, env }, amount: string) => {
  const spec = renderStrict(amount, ...scopesOf(apiContext, env)).trim();
  const normalised = /^[+-]/.test(spec) ? spec : `+${spec}`;
  const target = resolveTime(normalised, new Date(0));
  await page.clock.runFor(target.getTime());
});

Given('the clock resumes', async ({ page }) => {
  await page.clock.resume();
});

Then('the page clock should read {string}', async ({ page, apiContext, env }, iso: string) => {
  const expected = resolveTime(renderStrict(iso, ...scopesOf(apiContext, env)), new Date());
  const actual = await page.evaluate(() => Date.now());
  // A second of tolerance: the assertion is about which DAY or HOUR the page
  // believes it is, and demanding millisecond equality would make it flaky for
  // no benefit.
  expect(Math.abs(actual - expected.getTime())).toBeLessThan(1000);
});
