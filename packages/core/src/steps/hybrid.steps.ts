import { expect } from '@playwright/test';
import './params.js';
import { Then, When } from '../fixtures/test.js';
import type { HttpMethod } from '../api/client.js';
import { getPath } from '../api/json-path.js';
import { render, renderJson } from '../api/template.js';

/* Hybrid glue: seed through the API, verify in the browser. */

When(
  'I seed via {method} {string} with body:',
  async ({ api, apiContext, env }, method: HttpMethod, path: string, body: string) => {
    const scopes = [apiContext.vars.toObject(), env.vars];
    await api.send(method, render(path, ...scopes), { body: renderJson(body, ...scopes) });
  },
);

Then(
  'the UI should show the text from JSON path {string}',
  async ({ page, apiContext }, jsonPath: string) => {
    const value = getPath(apiContext.last().response.body, jsonPath);
    await expect(page.getByText(String(value), { exact: false }).first()).toBeVisible();
  },
);

When(
  'I replay HAR {string} for {string}',
  async ({ page, config }, har: string, urlGlob: string) => {
    const { resolve, isAbsolute } = await import('node:path');
    const file = isAbsolute(har)
      ? har
      : resolve(
          config.project.root,
          'har',
          config.env.name,
          har.endsWith('.har') ? har : `${har}.har`,
        );
    await page.routeFromHAR(file, {
      url: urlGlob,
      notFound: 'abort',
      update: config.runtime.harMode === 'update',
    });
  },
);
