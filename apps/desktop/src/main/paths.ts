/**
 * Where the desktop app puts things, and why.
 *
 * Two distinct locations, deliberately:
 *
 *   - The **workspace** is the user's. SDODS is a test-authoring product: people open
 *     `projects/*∕features/*.feature` in an editor and put the workspace under version control.
 *     Burying it in Application Support would be hostile, so it defaults to `~/SDODS` and the user
 *     can move it. Not `~/Documents/SDODS`: that path is TCC-protected on macOS (a permission
 *     prompt, and silent failure if denied) and swept up by OneDrive Known Folder Move on Windows.
 *
 *   - **App data** is ours: the Playwright browser cache, logs, and the desktop config. On Windows
 *     this must be LOCALAPPDATA, not the roaming APPDATA that `app.getPath('userData')` returns —
 *     roaming profiles sync to a file server at logout in AD environments, and we would be pushing
 *     a browser cache measured in hundreds of megabytes through it.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface DesktopConfig {
  /** Absolute path to the SDODS workspace this app manages. */
  workspace: string;
  /** Port the server binds. Persisted: `sdods mcp install` writes the URL into .mcp.json, and a
   *  new random port on every launch would break every external MCP client and any bookmark. */
  port: number;
  /** Per-install secret. The server otherwise signs session cookies with a shared literal. */
  sessionSecret: string;
  /** Set once the first-run bootstrap has completed end to end. */
  bootstrapped: boolean;
  /** Epoch ms of the last npm-registry upgrade check. */
  lastUpdateCheck?: number;
}

/** App-owned state. Local (non-roaming) on Windows. */
export function appDataDir(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) return join(local, 'SDODS');
  }
  return app.getPath('userData');
}

export const configPath = () => join(appDataDir(), 'config.json');
export const logsDir = () => join(appDataDir(), 'logs');
/** App-owned so we neither fight nor pollute the user's own ~/Library/Caches/ms-playwright. */
export const browsersDir = () => join(appDataDir(), 'browsers');

/**
 * Where a new install puts the workspace. `SDODS_DESKTOP_WORKSPACE` overrides it, which is how
 * the dev and CI runs avoid touching a real home directory.
 */
export const defaultWorkspace = () =>
  process.env.SDODS_DESKTOP_WORKSPACE ?? join(homedir(), 'SDODS');

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function readConfig(): DesktopConfig | null {
  const file = configPath();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DesktopConfig;
  } catch {
    // A truncated config (power loss mid-write) must not brick the app; treat it as absent and
    // let the caller re-derive defaults. The session secret is regenerated, which only costs the
    // user a re-login.
    return null;
  }
}

export function writeConfig(config: DesktopConfig): void {
  const file = configPath();
  ensureDir(dirname(file));
  // 0600: this file holds the session secret.
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

/** Paths inside a managed workspace. */
export const workspacePaths = (workspace: string) => ({
  root: workspace,
  packageJson: join(workspace, 'package.json'),
  runnerConfig: join(workspace, 'sdods.runner.config.ts'),
  cliBin: join(workspace, 'node_modules', '@sdods', 'cli', 'bin', 'sdods.js'),
  nodeModules: join(workspace, 'node_modules'),
  db: join(workspace, '.sdods', 'sdods.db'),
});

/** True when this workspace already has a usable SDODS install — the "just open it" fast path. */
export function isBootstrapped(workspace: string): boolean {
  const p = workspacePaths(workspace);
  return existsSync(p.cliBin) && existsSync(p.runnerConfig);
}

export { ensureDir };
