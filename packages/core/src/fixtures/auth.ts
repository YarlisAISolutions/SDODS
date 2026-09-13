import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

function originOf(url: string): string | undefined {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? undefined : o;
  } catch {
    return undefined;
  }
}

/**
 * Restore one origin's localStorage into a live context without navigating (#99).
 *
 * This used to `page.goto(origin)` and write the keys from there. An app that sends a signed-in
 * visitor away from `/` on the client then had a redirect chain still running when the step
 * returned, and the scenario's first `page.goto` was aborted (`net::ERR_ABORTED`). The context
 * already exists by the time a step leases a user, so `newContext({ storageState })` is not an
 * option here (the `@user:<role>` tag path does use it, via `ensure`).
 *
 * - Page already on the origin: write the keys straight into it. Nothing navigates.
 * - Otherwise: a context init script writes them in the first document of that origin, before the
 *   app's own scripts run, in any page of the context.
 *
 * Planted ONCE per context, not on every navigation. An init script left in place would run again
 * on each document, so an app that signs out (clears storage) and navigates would be silently
 * signed back in and a logout scenario would pass while proving nothing. The script is therefore
 * disposed once a document of that origin has reached DOMContentLoaded (by then it has certainly
 * run). A navigation that commits in the short window before the dispose lands can run it again;
 * it only writes keys that are absent, so it never overwrites what the app wrote meanwhile.
 *
 * Only localStorage is restored, as before: storageState carries no sessionStorage or IndexedDB.
 */
async function plantLocalStorage(
  context: BrowserContext,
  page: Page,
  origin: string,
  items: Array<{ name: string; value: string }>,
): Promise<void> {
  if (originOf(page.url()) === origin) {
    await page.evaluate((entries) => {
      for (const { name, value } of entries) window.localStorage.setItem(name, value);
    }, items);
    return;
  }
  const script = await context.addInitScript(
    ({ origin: target, entries }) => {
      if (location.origin !== target) return;
      try {
        for (const { name, value } of entries) {
          if (window.localStorage.getItem(name) === null) window.localStorage.setItem(name, value);
        }
      } catch {
        // storage disabled for this document (sandboxed frame): nothing to plant into
      }
    },
    { origin, entries: items },
  );
  const watched = new Set<Page>();
  let disposed = false;
  const onLoaded = (p: Page) => {
    if (disposed || originOf(p.url()) !== origin) return;
    disposed = true;
    context.off('page', watch);
    for (const w of watched) w.off('domcontentloaded', onLoaded);
    void script.dispose().catch(() => undefined);
  };
  const watch = (p: Page) => {
    watched.add(p);
    p.on('domcontentloaded', onLoaded);
  };
  context.on('page', watch);
  for (const p of context.pages()) watch(p);
}

/** How long another worker may hold the refresh lock before we treat it as crashed. */
const LOCK_STALE_MS = 90_000;
const LOCK_POLL_MS = 250;

/**
 * storageState per pool user: `projects/<slug>/.auth/<env>/<role>-<n>.json` (gitignored).
 *
 * Several workers (and several browser projects) may need the same user at the same moment,
 * so refreshes are serialised with a lock file, state files are written atomically
 * (temp + rename) and a cached file is only trusted when it parses and carries cookies or
 * localStorage.
 */
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

  private lockFor(user: PoolUserLike): string {
    return this.fileFor(user).replace(/\.json$/, '.lock');
  }

  /** Fresh = sidecar within maxAgeMinutes AND the state file is valid JSON with something in it. */
  isFresh(user: PoolUserLike): boolean {
    const side = this.sidecarFor(user);
    const file = this.fileFor(user);
    if (!existsSync(file) || !existsSync(side)) return false;
    try {
      const meta = JSON.parse(readFileSync(side, 'utf8')) as { capturedAt: string };
      const age = (Date.now() - Date.parse(meta.capturedAt)) / 60_000;
      if (!(age < this.config.project.auth.maxAgeMinutes)) return false;
      return this.readState(file) !== undefined;
    } catch {
      return false;
    }
  }

  private readState(file: string): StorageStateJson | undefined {
    try {
      const state = JSON.parse(readFileSync(file, 'utf8')) as StorageStateJson;
      // Session cookies often expire long before maxAgeMinutes (SauceDemo: 10 minutes).
      // Drop expired ones; if nothing usable remains the state is stale and gets refreshed.
      const nowSec = Date.now() / 1000 + 30;
      const hadCookies = Array.isArray(state.cookies) && state.cookies.length > 0;
      if (Array.isArray(state.cookies)) {
        state.cookies = state.cookies.filter((c) => {
          const exp = typeof c.expires === 'number' ? c.expires : -1;
          return exp === -1 || exp > nowSec;
        });
      }
      const hasCookies = Array.isArray(state.cookies) && state.cookies.length > 0;
      // A login captured as cookies whose cookies have all expired is stale even if
      // unrelated localStorage entries (analytics ids) survive.
      if (hadCookies && !hasCookies) return undefined;
      const hasStorage =
        Array.isArray(state.origins) && state.origins.some((o) => o.localStorage?.length > 0);
      return hasCookies || hasStorage ? state : undefined;
    } catch {
      return undefined;
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
        `No fresh SSO storage state for ${user.username}. Run: sdods auth capture --user ${user.role} --interactive`,
      );
      return existsSync(this.fileFor(user)) ? this.fileFor(user) : undefined;
    }
    return this.withLock(user, async () => {
      // another worker may have refreshed while we waited for the lock
      if (this.isFresh(user)) return this.fileFor(user);
      this.log.step(`capturing login state for ${user.username} (${user.role})`);
      const state = await auth.login({ browser, config: this.config, user });
      if (!state) return undefined;
      return this.save(user, state);
    });
  }

  /**
   * Atomic save: temp file + rename, sidecar written last.
   *
   * Written owner-only. This file is a live session for the application under test — cookies and
   * localStorage, replayable as-is — and it used to land world-readable (0644 in a 0755
   * directory), so any other account on the machine could lift it. Encryption is not the control
   * here: the state has to be decryptable to be replayed, so a key would have to sit on the same
   * disk. Restricting access is what actually protects it.
   */
  save(user: PoolUserLike, state: Record<string, unknown>): string {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.fileFor(user);
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    const sideTmp = `${this.sidecarFor(user)}.${process.pid}.tmp`;
    writeFileSync(
      sideTmp,
      JSON.stringify(
        { capturedAt: new Date().toISOString(), user: user.username, role: user.role },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    renameSync(sideTmp, this.sidecarFor(user));
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
    let file = this.isFresh(user) ? this.fileFor(user) : undefined;
    if (!file && auth.strategy !== 'sso') {
      const refreshed = await this.withLock(user, async () => {
        if (this.isFresh(user)) return { file: this.fileFor(user), live: false };
        const state = await auth.login({ browser, config: this.config, user, page, context });
        if (!state) return undefined;
        this.save(user, state);
        return { file: undefined, live: true };
      });
      if (refreshed?.live) return true; // logged in live in this very page
      file = refreshed?.file;
    }
    if (!file) return false;
    const state = this.readState(file);
    if (!state) return false;
    if (state.cookies?.length) await context.addCookies(state.cookies as any);
    for (const origin of state.origins ?? []) {
      if (!origin.localStorage?.length) continue;
      await plantLocalStorage(context, page, origin.origin, origin.localStorage);
    }
    return true;
  }

  /**
   * Cross-process lock around a refresh. Uses an O_EXCL lock file; a lock older than
   * LOCK_STALE_MS is treated as abandoned by a crashed worker.
   */
  private async withLock<T>(user: PoolUserLike, fn: () => Promise<T>): Promise<T> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const lock = this.lockFor(user);
    const deadline = Date.now() + LOCK_STALE_MS * 2;
    for (;;) {
      try {
        closeSync(openSync(lock, 'wx'));
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        let stale = false;
        try {
          stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
        } catch {
          continue; // lock vanished between the failed open and stat: retry immediately
        }
        if (stale) {
          this.log.warn(`removing stale auth lock ${lock}`);
          rmSync(lock, { force: true });
          continue;
        }
        if (Date.now() > deadline) {
          this.log.warn(`giving up waiting for auth lock ${lock}; refreshing anyway`);
          break;
        }
        await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
      }
    }
    try {
      return await fn();
    } finally {
      rmSync(lock, { force: true });
    }
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
