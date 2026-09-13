import { expect, type Locator, type Page } from '@playwright/test';
import './params.js';
import { Given, Then, When } from '../fixtures/test.js';
import { render, renderJson, renderStrict } from '../api/template.js';
import type { Healer } from '../heal/healer.js';
import { withActionRole } from '../heal/strategies.js';
import type { AriaRole, HealAction } from '../heal/types.js';
import { SdodsError } from '../errors.js';

/*
 * Every string argument goes through `renderStrict()`: `{{vars}}` resolve against the scenario
 * variables, then the env vars, and one that resolves to nothing fails the step. Matching the
 * literal `{{name}}` instead would fail a positive assertion for the wrong reason and pass a
 * negative one without testing anything. Doc-string bodies are free text and render leniently.
 */

type Fixtures = {
  apiContext: { vars: { toObject(): Record<string, unknown> } };
  env: { vars: Record<string, unknown> };
};

const scopesOf = (apiContext: Fixtures['apiContext'], env: Fixtures['env']) => [
  apiContext.vars.toObject(),
  env.vars,
];

/** Render one step argument strictly. */
const arg = ({ apiContext, env }: Fixtures, value: string) =>
  renderStrict(value, ...scopesOf(apiContext, env));

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function routePath(
  config: { project: { routes: Record<string, string>; slug: string } },
  nameOrPath: string,
): string {
  const routes = config.project.routes;
  if (nameOrPath in routes) return routes[nameOrPath]!;
  if (nameOrPath.startsWith('/') || /^https?:\/\//.test(nameOrPath)) return nameOrPath;
  throw new SdodsError(
    'CONFIG_INVALID',
    `Unknown route "${nameOrPath}" for project ${config.project.slug}.`,
    {
      hint: `Known routes: ${Object.keys(routes).join(', ') || '(none)'}.`,
    },
  );
}

/**
 * The control a label names, for `action`. An exact label beats a partial one, and a control
 * whose role fits the action beats anything else the label also reaches: `getByLabel('Password')`
 * on its own also matches a "Show password" toggle, and the fill then dies on a strict-mode
 * violation. The unfiltered forms stay as the last resort, for controls with no role at all such
 * as a contenteditable editor.
 */
function labelled(page: Page, heal: Healer, label: string, action: HealAction): Promise<Locator> {
  const exact = page.getByLabel(label, { exact: true });
  const loose = page.getByLabel(label);
  return heal.prefer(
    withActionRole(page, exact, action),
    withActionRole(page, loose, action),
    exact,
    loose,
  );
}

/* ── navigation ───────────────────────────────────────────────────────── */

Given(
  'I navigate to the {string} page',
  async ({ page, config, apiContext, env }, route: string) => {
    await page.goto(routePath(config, arg({ apiContext, env }, route)), {
      waitUntil: 'domcontentloaded',
    });
  },
);

Given('I reload the page', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
});

/* ── interactions (heal-aware) ────────────────────────────────────────── */

When(
  'I click the {string} {role}',
  async ({ page, heal, apiContext, env }, name: string, role: string) => {
    const n = arg({ apiContext, env }, name);
    await heal.click(page.getByRole(role as AriaRole, { name: n }), {
      role: role as AriaRole,
      name: n,
      text: n,
      description: `${role} "${n}"`,
    });
  },
);

When(
  'I click the element with test id {string}',
  async ({ page, heal, apiContext, env }, id: string) => {
    const testId = arg({ apiContext, env }, id);
    await heal.click(page.getByTestId(testId), { testId, description: `test id "${testId}"` });
  },
);

When('I click the text {string}', async ({ page, heal, apiContext, env }, text: string) => {
  const t = arg({ apiContext, env }, text);
  await heal.click(page.getByText(t, { exact: true }), { text: t, description: `text "${t}"` });
});

When(
  'I fill the {string} field with {string}',
  async ({ page, heal, apiContext, env }, label: string, value: string) => {
    const l = arg({ apiContext, env }, label);
    await heal.fill(
      await labelled(page, heal, l, 'fill'),
      { label: l, placeholder: l, description: `${l} field` },
      arg({ apiContext, env }, value),
    );
  },
);

When(
  'I fill the element with test id {string} with {string}',
  async ({ page, heal, apiContext, env }, id: string, value: string) => {
    const testId = arg({ apiContext, env }, id);
    await heal.fill(
      page.getByTestId(testId),
      { testId, description: `test id "${testId}"` },
      arg({ apiContext, env }, value),
    );
  },
);

When('I fill the form:', async ({ page, heal, apiContext, env }, table: any) => {
  for (const row of table.hashes() as Array<Record<string, string>>) {
    const field = arg({ apiContext, env }, row.field ?? row.label ?? Object.values(row)[0]!);
    const value = arg({ apiContext, env }, row.value ?? Object.values(row)[1] ?? '');
    await heal.fill(
      await labelled(page, heal, field, 'fill'),
      { label: field, placeholder: field, description: `${field} field` },
      value,
    );
  }
});

When(
  'I select {string} in the {string} dropdown',
  async ({ page, heal, apiContext, env }, option: string, label: string) => {
    const l = arg({ apiContext, env }, label);
    await heal.select(
      await labelled(page, heal, l, 'select'),
      { label: l, description: `${l} dropdown` },
      arg({ apiContext, env }, option),
    );
  },
);

When('I check the {string} checkbox', async ({ page, heal, apiContext, env }, label: string) => {
  const l = arg({ apiContext, env }, label);
  const loc = await heal.resolve(
    await labelled(page, heal, l, 'check'),
    { label: l, role: 'checkbox', name: l, description: `${l} checkbox` },
    'check',
  );
  await loc.check();
});

When('I press {string}', async ({ page, apiContext, env }, key: string) => {
  await page.keyboard.press(arg({ apiContext, env }, key));
});

When(
  'I upload {string} to the {string} field',
  async ({ page, heal, config, apiContext, env }, file: string, label: string) => {
    const { resolve, isAbsolute } = await import('node:path');
    const l = arg({ apiContext, env }, label);
    const f = arg({ apiContext, env }, file);
    // A file input has no role to filter on, so only the exact-label preference applies.
    const input = await heal.prefer(page.getByLabel(l, { exact: true }), page.getByLabel(l));
    await input.setInputFiles(isAbsolute(f) ? f : resolve(config.project.root, f));
  },
);

When('I wait for {int} seconds', async ({ page }, seconds: number) => {
  await page.waitForTimeout(seconds * 1000);
});

/* ── assertions ───────────────────────────────────────────────────────── */

Then('I should see the text {string}', async ({ page, apiContext, env }, text: string) => {
  const t = arg({ apiContext, env }, text);
  await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
});

Then('I should not see the text {string}', async ({ page, apiContext, env }, text: string) => {
  await expect(page.getByText(arg({ apiContext, env }, text), { exact: false })).toHaveCount(0);
});

Then(
  'the {string} {role} should be visible',
  async ({ page, heal, apiContext, env }, name: string, role: string) => {
    const n = arg({ apiContext, env }, name);
    await heal.expectVisible(page.getByRole(role as AriaRole, { name: n }), {
      role: role as AriaRole,
      name: n,
      description: `${role} "${n}"`,
    });
  },
);

Then(
  'the element with test id {string} should be visible',
  async ({ page, heal, apiContext, env }, id: string) => {
    const testId = arg({ apiContext, env }, id);
    await heal.expectVisible(page.getByTestId(testId), {
      testId,
      description: `test id "${testId}"`,
    });
  },
);

Then(
  'the element with test id {string} should contain {string}',
  async ({ page, heal, apiContext, env }, id: string, text: string) => {
    const testId = arg({ apiContext, env }, id);
    await heal.expectText(
      page.getByTestId(testId),
      { testId, description: `test id "${testId}"` },
      arg({ apiContext, env }, text),
    );
  },
);

Then('the page URL should contain {string}', async ({ page, apiContext, env }, part: string) => {
  await expect(page).toHaveURL(new RegExp(escapeRegExp(arg({ apiContext, env }, part))));
});

Then('the page title should contain {string}', async ({ page, apiContext, env }, part: string) => {
  await expect(page).toHaveTitle(new RegExp(escapeRegExp(arg({ apiContext, env }, part))));
});

Then(
  'the page should match the visual baseline {string}',
  async ({ shots, $bddContext, apiContext, env }, name: string) => {
    await shots.visual(arg({ apiContext, env }, name), $bddContext.stepIndex);
  },
);

/* ── network mocking ──────────────────────────────────────────────────── */

When(
  'I mock {string} with JSON:',
  async ({ page, apiContext, env }, urlGlob: string, json: string) => {
    const body = renderJson(json, ...scopesOf(apiContext, env));
    await page.route(arg({ apiContext, env }, urlGlob), (route) =>
      route.fulfill({ json: body as any }),
    );
  },
);

When(
  'I mock {string} with HTML:',
  async ({ page, apiContext, env }, urlGlob: string, html: string) => {
    const body = render(html, ...scopesOf(apiContext, env));
    await page.route(arg({ apiContext, env }, urlGlob), (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body }),
    );
  },
);

When(
  'I mock {string} with status {int}',
  async ({ page, apiContext, env }, urlGlob: string, status: number) => {
    await page.route(arg({ apiContext, env }, urlGlob), (route) =>
      route.fulfill({ status, body: '' }),
    );
  },
);

When('I abort requests to {string}', async ({ page, apiContext, env }, urlGlob: string) => {
  await page.route(arg({ apiContext, env }, urlGlob), (route) => route.abort());
});
