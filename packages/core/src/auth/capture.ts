import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { execa } from 'execa';
import type { Browser } from '@playwright/test';
import type { ResolvedConfig } from '../config/resolve.js';
import { SdodsError } from '../errors.js';
import { Logger } from '../logger.js';
import { CompositeDataProvider } from '../data/provider.js';
import { AuthStateCache, type CachedState } from '../fixtures/auth.js';
import { defineAuth, type AuthStrategy, type PoolUserLike } from './index.js';

const log = new Logger('auth');

export type CaptureBrowser = 'chromium' | 'firefox' | 'webkit';

export interface CaptureOptions {
  config: ResolvedConfig;
  role: string;
  /** 0-based index within the role (default 0) */
  index?: number;
  /** capture every user of the role */
  all?: boolean;
  /** open `playwright codegen --save-storage` so a person completes the login (SSO/MFA) */
  interactive?: boolean;
  browserName?: CaptureBrowser;
  headed?: boolean;
  /** login URL for interactive mode (default: auth.form.loginPath or "/") */
  loginUrl?: string;
  strategy?: AuthStrategy;
  /** recapture even when a fresh state exists (default: skip fresh states) */
  force?: boolean;
  /** injectable for tests */
  launch?: (name: CaptureBrowser, headed: boolean) => Promise<Browser>;
  /** injectable for tests: run the interactive codegen */
  runInteractive?: (args: string[]) => Promise<number>;
}

export interface CaptureResult {
  user: string;
  role: string;
  index: number;
  strategy: AuthStrategy['strategy'];
  file?: string;
  tokenFile?: string;
  skipped?: string;
}

/** Users of a role from the pool dataset (capped by env.users.poolSize), without leasing them. */
export async function poolUsers(config: ResolvedConfig, role?: string): Promise<PoolUserLike[]> {
  const pool = config.project.data.userPool;
  if (!pool) {
    throw new SdodsError(
      'CONFIG_INVALID',
      `Project ${config.project.slug} has no data.userPool configured.`,
      {
        hint: 'Add data.userPool: { dataset: users, roleColumn: role } to sdods.project.yaml.',
        exitCode: 2,
      },
    );
  }
  const provider = new CompositeDataProvider(config);
  let rows = await provider.load(pool.dataset);
  const size = config.env.users.poolSize;
  if (size) rows = rows.slice(0, size);
  const users = rows.map((r, i) => ({
    id: String(r.id ?? r.username ?? i),
    username: String(r.username ?? r.id ?? i),
    password: String(r.password ?? ''),
    role: String(r[pool.roleColumn] ?? 'standard'),
    index: 0,
    extra: r as Record<string, unknown>,
  }));
  const filtered = role ? users.filter((u) => u.role === role) : users;
  // index = position within the role (matches AuthStateCache file naming <role>-<n>.json)
  const perRole = new Map<string, number>();
  for (const u of filtered) {
    const n = perRole.get(u.role) ?? 0;
    u.index = n;
    perRole.set(u.role, n + 1);
  }
  if (role && !filtered.length) {
    throw new SdodsError(
      'USER_POOL_EXHAUSTED',
      `No users with role "${role}" in dataset "${pool.dataset}" (env ${config.env.name}).`,
      {
        hint: `Roles present: ${[...new Set(users.map((u) => u.role))].join(', ') || '(none)'}.`,
        exitCode: 2,
      },
    );
  }
  return filtered;
}

/** Load `projects/<slug>/steps/auth.ts` (export `auth`), else derive from the yaml strategy. */
export async function loadProjectAuth(config: ResolvedConfig): Promise<AuthStrategy> {
  const candidates = ['steps/auth.ts', 'steps/auth.js', 'auth.ts'].map((f) =>
    join(config.project.root, f),
  );
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)) as {
      auth?: AuthStrategy;
      default?: AuthStrategy;
    };
    const strategy = mod.auth ?? mod.default;
    if (strategy && typeof strategy.login === 'function') return strategy;
  }
  const declared = config.project.auth.strategy;
  switch (declared) {
    case 'none':
    case 'form':
    case 'oauth-client-credentials':
    case 'sso':
      return defineAuth({ strategy: declared });
    default:
      throw new SdodsError(
        'CONFIG_INVALID',
        `auth.strategy "${declared}" needs an \`auth\` export in projects/${config.project.slug}/steps/auth.ts.`,
        {
          hint: "export const auth = defineAuth({ strategy: 'custom', login: async ({ page, user }) => { ... } })",
          exitCode: 2,
        },
      );
  }
}

export function tokenFileFor(config: ResolvedConfig, user: PoolUserLike): string {
  return join(
    config.project.root,
    '.auth',
    config.env.name,
    `${user.role}-${user.index}.token.json`,
  );
}

async function defaultLaunch(name: CaptureBrowser, headed: boolean): Promise<Browser> {
  const pw = await import('@playwright/test');
  return pw[name].launch({ headless: !headed });
}

async function defaultInteractive(args: string[]): Promise<number> {
  const res = await execa('npx', args, { stdio: 'inherit', reject: false });
  return res.exitCode ?? 1;
}

/**
 * Capture login state for pool users of a role: form/custom strategies log in headlessly and
 * persist `storageState`; token strategies write `<role>-<n>.token.json`; SSO (or --interactive)
 * opens `playwright codegen --save-storage` so a person completes the login.
 */
export async function captureAuth(opts: CaptureOptions): Promise<CaptureResult[]> {
  const { config } = opts;
  const strategy = opts.strategy ?? (await loadProjectAuth(config));
  const cache = new AuthStateCache(config);
  const users = await poolUsers(config, opts.role);
  const selected = opts.all ? users : ([users[opts.index ?? 0]].filter(Boolean) as PoolUserLike[]);
  if (!selected.length) {
    throw new SdodsError(
      'USER_POOL_EXHAUSTED',
      `Role "${opts.role}" has ${users.length} user(s); index ${opts.index ?? 0} does not exist.`,
      { exitCode: 2 },
    );
  }
  const results: CaptureResult[] = [];
  let browser: Browser | undefined;
  try {
    for (const user of selected) {
      const result: CaptureResult = {
        user: user.username,
        role: user.role,
        index: user.index,
        strategy: strategy.strategy,
      };
      if (strategy.strategy === 'none') {
        result.skipped = 'auth.strategy is none';
        results.push(result);
        continue;
      }
      if (!opts.force && cache.isFresh(user)) {
        result.file = cache.fileFor(user);
        result.skipped = 'fresh state exists (use force to recapture)';
        results.push(result);
        continue;
      }
      const interactive = opts.interactive || strategy.strategy === 'sso';
      if (interactive) {
        const file = cache.fileFor(user);
        const loginUrl = new URL(
          opts.loginUrl ?? config.project.auth.form?.loginPath ?? '/',
          config.env.ui.baseUrl,
        ).toString();
        const args = ['playwright', 'codegen', '--save-storage', file];
        if (opts.browserName && opts.browserName !== 'chromium') args.push('-b', opts.browserName);
        args.push(loginUrl);
        log.step(
          `interactive login for ${user.username} (${user.role}) → complete the login, then close the window`,
        );
        const code = await (opts.runInteractive ?? defaultInteractive)(args);
        if (code !== 0 && !existsSync(file)) {
          result.skipped = `codegen exited with ${code} and wrote no storage state`;
        } else if (existsSync(file)) {
          cache.save(user, JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>);
          result.file = file;
        }
      } else {
        browser ??= await (opts.launch ?? defaultLaunch)(
          opts.browserName ?? 'chromium',
          Boolean(opts.headed),
        );
        log.step(`capturing login state for ${user.username} (${user.role})`);
        const state = await strategy.login({ browser, config, user });
        if (state) result.file = cache.save(user, state);
        else if (!strategy.token) result.skipped = 'strategy returned no storage state';
      }
      if (strategy.token) {
        const token = await strategy.token({ config, user });
        if (token) {
          const file = tokenFileFor(config, user);
          // Owner-only: this holds a usable API token for the application under test.
          writeFileSync(
            file,
            JSON.stringify(
              { token, capturedAt: new Date().toISOString(), user: user.username, role: user.role },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          result.tokenFile = file;
        }
      }
      results.push(result);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }
  return results;
}

export function listAuthStates(
  config: ResolvedConfig,
): Array<CachedState & { fresh: boolean; tokenFile?: string }> {
  const cache = new AuthStateCache(config);
  return cache.list().map((s) => {
    const tokenFile = s.file.replace(/\.json$/, '.token.json');
    return {
      ...s,
      fresh: s.ageMinutes < config.project.auth.maxAgeMinutes,
      tokenFile: existsSync(tokenFile) ? tokenFile : undefined,
    };
  });
}
