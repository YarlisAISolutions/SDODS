/**
 * The step library the playground can execute.
 *
 * Every phrasing here exists in the real project: the API and UI steps come from
 * `packages/core/src/steps/*.steps.ts`, the shop steps from the decorated page objects in
 * `projects/demo-shop/pages/*.ts`. A phrasing that is not in this table is not in SDODS either,
 * so an unknown step fails here the same way it fails in a run — with the list of what exists.
 */
import {
  jsonPath,
  SCHEMAS,
  sendRequest,
  UI_BASE,
  validateSchema,
  type Exchange,
  type HttpMethod,
  type NetworkMode,
} from './sandbox';
import {
  findProduct,
  initialApp,
  LOCKED_MESSAGE,
  MISMATCH_MESSAGE,
  MISSING_PRODUCT,
  PRODUCTS,
  ROUTES,
  textFromHtml,
  USERS,
  visibleText,
  type AppState,
  type SortKey,
} from './shop';

export class StepFailure extends Error {
  readonly expected?: string;
  readonly actual?: string;
  constructor(message: string, expected?: string, actual?: string) {
    super(message);
    this.name = 'StepFailure';
    this.expected = expected;
    this.actual = actual;
  }
}

export type EvidenceKind = 'request' | 'screenshot' | 'locator' | 'note' | 'variable';

export interface Evidence {
  kind: EvidenceKind;
  label: string;
  /** Index into `RunContext.exchanges` for request/response attachments. */
  exchange?: number;
}

export interface StepOutcome {
  detail: string;
  evidence?: Evidence[];
  /** A sentence the tutor says when this step is the one that just ran. */
  teach?: string;
}

export interface RunContext {
  vars: Record<string, string>;
  headers: Record<string, string>;
  query: Record<string, string>;
  exchanges: Exchange[];
  app: AppState;
  mocks: Array<{ glob: string; kind: 'html' | 'json'; body: string }>;
  lease: { role: string; username: string } | null;
  mode: NetworkMode;
  signal?: AbortSignal;
  /** Re-renders the browser panel with the current app state. */
  sync: () => void;
  /** Waits, so a reader can watch a step happen; the wait is kept out of the reported timings. */
  pause: (ms: number) => Promise<void>;
  /** Milliseconds spent in `pause` so far, subtracted from step durations. */
  paused: number;
}

export type StepLayer = 'api' | 'ui' | 'hybrid';

export interface StepDefinition {
  keyword: 'Given' | 'When' | 'Then';
  pattern: string;
  layer: StepLayer;
  /** Where the phrasing is defined, shown in the step catalogue. */
  source: string;
  run: (ctx: RunContext, args: string[], docString?: string) => Promise<StepOutcome> | StepOutcome;
}

/* ────────────────────────────  expression matching  ──────────────────────────── */

const METHODS = 'GET|POST|PUT|PATCH|DELETE';

function compile(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\\\{string\\\}/g, '"([^"]*)"')
    .replace(/\\\{int\\\}/g, '(-?\\d+)')
    .replace(/\\\{method\\\}/g, `(${METHODS})`)
    .replace(/\\\{role\\\}/g, '(button|link|checkbox|combobox|heading|textbox)')
    .replace(/\\\(s\\\)/g, 's?');
  return new RegExp(`^${body}:?$`);
}

export function renderVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? vars[name]! : whole,
  );
}

/* ────────────────────────────────  helpers  ──────────────────────────────────── */

function lastExchange(ctx: RunContext): Exchange {
  const last = ctx.exchanges.at(-1);
  if (!last)
    throw new StepFailure(
      'No request has been sent yet. A response assertion needs a "When I send a … request" step above it.',
    );
  return last;
}

function stringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

async function doRequest(
  ctx: RunContext,
  method: HttpMethod,
  rawPath: string,
  docString?: string,
): Promise<StepOutcome> {
  const query = new URLSearchParams(ctx.query).toString();
  const path =
    renderVars(rawPath, ctx.vars) + (query ? (rawPath.includes('?') ? '&' : '?') + query : '');
  let body: unknown;
  if (docString) {
    const rendered = renderVars(docString, ctx.vars);
    try {
      body = JSON.parse(rendered) as unknown;
    } catch (error) {
      throw new StepFailure(`The docstring is not valid JSON: ${(error as Error).message}`);
    }
  }
  const exchange = await sendRequest({
    method,
    path,
    headers: { Accept: 'application/json', ...ctx.headers },
    body,
    mode: ctx.mode,
    signal: ctx.signal,
  });
  ctx.exchanges.push(exchange);
  ctx.query = {};
  const index = ctx.exchanges.length - 1;
  return {
    detail: `${method} ${path} → ${exchange.status} in ${exchange.timeMs} ms`,
    evidence: [
      {
        kind: 'request',
        label: `request.json · response.json (${method} ${path})`,
        exchange: index,
      },
    ],
    teach: exchange.note
      ? `The live sandbox did not answer, so SDODS replayed the recorded response — the same thing --har-replay does when CI has no internet.`
      : undefined,
  };
}

function heal(primary: string, context: string): Evidence {
  return { kind: 'locator', label: `${primary} — heal context: ${context}` };
}

function requireLogin(ctx: RunContext): void {
  if (!ctx.app.loggedInAs)
    throw new StepFailure(
      'The browser is on the login page, not the inventory. Sign in first, or lease a pooled user.',
    );
}

function shot(label: string): Evidence {
  return { kind: 'screenshot', label };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*')}$`);
}

/* ─────────────────────────────  the step table  ──────────────────────────────── */

export const STEPS: StepDefinition[] = [
  /* ---------------------------------- API ---------------------------------- */
  {
    keyword: 'Given',
    pattern: 'I set the variable {string} to {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [name, value]) => {
      ctx.vars[name!] = renderVars(value!, ctx.vars);
      return {
        detail: `${name} = "${ctx.vars[name!]}"`,
        evidence: [{ kind: 'variable', label: `${name} = ${ctx.vars[name!]}` }],
      };
    },
  },
  {
    keyword: 'Given',
    pattern: 'I set the query parameter {string} to {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [name, value]) => {
      ctx.query[name!] = renderVars(value!, ctx.vars);
      return { detail: `?${name}=${ctx.query[name!]} will be appended to the next request` };
    },
  },
  {
    keyword: 'Given',
    pattern: 'I set the request header {string} to {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [name, value]) => {
      ctx.headers[name!] = renderVars(value!, ctx.vars);
      return { detail: `${name}: ${ctx.headers[name!]}` };
    },
  },
  {
    keyword: 'When',
    pattern: 'I send a {method} request to {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [method, path], doc) => doRequest(ctx, method as HttpMethod, path!, doc),
  },
  {
    keyword: 'When',
    pattern: 'I send a {method} request to {string} with body',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [method, path], doc) => {
      if (!doc)
        throw new StepFailure('This step needs a """json docstring underneath it with the body.');
      return doRequest(ctx, method as HttpMethod, path!, doc);
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response status should be {int}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [expected]) => {
      const last = lastExchange(ctx);
      if (last.status !== Number(expected))
        throw new StepFailure(
          `Expected status ${expected} but the sandbox answered ${last.status} ${last.statusText}.`,
          expected,
          String(last.status),
        );
      return { detail: `status ${last.status}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response status should be one of {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [list]) => {
      const allowed = list!.split(',').map((s) => s.trim());
      const last = lastExchange(ctx);
      if (!allowed.includes(String(last.status)))
        throw new StepFailure(
          `Expected one of ${allowed.join(', ')} but the sandbox answered ${last.status}.`,
          allowed.join(' or '),
          String(last.status),
        );
      return { detail: `status ${last.status} is one of ${allowed.join(', ')}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response body should be an array',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx) => {
      const last = lastExchange(ctx);
      if (!Array.isArray(last.body))
        throw new StepFailure(`The body is ${typeof last.body}, not an array.`);
      return { detail: `array with ${last.body.length} entries` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response JSON path {string} should equal {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [path, expected]) => {
      const want = renderVars(expected!, ctx.vars);
      const actual = jsonPath(lastExchange(ctx).body, path!);
      if (stringify(actual) !== want)
        throw new StepFailure(
          `JSON path "${path}" is ${stringify(actual)}, expected "${want}".`,
          want,
          stringify(actual),
        );
      return { detail: `${path} = ${want}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response JSON path {string} should match {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [path, pattern]) => {
      const actual = stringify(jsonPath(lastExchange(ctx).body, path!));
      if (!new RegExp(renderVars(pattern!, ctx.vars)).test(actual))
        throw new StepFailure(`JSON path "${path}" (${actual}) does not match /${pattern}/.`);
      return { detail: `${path} matches /${pattern}/` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response JSON path {string} should exist',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [path]) => {
      const actual = jsonPath(lastExchange(ctx).body, path!);
      if (actual === undefined)
        throw new StepFailure(`JSON path "${path}" is not in the response.`);
      return { detail: `${path} = ${stringify(actual)}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response JSON path {string} should have {int} items',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [path, count]) => {
      const value = jsonPath(lastExchange(ctx).body, path!);
      const length = Array.isArray(value) ? value.length : -1;
      if (length !== Number(count))
        throw new StepFailure(`JSON path "${path}" has ${length} items, expected ${count}.`);
      return { detail: `${path} has ${count} items` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response header {string} should contain {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [name, expected]) => {
      const value = lastExchange(ctx).responseHeaders[name!.toLowerCase()] ?? '';
      if (!value.includes(expected!))
        throw new StepFailure(
          `Header ${name} is "${value}", which does not contain "${expected}".`,
        );
      return { detail: `${name}: ${value}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response time should be under {int} ms',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [budget]) => {
      const last = lastExchange(ctx);
      if (last.timeMs >= Number(budget))
        throw new StepFailure(
          `The response took ${last.timeMs} ms, over the ${budget} ms budget.`,
          `< ${budget} ms`,
          `${last.timeMs} ms`,
        );
      return {
        detail: `${last.timeMs} ms, budget ${budget} ms`,
        teach:
          last.source === 'replay'
            ? 'This timing is the replay, not the network. Against a real service the budget is the number that catches a slow release.'
            : undefined,
      };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the response should match the JSON schema {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [name]) => {
      const key = name!.replace(/^schemas\//, '').replace(/\.schema\.json$|\.json$/, '');
      const schema = SCHEMAS[key];
      if (!schema)
        throw new StepFailure(
          `No schema "${name}" here. The playground ships the "post" schema from projects/demo-shop/schemas/.`,
        );
      const errors = validateSchema(lastExchange(ctx).body, schema);
      if (errors.length) throw new StepFailure(`schema ${key} violations:\n${errors.join('\n')}`);
      return { detail: `body matches the ${key} schema` };
    },
  },
  {
    keyword: 'When',
    pattern: 'I save the response JSON path {string} as {string}',
    layer: 'api',
    source: 'packages/core/src/steps/api.steps.ts',
    run: (ctx, [path, name]) => {
      const value = jsonPath(lastExchange(ctx).body, path!);
      if (value === undefined)
        throw new StepFailure(
          `JSON path "${path}" is not in the response, so there is nothing to save.`,
        );
      ctx.vars[name!] = stringify(value);
      return {
        detail: `${name} = "${ctx.vars[name!]}"`,
        evidence: [{ kind: 'variable', label: `${name} = ${ctx.vars[name!]}` }],
        teach: `Every later step can now write {{${name}}} — that is how one scenario chains two calls without a helper file.`,
      };
    },
  },

  /* ----------------------------------- UI ---------------------------------- */
  {
    keyword: 'Given',
    pattern: 'I am on the login page',
    layer: 'ui',
    source: 'projects/demo-shop/pages/LoginPage.ts',
    run: async (ctx) => {
      Object.assign(ctx.app, initialApp(), { session: ctx.app.session, highlight: null });
      ctx.sync();
      await ctx.pause(200);
      return {
        detail: `navigated to ${UI_BASE}${ROUTES.login}`,
        evidence: [shot('screenshot: login page')],
      };
    },
  },
  {
    keyword: 'When',
    pattern: 'I login with {string} and {string}',
    layer: 'ui',
    source: 'projects/demo-shop/pages/LoginPage.ts',
    run: async (ctx, [rawUser, rawPassword]) => {
      const username = renderVars(rawUser!, ctx.vars);
      const password = renderVars(rawPassword!, ctx.vars);
      if (ctx.app.page !== 'login')
        throw new StepFailure(
          'The browser is not on the login page — add "Given I am on the login page".',
        );

      ctx.app.highlight = '#user-name';
      ctx.app.fields.username = username;
      ctx.sync();
      await ctx.pause(260);

      ctx.app.highlight = '#password';
      ctx.app.fields.password = password;
      ctx.sync();
      await ctx.pause(260);

      ctx.app.highlight = '#login-button';
      ctx.sync();
      await ctx.pause(280);

      const account = USERS[username];
      if (!account || account.password !== password) {
        ctx.app.error = MISMATCH_MESSAGE;
        ctx.app.highlight = '[data-test="error"]';
        ctx.sync();
        throw new StepFailure(
          `The storefront rejected the sign-in: ${MISMATCH_MESSAGE}`,
          '/inventory.html',
          '/',
        );
      }
      if (account.locked) {
        ctx.app.error = LOCKED_MESSAGE;
        ctx.app.highlight = '[data-test="error"]';
        ctx.sync();
        throw new StepFailure(
          `The storefront rejected the sign-in: ${LOCKED_MESSAGE}`,
          '/inventory.html',
          '/',
        );
      }
      ctx.app.loggedInAs = username;
      ctx.app.page = 'inventory';
      ctx.app.path = ROUTES.inventory!;
      ctx.app.error = null;
      ctx.app.highlight = null;
      ctx.sync();
      return {
        detail: `signed in as ${username} → ${ROUTES.inventory}`,
        evidence: [
          heal('#user-name', 'placeholder "Username", testId username'),
          heal('#password', 'placeholder "Password", testId password'),
          heal('#login-button', 'role button, name "Login", testId login-button'),
          shot('screenshot: inventory page'),
        ],
      };
    },
  },
  {
    keyword: 'Then',
    pattern: 'I should see the login error {string}',
    layer: 'ui',
    source: 'projects/demo-shop/pages/LoginPage.ts',
    run: (ctx, [expected]) => {
      if (!ctx.app.error || !ctx.app.error.includes(expected!))
        throw new StepFailure(
          `The page shows ${ctx.app.error ? `"${ctx.app.error}"` : 'no error'}, not "${expected}".`,
        );
      return { detail: `error banner contains "${expected}"` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the page URL should contain {string}',
    layer: 'ui',
    source: 'packages/core/src/steps/ui.steps.ts',
    run: (ctx, [fragment]) => {
      const url = `${UI_BASE}${ctx.app.path}`;
      if (!url.includes(renderVars(fragment!, ctx.vars)))
        throw new StepFailure(
          `The browser is at ${url}, which does not contain "${fragment}".`,
          fragment,
          url,
        );
      return { detail: url };
    },
  },
  {
    keyword: 'Then',
    pattern: 'I should be on the inventory page',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: (ctx) => {
      if (ctx.app.page !== 'inventory')
        throw new StepFailure(`The browser is at ${ctx.app.path}, not ${ROUTES.inventory}.`);
      return { detail: `on ${ROUTES.inventory}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the inventory title should be {string}',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: (ctx, [expected]) => {
      requireLogin(ctx);
      const title = 'Products';
      if (title !== expected)
        throw new StepFailure(`The title reads "${title}", not "${expected}".`, expected, title);
      return {
        detail: `title is "${title}"`,
        evidence: [heal('.title', 'text "Products", testId title')],
      };
    },
  },
  {
    keyword: 'Then',
    pattern: 'there should be {int} products listed',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: (ctx, [count]) => {
      requireLogin(ctx);
      if (PRODUCTS.length !== Number(count))
        throw new StepFailure(`The page lists ${PRODUCTS.length} products, not ${count}.`);
      return { detail: `${count} products listed` };
    },
  },
  {
    keyword: 'When',
    pattern: 'I add {string} to the cart',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: async (ctx, [raw]) => {
      requireLogin(ctx);
      const name = renderVars(raw!, ctx.vars);
      const product = findProduct(name);
      if (!product) throw new StepFailure(MISSING_PRODUCT(name));
      ctx.app.highlight = `[data-test="add-to-cart-${product.slug}"]`;
      ctx.sync();
      await ctx.pause(300);
      if (!ctx.app.cart.includes(product.name)) ctx.app.cart.push(product.name);
      ctx.app.highlight = '[data-test="shopping-cart-badge"]';
      ctx.sync();
      return {
        detail: `${product.name} added — badge now ${ctx.app.cart.length}`,
        evidence: [
          heal(`[data-test="add-to-cart-${product.slug}"]`, 'role button, name "Add to cart"'),
          shot('screenshot: after add to cart'),
        ],
      };
    },
  },
  {
    keyword: 'When',
    pattern: 'I remove {string} from the cart',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: async (ctx, [raw]) => {
      requireLogin(ctx);
      const name = renderVars(raw!, ctx.vars);
      const product = findProduct(name);
      if (!product) throw new StepFailure(MISSING_PRODUCT(name));
      if (!ctx.app.cart.includes(product.name))
        throw new StepFailure(`${product.name} is not in the cart, so there is no Remove button.`);
      ctx.app.highlight = `[data-test="remove-${product.slug}"]`;
      ctx.sync();
      await ctx.pause(300);
      ctx.app.cart = ctx.app.cart.filter((c) => c !== product.name);
      ctx.app.highlight = null;
      ctx.sync();
      return { detail: `${product.name} removed — badge now ${ctx.app.cart.length || 'hidden'}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the cart badge should show {int} item(s)',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: (ctx, [count]) => {
      if (ctx.app.cart.length !== Number(count))
        throw new StepFailure(
          `The badge shows ${ctx.app.cart.length || 'nothing'}, expected ${count}.`,
          String(count),
          String(ctx.app.cart.length),
        );
      return { detail: `badge shows ${count}` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the cart badge should be hidden',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: (ctx) => {
      if (ctx.app.cart.length !== 0)
        throw new StepFailure(`The badge still shows ${ctx.app.cart.length}.`);
      return { detail: 'no badge on the cart icon' };
    },
  },
  {
    keyword: 'When',
    pattern: 'I sort products by {string}',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: async (ctx, [option]) => {
      requireLogin(ctx);
      const allowed: SortKey[] = [
        'Name (A to Z)',
        'Name (Z to A)',
        'Price (low to high)',
        'Price (high to low)',
      ];
      if (!allowed.includes(option as SortKey))
        throw new StepFailure(`"${option}" is not one of: ${allowed.join(', ')}.`);
      ctx.app.highlight = '[data-test="product-sort-container"]';
      ctx.sync();
      await ctx.pause(260);
      ctx.app.sort = option as SortKey;
      ctx.app.highlight = null;
      ctx.sync();
      return {
        detail: `sorted by ${option}`,
        evidence: [heal('[data-test="product-sort-container"]', 'role combobox')],
      };
    },
  },
  {
    keyword: 'When',
    pattern: 'I open the cart',
    layer: 'ui',
    source: 'projects/demo-shop/pages/InventoryPage.ts',
    run: async (ctx) => {
      requireLogin(ctx);
      ctx.app.highlight = '[data-test="shopping-cart-link"]';
      ctx.sync();
      await ctx.pause(280);
      ctx.app.page = 'cart';
      ctx.app.path = ROUTES.cart!;
      ctx.app.highlight = null;
      ctx.sync();
      return { detail: `navigated to ${ROUTES.cart}`, evidence: [shot('screenshot: cart page')] };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the cart should list {string}',
    layer: 'ui',
    source: 'projects/demo-shop/pages/CartPage.ts',
    run: (ctx, [raw]) => {
      const name = renderVars(raw!, ctx.vars);
      if (ctx.app.page !== 'cart') throw new StepFailure('The browser is not on the cart page.');
      if (!ctx.app.cart.some((item) => item.toLowerCase() === name.toLowerCase()))
        throw new StepFailure(
          `The cart lists ${ctx.app.cart.length ? ctx.app.cart.join(', ') : 'nothing'}, not "${name}".`,
        );
      return { detail: `cart lists "${name}"` };
    },
  },
  {
    keyword: 'Then',
    pattern: 'I should see the text {string}',
    layer: 'ui',
    source: 'packages/core/src/steps/ui.steps.ts',
    run: (ctx, [raw]) => {
      const text = renderVars(raw!, ctx.vars);
      if (!visibleText(ctx.app).includes(text))
        throw new StepFailure(`The page does not show "${text}".`, text, 'not on the page');
      return { detail: `page shows "${text}"` };
    },
  },
  {
    keyword: 'When',
    pattern: 'I navigate to the {string} page',
    layer: 'ui',
    source: 'packages/core/src/steps/ui.steps.ts',
    run: async (ctx, [route]) => {
      const path = ROUTES[route!];
      if (!path)
        throw new StepFailure(
          `"${route}" is not a route in sdods.project.yaml. Known routes: ${Object.keys(ROUTES).join(', ')}.`,
        );
      const mock = ctx.mocks.find((m) => globToRegExp(m.glob).test(`${UI_BASE}${path}`));
      ctx.app.path = path;
      ctx.app.highlight = null;
      if (mock) {
        const rendered = renderVars(mock.body, ctx.vars);
        ctx.app.page = 'mocked';
        ctx.app.mocked = {
          text: mock.kind === 'html' ? textFromHtml(rendered) : rendered,
          source: mock.glob,
        };
      } else {
        if (!ctx.app.loggedInAs && route !== 'login')
          throw new StepFailure(
            `${path} redirects to the login page unless the browser already has a session.`,
          );
        ctx.app.mocked = null;
        ctx.app.page = route === 'cart' ? 'cart' : route === 'login' ? 'login' : 'inventory';
      }
      ctx.sync();
      await ctx.pause(240);
      return {
        detail: mock ? `${path} answered by the mock ${mock.glob}` : `navigated to ${path}`,
        evidence: [shot(`screenshot: ${path}`)],
      };
    },
  },
  {
    keyword: 'When',
    pattern: 'I mock {string} with HTML',
    layer: 'ui',
    source: 'packages/core/src/steps/ui.steps.ts',
    run: (ctx, [glob], doc) => {
      if (!doc)
        throw new StepFailure('This step needs a """ docstring with the HTML underneath it.');
      ctx.mocks.push({ glob: glob!, kind: 'html', body: doc });
      return { detail: `${glob} will be answered from the scenario, not the network` };
    },
  },
  {
    keyword: 'When',
    pattern: 'I mock {string} with JSON',
    layer: 'ui',
    source: 'packages/core/src/steps/ui.steps.ts',
    run: (ctx, [glob], doc) => {
      if (!doc) throw new StepFailure('This step needs a """json docstring underneath it.');
      ctx.mocks.push({ glob: glob!, kind: 'json', body: doc });
      return { detail: `${glob} will be answered with the JSON in the docstring` };
    },
  },

  /* --------------------------------- hybrid -------------------------------- */
  {
    keyword: 'Given',
    pattern: 'I use a leased user with role {string}',
    layer: 'hybrid',
    source: 'packages/core/src/steps/data.steps.ts',
    run: async (ctx, [role]) => {
      const byRole: Record<string, string> = {
        standard: 'standard_user',
        problem: 'problem_user',
        performance: 'performance_glitch_user',
        locked: 'locked_out_user',
      };
      const username = byRole[role!];
      if (!username)
        throw new StepFailure(
          `No pool user with role "${role}". demo-shop leases: ${Object.keys(byRole).join(', ')}.`,
        );
      ctx.lease = { role: role!, username };
      ctx.vars.username = username;
      ctx.app.session = `${username} · leased for worker 1 · storage state applied`;
      if (!USERS[username]!.locked) {
        ctx.app.loggedInAs = username;
        ctx.app.page = 'inventory';
        ctx.app.path = ROUTES.inventory!;
      }
      ctx.sync();
      await ctx.pause(240);
      return {
        detail: `leased ${username} (role ${role}) and applied its cached storage state`,
        evidence: [{ kind: 'variable', label: `username = ${username}` }],
        teach:
          'The browser starts logged in because the pool replays a saved storage state — no sign-in steps, no shared account fighting another worker.',
      };
    },
  },
  {
    keyword: 'When',
    pattern: 'I seed via {method} {string} with body',
    layer: 'hybrid',
    source: 'packages/core/src/steps/hybrid.steps.ts',
    run: async (ctx, [method, path], doc) => {
      if (!doc) throw new StepFailure('This step needs a """json docstring with the body to seed.');
      const outcome = await doRequest(ctx, method as HttpMethod, path!, doc);
      return {
        ...outcome,
        teach:
          outcome.teach ??
          'Seeding over HTTP is the cheap half of the scenario: no clicking through a form to reach the state you actually want to test.',
      };
    },
  },
  {
    keyword: 'Then',
    pattern: 'the UI should show the text from JSON path {string}',
    layer: 'hybrid',
    source: 'packages/core/src/steps/hybrid.steps.ts',
    run: (ctx, [path]) => {
      const expected = stringify(jsonPath(lastExchange(ctx).body, path!));
      if (expected === 'undefined')
        throw new StepFailure(`JSON path "${path}" is not in the last response.`);
      if (!visibleText(ctx.app).includes(expected))
        throw new StepFailure(
          `The page does not show the API value "${expected}".`,
          expected,
          visibleText(ctx.app).slice(0, 80),
        );
      return {
        detail: `the page shows "${expected}" — the value the API returned`,
        evidence: [shot('screenshot: page showing the seeded value')],
        teach:
          'One assertion just crossed both layers: the string came from an HTTP response and was found in the rendered page.',
      };
    },
  },
];

export interface Match {
  definition: StepDefinition;
  args: string[];
}

export function matchStep(text: string): Match | null {
  for (const definition of STEPS) {
    const found = compile(definition.pattern).exec(text.trim());
    if (found) return { definition, args: found.slice(1) };
  }
  return null;
}

/** The catalogue shown under "Steps you can use", grouped the way the docs group them. */
export function stepsByLayer(layer: StepLayer): StepDefinition[] {
  if (layer === 'hybrid') return STEPS;
  return STEPS.filter((s) => s.layer === layer);
}
