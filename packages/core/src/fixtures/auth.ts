import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { ResolvedConfig } from '../config/resolve.js';
import type { AuthStrategy, PoolUserLike } from '../auth/index.js';
import { Logger } from '../logger.js';

export interface StorageStateJson {
  cookies?: Array<Record<string, unknown>>;
  origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

export interface CachedState {
  file: string;
  capturedAt: string;
  ageMinutes: number;
  user: string;
  role: string;
}

/** storageState per pool user: `projects/<slug>/.auth/<env>/<role>-<n>.json` (gitignored). */
export class AuthStateCache {
  private readonly log = new Logger('auth');
  readonly dir: string;

  constructor(private readonly config: ResolvedConfig) {
    this.dir = join(config.project.root, '.auth', config.env.name);
  }

  fileFor(user: PoolUserLike): string {
    return join(this.dir, `${user.role}-${user.index}.json`);
  }

  sidecarFor(user: PoolUserLike): string {
    return this.fileFor(user).replace(/\.json$/, '.meta.json');
  }

  isFresh(user: PoolUserLike): boolean {
    const side = this.sidecarFor(user);
    if (!existsSync(this.fileFor(user)) || !existsSync(side)) return false;
    try {
      const meta = JSON.parse(readFileSync(side, 'utf8')) as { capturedAt: string };
      const age = (Date.now() - Date.parse(meta.capturedAt)) / 60_000;
      return age < this.config.project.auth.maxAgeMinutes;
    } catch {
      return false;
    }
  }

  /** Return a fresh storageState path for the user, capturing it with the strategy when needed. */
  async ensure(
    user: PoolUserLike,
    auth: AuthStrategy,
    browser: Browser,
  ): Promise<string | undefined> {
    if (auth.strategy === 'none') return undefined;
    if (this.isFresh(user)) return this.fileFor(user);
    if (auth.strategy === 'sso') {
      this.log.warn(
        `No fresh SSO storage state for ${user.username}. Run: automax auth capture --user ${user.role} --interactive`,
      );
      return existsSync(this.fileFor(user)) ? this.fileFor(user) : undefined;
    }
    this.log.step(`capturing login state for ${user.username} (${user.role})`);
    const state = await auth.login({ browser, config: this.config, user });
    if (!state) return undefined;
    return this.save(user, state);
  }

  save(user: PoolUserLike, state: Record<string, unknown>): string {
    mkdirSync(this.dir, { recursive: true });
    const file = this.fileFor(user);
    writeFileSync(file, JSON.stringify(state, null, 2));
    writeFileSync(
      this.sidecarFor(user),
      JSON.stringify(
        { capturedAt: new Date().toISOString(), user: user.username, role: user.role },
        null,
        2,
      ),
    );
    return file;
  }

  /** Apply a cached state to a live context/page (step path: cookies + localStorage). */
  async apply(args: {
    context: BrowserContext;
    page: Page;
    user: PoolUserLike;
    auth: AuthStrategy;
    browser: Browser;
  }): Promise<boolean> {
    const { context, page, user, auth, browser } = args;
    if (auth.strategy === 'none') return false;
    const file = this.isFresh(user) ? this.fileFor(user) : undefined;
    if (!file && auth.strategy !== 'sso') {
      const state = await auth.login({ browser, config: this.config, user, page, context });
      if (state) {
        this.save(user, state);
        return true; // logged in live in this very page
      }
    }
    if (!file) return false;
    const state = JSON.parse(readFileSync(file, 'utf8')) as StorageStateJson;
    if (state.cookies?.length) await context.addCookies(state.cookies as any);
    for (const origin of state.origins ?? []) {
      if (!origin.localStorage?.length) continue;
      await page.goto(origin.origin, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.evaluate((items) => {
        for (const { name, value } of items) window.localStorage.setItem(name, value);
      }, origin.localStorage);
    }
    return true;
  }

  list(): CachedState[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.meta.json'))
      .map((f) => {
        const meta = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as {
          capturedAt: string;
          user: string;
          role: string;
        };
        const file = join(this.dir, f.replace('.meta.json', '.json'));
        return {
          file,
          capturedAt: meta.capturedAt,
          ageMinutes: Math.round((Date.now() - Date.parse(meta.capturedAt)) / 60_000),
          user: meta.user,
          role: meta.role,
          size: existsSync(file) ? statSync(file).size : 0,
        };
      });
  }
}
