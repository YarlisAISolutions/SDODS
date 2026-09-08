import { expect, type FrameLocator, type Page } from '@playwright/test';
import './params.js';
import { Given, Then, When } from '../fixtures/test.js';
import { render } from '../api/template.js';
import { SdodsError } from '../errors.js';

/**
 * Iframe steps.
 *
 * DESIGN — a frame is entered, not passed around. Every other UI step in this
 * library resolves against `page`, and threading an optional frame through all
 * of them would touch every signature for a surface most scenarios never see.
 * So a scenario *enters* a frame, the subsequent steps here operate inside it,
 * and it *leaves*. The scope is per-scenario state, held on the page object
 * rather than in module scope, so parallel workers cannot see each other's.
 *
 * WHY THIS EXISTS — a cross-origin payment frame is the single most common
 * thing a suite cannot reach, and "we do not test checkout" is not a decision
 * anybody made; it is what happens when the vocabulary has no word for it.
 */

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

/** Per-page frame scope. A WeakMap, so a closed page's entry is collectable. */
const entered = new WeakMap<Page, { frame: FrameLocator; description: string }>();

function currentFrame(page: Page): FrameLocator {
  const scope = entered.get(page);
  if (!scope) {
    throw new SdodsError('NOT_SUPPORTED', 'No iframe has been entered.', {
      hint: 'Use `Given I enter the frame "<selector or name>"` before addressing elements inside it.',
    });
  }
  return scope.frame;
}

/* ── entering and leaving ─────────────────────────────────────────────── */

Given('I enter the frame {string}', async ({ page, apiContext, env }, selector: string) => {
  const resolved = render(selector, ...scopesOf(apiContext, env));
  // A bare word is treated as a name/title/id, which is how frames are
  // usually identified in markup; anything else is a CSS selector.
  const css = /^[\w-]+$/.test(resolved)
    ? `iframe[name="${resolved}"], iframe[title="${resolved}"], iframe#${resolved}`
    : resolved;
  const handle = page.locator(css).first();
  // Assert the element EXISTS before entering. `frameLocator` on a selector
  // that matches nothing fails later, inside an unrelated step, with a
  // message about the element you were looking for rather than the frame you
  // never entered.
  await expect(
    handle,
    `the frame "${resolved}" should be present before entering it`,
  ).toBeAttached();
  entered.set(page, { frame: page.frameLocator(css), description: resolved });
});

Given('I leave the frame', async ({ page }) => {
  entered.delete(page);
});

/* ── acting inside the frame ──────────────────────────────────────────── */

When(
  'I fill the frame field {string} with {string}',
  async ({ page, apiContext, env }, label: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    const frame = currentFrame(page);
    await frame
      .getByLabel(render(label, ...scopes))
      .or(frame.getByPlaceholder(render(label, ...scopes)))
      .first()
      .fill(render(value, ...scopes));
  },
);

When('I click the frame element {string}', async ({ page, apiContext, env }, selector: string) => {
  await currentFrame(page)
    .locator(render(selector, ...scopesOf(apiContext, env)))
    .first()
    .click();
});

When('I click the frame {role} {string}', async ({ page, apiContext, env }, role, name: string) => {
  await currentFrame(page)
    .getByRole(role, { name: render(name, ...scopesOf(apiContext, env)) })
    .first()
    .click();
});

/* ── asserting inside the frame ───────────────────────────────────────── */

Then(
  'the frame should contain the text {string}',
  async ({ page, apiContext, env }, text: string) => {
    await expect(
      currentFrame(page)
        .getByText(render(text, ...scopesOf(apiContext, env)))
        .first(),
    ).toBeVisible();
  },
);

Then(
  'the frame element {string} should be visible',
  async ({ page, apiContext, env }, selector: string) => {
    await expect(
      currentFrame(page)
        .locator(render(selector, ...scopesOf(apiContext, env)))
        .first(),
    ).toBeVisible();
  },
);

Then('the page should have {int} frame(s)', async ({ page }, count: number) => {
  // `page.frames()` includes the main frame; the count a scenario means is the
  // number of embedded documents, so the main frame is excluded.
  await expect
    .poll(() => page.frames().length - 1, {
      message: `the page should embed ${count} frame(s)`,
    })
    .toBe(count);
});
