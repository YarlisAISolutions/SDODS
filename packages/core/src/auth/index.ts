import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { ResolvedConfig } from '../config/resolve.js';

export interface PoolUserLike {
  id: string;
  username: string;
  password: string;
  role: string;
  index: number;
  extra?: Record<string, unknown>;
}

export interface AuthLoginArgs {
  browser: Browser;
  config: ResolvedConfig;
  user: PoolUserLike;
  /** Provided when logging in live inside a scenario (step path). */
  page?: Page;
  context?: BrowserContext;
}

export interface AuthTokenArgs {
  config: ResolvedConfig;
  user: PoolUserLike;
}

export interface AuthStrategy {
  readonly strategy: 'none' | 'form' | 'token' | 'oauth-client-credentials' | 'sso' | 'custom';
  /**
   * Perform a login in a fresh context and return the storageState JSON (as object).
   * Return undefined when the strategy has nothing to persist (e.g. 'none').
   */
  login(args: AuthLoginArgs): Promise<Record<string, unknown> | undefined>;
  /** Optional: obtain an API token for this user (used by ApiClient when env.api.auth is none). */
  token?(args: AuthTokenArgs): Promise<string | undefined>;
}

export type AuthDefinition =
  | { strategy: 'none' }
  | { strategy: 'form'; login?: (args: AuthLoginArgs) => Promise<void> }
  | { strategy: 'token'; token: (args: AuthTokenArgs) => Promise<string> }
  | { strategy: 'oauth-client-credentials' }
  | { strategy: 'sso' }
  | { strategy: 'custom'; login: AuthStrategy['login']; token?: AuthStrategy['token'] };

/**
 * Define the project's auth strategy. `form` uses `auth.form` selectors from the project yaml
 * unless a custom `login` is provided.
 */
export function defineAuth(def: AuthDefinition): AuthStrategy {
  switch (def.strategy) {
    case 'none':
      return { strategy: 'none', login: async () => undefined };
    case 'form':
      return {
        strategy: 'form',
        login: async (args) => {
          const { browser, config, user } = args;
          const context =
            args.context ?? (await browser.newContext({ baseURL: config.env.ui.baseUrl }));
          const page = args.page ?? (await context.newPage());
          try {
            if (def.login) await def.login({ ...args, page, context });
            else await formLogin(page, config, user);
            return (await context.storageState()) as unknown as Record<string, unknown>;
          } finally {
            if (!args.context) await context.close();
          }
        },
      };
    case 'token':
      return {
        strategy: 'token',
        login: async () => undefined,
        token: def.token,
      };
    case 'oauth-client-credentials':
      return {
        strategy: 'oauth-client-credentials',
        login: async () => undefined,
        token: async ({ config }) => {
          const auth = config.env.api.auth;
          if (auth.type !== 'oauth-client-credentials') return undefined;
          const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: auth.clientId,
            client_secret: auth.clientSecret,
          });
          if (auth.scope) body.set('scope', auth.scope);
          if (auth.audience) body.set('audience', auth.audience);
          const res = await fetch(auth.tokenUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
          });
          if (!res.ok)
            throw new Error(`OAuth token request failed: ${res.status} ${res.statusText}`);
          const json = (await res.json()) as { access_token?: string };
          return json.access_token;
        },
      };
    case 'sso':
      return { strategy: 'sso', login: async () => undefined };
    case 'custom':
      return { strategy: 'custom', login: def.login, token: def.token };
  }
}

export async function formLogin(
  page: Page,
  config: ResolvedConfig,
  user: PoolUserLike,
): Promise<void> {
  const form = config.project.auth.form;
  if (!form) {
    throw new Error(
      'auth.strategy is "form" but auth.form selectors are missing in sdods.project.yaml.',
    );
  }
  try {
    await page.goto(form.loginPath);
    await page.locator(form.usernameSelector).fill(user.username);
    await page.locator(form.passwordSelector).fill(user.password);
    await page.locator(form.submitSelector).click();
    if (form.readySelector)
      await page.locator(form.readySelector).first().waitFor({ state: 'visible' });
    else if (form.readyUrl) await page.waitForURL(`**${form.readyUrl}*`);
    else await page.waitForLoadState('domcontentloaded');
  } catch (cause) {
    throw await describeLoginFailure(page, config, user, cause);
  }
}

/**
 * The form login runs in its own context (see `defineAuth`), so Playwright's video/trace/screenshot
 * settings never attach to it — a failure here would otherwise surface as a bare locator timeout
 * with no artifact. Name the page we actually landed on, and leave a screenshot behind.
 */
async function describeLoginFailure(
  page: Page,
  config: ResolvedConfig,
  user: PoolUserLike,
  cause: unknown,
): Promise<Error> {
  let where = '';
  let shot = '';
  try {
    const url = page.url();
    const title = await page.title();
    where = ` at ${url}${title ? ` (title: ${JSON.stringify(title)})` : ''}`;
  } catch {
    // page already closed or crashed — the original error is still worth reporting
  }
  try {
    const dir = join(config.runtime.runDir, 'auth');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `login-failed-${user.role}-${user.username}.png`.replace(/\s+/g, '_'));
    await page.screenshot({ path: file, fullPage: true });
    shot = `\nScreenshot: ${file}`;
  } catch {
    // screenshotting is best effort
  }
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Form login for ${user.username} (${user.role}) failed${where}.\n${reason}` +
      `\nIs the application under test running at ${config.env.ui.baseUrl}, and does that page ` +
      `use the auth.form selectors in sdods.project.yaml?${shot}`,
    { cause },
  );
}

export const noopAuth: AuthStrategy = defineAuth({ strategy: 'none' });
