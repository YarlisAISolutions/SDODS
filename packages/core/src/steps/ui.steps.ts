import { expect } from '@playwright/test';
import './params.js';
import { Given, Then, When } from '../fixtures/test.js';
import { render, renderJson } from '../api/template.js';
import type { AriaRole } from '../heal/types.js';
import { SdodsError } from '../errors.js';

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

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

/* ── navigation ───────────────────────────────────────────────────────── */

Given(
  'I navigate to the {string} page',
  async ({ page, config, apiContext, env }, route: string) => {
    await page.goto(routePath(config, render(route, ...scopesOf(apiContext, env))), {
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
    const n = render(name, ...scopesOf(apiContext, env));
    await heal.click(page.getByRole(role as AriaRole, { name: n }), {
      role: role as AriaRole,
      name: n,
      text: n,
      description: `${role} "${n}"`,
    });
  },
);

When('I click the element with test id {string}', async ({ page, heal }, id: string) => {
  await heal.click(page.getByTestId(id), { testId: id, description: `test id "${id}"` });
});

When('I click the text {string}', async ({ page, heal, apiContext, env }, text: string) => {
  const t = render(text, ...scopesOf(apiContext, env));
  await heal.click(page.getByText(t, { exact: true }), { text: t, description: `text "${t}"` });
});

When(
  'I fill the {string} field with {string}',
  async ({ page, heal, apiContext, env }, label: string, value: string) => {
    const v = render(value, ...scopesOf(apiContext, env));
    await heal.fill(
      page.getByLabel(label),
      { label, placeholder: label, description: `${label} field` },
      v,
    );
  },
);

When(
  'I fill the element with test id {string} with {string}',
  async ({ page, heal, apiContext, env }, id: string, value: string) => {
    await heal.fill(
      page.getByTestId(id),
      { testId: id, description: `test id "${id}"` },
      render(value, ...scopesOf(apiContext, env)),
    );
  },
);

When('I fill the form:', async ({ page, heal, apiContext, env }, table: any) => {
  for (const row of table.hashes() as Array<Record<string, string>>) {
    const field = row.field ?? row.label ?? Object.values(row)[0]!;
    const value = render(row.value ?? Object.values(row)[1] ?? '', ...scopesOf(apiContext, env));
    await heal.fill(
      page.getByLabel(field),
      { label: field, placeholder: field, description: `${field} field` },
      value,
    );
  }
});

When(
  'I select {string} in the {string} dropdown',
  async ({ page, heal }, option: string, label: string) => {
    await heal.select(page.getByLabel(label), { label, description: `${label} dropdown` }, option);
  },
);

When('I check the {string} checkbox', async ({ page, heal }, label: string) => {
  const loc = await heal.resolve(
    page.getByLabel(label),
    { label, role: 'checkbox', name: label, description: `${label} checkbox` },
    'check',
  );
  await loc.check();
});

When('I press {string}', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

When(
  'I upload {string} to the {string} field',
  async ({ page, config }, file: string, label: string) => {
    const { resolve, isAbsolute } = await import('node:path');
    await page
      .getByLabel(label)
      .setInputFiles(isAbsolute(file) ? file : resolve(config.project.root, file));
  },
);

When('I wait for {int} seconds', async ({ page }, seconds: number) => {
  await page.waitForTimeout(seconds * 1000);
});

/* ── assertions ───────────────────────────────────────────────────────── */

Then('I should see the text {string}', async ({ page, apiContext, env }, text: string) => {
  const t = render(text, ...scopesOf(apiContext, env));
  await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
});

Then('I should not see the text {string}', async ({ page, apiContext, env }, text: string) => {
  await expect(
    page.getByText(render(text, ...scopesOf(apiContext, env)), { exact: false }),
  ).toHaveCount(0);
});

Then(
  'the {string} {role} should be visible',
  async ({ page, heal }, name: string, role: string) => {
    await heal.expectVisible(page.getByRole(role as AriaRole, { name }), {
      role: role as AriaRole,
      name,
      description: `${role} "${name}"`,
    });
  },
);

Then('the element with test id {string} should be visible', async ({ page, heal }, id: string) => {
  await heal.expectVisible(page.getByTestId(id), { testId: id, description: `test id "${id}"` });
});

Then(
  'the element with test id {string} should contain {string}',
  async ({ page, heal, apiContext, env }, id: string, text: string) => {
    await heal.expectText(
      page.getByTestId(id),
      { testId: id, description: `test id "${id}"` },
      render(text, ...scopesOf(apiContext, env)),
    );
  },
);

Then('the page URL should contain {string}', async ({ page }, part: string) => {
  await expect(page).toHaveURL(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

Then('the page title should contain {string}', async ({ page }, part: string) => {
  await expect(page).toHaveTitle(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

Then(
  'the page should match the visual baseline {string}',
  async ({ shots, $bddContext }, name: string) => {
    await shots.visual(name, $bddContext.stepIndex);
  },
);

/* ── network mocking ──────────────────────────────────────────────────── */

When(
  'I mock {string} with JSON:',
  async ({ page, apiContext, env }, urlGlob: string, json: string) => {
    const body = renderJson(json, ...scopesOf(apiContext, env));
    await page.route(urlGlob, (route) => route.fulfill({ json: body as any }));
  },
);

When(
  'I mock {string} with HTML:',
  async ({ page, apiContext, env }, urlGlob: string, html: string) => {
    const body = render(html, ...scopesOf(apiContext, env));
    await page.route(urlGlob, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body }),
    );
  },
);

When('I mock {string} with status {int}', async ({ page }, urlGlob: string, status: number) => {
  await page.route(urlGlob, (route) => route.fulfill({ status, body: '' }));
});

When('I abort requests to {string}', async ({ page }, urlGlob: string) => {
  await page.route(urlGlob, (route) => route.abort());
});
