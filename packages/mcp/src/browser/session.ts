import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrowserName } from '@sdods/contracts';
import { sdodsCli } from '../cli.js';
import { buildSessionLaunch, type ResolvedForBrowser } from './config.js';
import { createPlaywrightDriver } from './playwright-driver.js';
import { UPSTREAM_DEFAULTS, type UpstreamToolName } from './shapes.js';
import type { BrowserDriver, BrowserSessionSpec, SessionInfo } from './types.js';

/**
 * Live browser sessions for ONE MCP connection.
 *
 * Deliberately not a module-level map keyed by a caller-supplied id. The HTTP transport builds one
 * server and one ToolContext per mcp-session-id and already refuses a session whose principal
 * differs; a process-wide map would let a second principal name the first one's session id and
 * drive their logged-in browser. Ownership by context makes that unreachable.
 */
export interface SessionManagerOptions {
  rootDir: string;
  /** Reaps a session that nobody has used. Browsers are expensive to leave running. */
  idleMs?: number;
  maxSessions?: number;
  /**
   * Seams. The default implementations spawn the pinned Playwright MCP child and shell out to
   * `sdods config show`; overriding them lets the lifecycle be tested without either, and is where
   * a second BrowserDriver would be plugged in.
   */
  createDriver?: (args: { repoRoot: string; argv: string[] }) => Promise<BrowserDriver>;
  resolveConfig?: (project: string, env?: string) => Promise<ResolvedForBrowser>;
}

interface Entry {
  driver: BrowserDriver;
  info: SessionInfo;
  timer?: NodeJS.Timeout;
}

export const DEFAULT_IDLE_MS = 10 * 60_000;
export const DEFAULT_MAX_SESSIONS = 4;

export class BrowserSessionManager {
  private readonly sessions = new Map<string, Entry>();
  private readonly idleMs: number;
  private readonly maxSessions: number;

  constructor(private readonly opts: SessionManagerOptions) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((e) => e.info);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  async open(spec: BrowserSessionSpec): Promise<SessionInfo> {
    await this.close(spec.sessionId);
    if (this.sessions.size >= this.maxSessions) {
      throw Object.assign(new Error(`At most ${this.maxSessions} browser sessions at a time.`), {
        error: {
          code: 'BROWSER_TOO_MANY_SESSIONS',
          hint: 'Close one with browser_session_close, or list them with browser_session_list.',
        },
      });
    }

    const resolved = await this.resolve(spec.project, spec.env);
    const storageStateFile = spec.role
      ? await this.storageStateFor(spec.project, spec.env, spec.role)
      : undefined;
    const launch = buildSessionLaunch(resolved, spec, { storageStateFile });

    mkdirSync(dirname(launch.configPath), { recursive: true });
    writeFileSync(launch.configPath, `${JSON.stringify(launch.configFile, null, 2)}\n`);

    const driver = this.opts.createDriver
      ? await this.opts.createDriver({ repoRoot: this.opts.rootDir, argv: launch.argv })
      : await createPlaywrightDriver({
          repoRoot: this.opts.rootDir,
          argv: launch.argv,
          defaultsFor: (tool) => UPSTREAM_DEFAULTS[tool as UpstreamToolName],
        });

    const now = new Date().toISOString();
    const info: SessionInfo = {
      sessionId: spec.sessionId,
      project: spec.project,
      env: spec.env ?? resolved.env.name,
      role: spec.role,
      browser: (spec.browser ?? 'chromium') as BrowserName,
      headed: Boolean(spec.headed),
      outputDir: launch.outputDir,
      openedAt: now,
      lastUsed: now,
      server: `${driver.info().server} ${driver.info().version}`,
    };
    const entry: Entry = { driver, info };
    this.sessions.set(spec.sessionId, entry);
    this.touch(spec.sessionId);
    return info;
  }

  /** The session for a call, opening a default one from the connection's project when needed. */
  async ensure(id: string, fallback: Omit<BrowserSessionSpec, 'sessionId'>): Promise<Entry> {
    const existing = this.sessions.get(id);
    if (existing) {
      this.touch(id);
      return existing;
    }
    await this.open({ ...fallback, sessionId: id });
    return this.sessions.get(id)!;
  }

  get(id: string): Entry | undefined {
    const e = this.sessions.get(id);
    if (e) this.touch(id);
    return e;
  }

  async close(id: string): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.sessions.delete(id);
    await entry.driver.close();
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }

  private touch(id: string) {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.info.lastUsed = new Date().toISOString();
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.close(id), this.idleMs);
    // A pending reap must never hold the process open.
    entry.timer.unref?.();
  }

  /**
   * Config comes through the CLI, like every other SDODS MCP tool, rather than by importing
   * @sdods/core — so a browser session sees exactly what `sdods config show` would print.
   */
  private async resolve(project: string, env?: string): Promise<ResolvedForBrowser> {
    if (this.opts.resolveConfig) return this.opts.resolveConfig(project, env);
    const args = ['config', 'show', '-p', project];
    if (env) args.push('-e', env);
    const r = await sdodsCli<ResolvedForBrowser>(args, { cwd: this.opts.rootDir });
    return r.json;
  }

  private async storageStateFor(
    project: string,
    env: string | undefined,
    role: string,
  ): Promise<string> {
    const args = ['auth', 'list', '-p', project];
    if (env) args.push('-e', env);
    const rows = (await sdodsCli<Array<Record<string, unknown>>>(args, { cwd: this.opts.rootDir }))
      .json;
    const hit = (Array.isArray(rows) ? rows : []).find(
      (r) => String(r.role ?? r.user) === role && String(r.fresh ?? 'yes') !== 'no',
    );
    const file = hit?.file ? String(hit.file) : undefined;
    if (!file) {
      // Capturing would drive a real login flow, which is not something a read of "open a browser
      // as this role" should trigger on its own.
      throw Object.assign(new Error(`No fresh login state for role "${role}".`), {
        error: {
          code: 'BROWSER_NO_AUTH_STATE',
          hint: `Run \`sdods auth capture -p ${project}${env ? ` -e ${env}` : ''} -u ${role}\` first.`,
        },
      });
    }
    return file;
  }
}
