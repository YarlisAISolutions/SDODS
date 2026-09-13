import { expect, type Page } from '@playwright/test';
import './params.js';
import { Given, Then, When } from '../fixtures/test.js';
import { renderStrict } from '../api/template.js';
import { SdodsError } from '../errors.js';

/**
 * Multi-tab and popup steps.
 *
 * DESIGN — the ACTION THAT OPENS the tab and the WAIT for it are one step, not
 * two. `waitForEvent('page')` after the click is a race: a fast popup opens
 * before the listener is attached and the wait then times out on a tab that is
 * already sitting there. Every step here that expects a new tab installs the
 * listener first and performs the action second, which is the only ordering
 * that is correct for both fast and slow popups.
 *
 * The suite's `page` fixture stays pointed at the original tab throughout.
 * Switching is explicit — `I switch to the tab ...` — because a step library
 * that silently re-points `page` makes every later assertion ambiguous about
 * which document it read.
 */

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

/** The tab a scenario is currently addressing, when it is not the original. */
const active = new WeakMap<Page, Page>();

/** The page later steps should act on: the switched-to tab, or the original. */
export function activePage(page: Page): Page {
  const t = active.get(page);
  return t && !t.isClosed() ? t : page;
}

async function openedBy(page: Page, action: () => Promise<void>, what: string): Promise<Page> {
  // Listener first, action second. The reverse loses a popup that opens
  // synchronously, and the resulting timeout blames the wait rather than the
  // ordering.
  const waiter = page.context().waitForEvent('page');
  await action();
  const opened = await waiter.catch(() => undefined);
  if (!opened) {
    throw new SdodsError('NOT_SUPPORTED', `No new tab opened after ${what}.`, {
      hint: 'If the target opens in the same tab, assert the URL instead. If it is blocked by a popup blocker, the context needs to allow it.',
    });
  }
  await opened.waitForLoadState('domcontentloaded');
  active.set(page, opened);
  return opened;
}

/* ── opening ──────────────────────────────────────────────────────────── */

When(
  'I open a new tab by clicking the {role} {string}',
  async ({ page, apiContext, env }, role, name: string) => {
    const label = renderStrict(name, ...scopesOf(apiContext, env));
    await openedBy(
      page,
      () => activePage(page).getByRole(role, { name: label }).first().click(),
      `clicking the ${role} "${label}"`,
    );
  },
);

When(
  'I open a new tab by clicking the element {string}',
  async ({ page, apiContext, env }, selector: string) => {
    const sel = renderStrict(selector, ...scopesOf(apiContext, env));
    await openedBy(page, () => activePage(page).locator(sel).first().click(), `clicking "${sel}"`);
  },
);

/* ── switching ────────────────────────────────────────────────────────── */

Given(
  'I switch to the tab with URL containing {string}',
  async ({ page, apiContext, env }, part: string) => {
    const needle = renderStrict(part, ...scopesOf(apiContext, env));
    const found = page
      .context()
      .pages()
      .find((p) => p.url().includes(needle));
    if (!found) {
      throw new SdodsError('NOT_SUPPORTED', `No open tab has a URL containing "${needle}".`, {
        hint: `Open tabs: ${
          page
            .context()
            .pages()
            .map((p) => p.url())
            .join(', ') || '(none)'
        }`,
      });
    }
    await found.bringToFront();
    active.set(page, found);
  },
);

Given('I switch back to the original tab', async ({ page }) => {
  active.delete(page);
  await page.bringToFront();
});

When('I close the current tab', async ({ page }) => {
  const current = activePage(page);
  if (current === page) {
    throw new SdodsError('NOT_SUPPORTED', 'Refusing to close the original tab.', {
      hint: 'The original tab is the scenario’s page fixture; closing it would fail every later step with an unrelated error.',
    });
  }
  await current.close();
  active.delete(page);
});

/* ── asserting ────────────────────────────────────────────────────────── */

Then('there should be {int} open tab(s)', async ({ page }, count: number) => {
  await expect
    .poll(
      () =>
        page
          .context()
          .pages()
          .filter((p) => !p.isClosed()).length,
      {
        message: `the context should have ${count} open tab(s)`,
      },
    )
    .toBe(count);
});

Then(
  'the current tab URL should contain {string}',
  async ({ page, apiContext, env }, part: string) => {
    const needle = renderStrict(part, ...scopesOf(apiContext, env));
    await expect
      .poll(() => activePage(page).url(), { message: `the tab URL should contain "${needle}"` })
      .toContain(needle);
  },
);

Then(
  'the current tab should contain the text {string}',
  async ({ page, apiContext, env }, text: string) => {
    await expect(
      activePage(page)
        .getByText(renderStrict(text, ...scopesOf(apiContext, env)))
        .first(),
    ).toBeVisible();
  },
);
