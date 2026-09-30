/**
 * The bundled Node runtime, and the environment every child process inherits.
 *
 * The SDODS server runs as a **child process under a real Node binary**, never in-process under
 * Electron. Two reasons, both load-bearing:
 *
 *   1. `packages/server/src/services/cli.ts` builds every child argv as
 *      `{ cmd: process.execPath, args: [bin, ...] }`. In-process under Electron, `process.execPath`
 *      is the Electron binary, so every test run started from the web UI would relaunch the desktop
 *      app instead of running a test. Under a child Node it is correct for free.
 *   2. Native modules (better-sqlite3, and argon2 where it has a prebuild) are built for Node's
 *      ABI, not Electron's. As a child of a real Node they load as shipped, with no
 *      electron-rebuild step per platform × arch. `ELECTRON_RUN_AS_NODE` does not help here — the
 *      ABI is still Electron's.
 */
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { browsersDir } from './paths.js';

/** The node executable inside a runtime root, whichever layout the platform uses. */
const exeIn = (root: string) =>
  process.platform === 'win32' ? join(root, 'node.exe') : join(root, 'bin', 'node');

/**
 * Root of the bundled Node distribution.
 *
 * The layout differs between packaged and development, which is a real trap: electron-builder maps
 * `resources/node/<platform>-<arch>` to `Resources/node`, so in a packaged app that directory *is*
 * the runtime root. In the source tree it is the parent of every staged per-arch runtime, and
 * treating it as a root yields `resources/node/bin/node`, which does not exist.
 *
 * Both branches confirm the executable is actually there rather than trusting the directory.
 */
function runtimeRoot(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'node')]
    : [
        join(app.getAppPath(), 'resources', 'node', `${process.platform}-${process.arch}`),
        join(app.getAppPath(), 'resources', 'node'),
      ];
  return candidates.find((root) => existsSync(exeIn(root))) ?? null;
}

/** Look for a real `node` on PATH. Dev machines have one; packaged installs must not rely on it. */
function systemNode(): string | null {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Absolute path to the `node` binary the app drives.
 *
 * Never `process.execPath`: under Electron that is the Electron binary, and spawning it launches
 * a second copy of this app rather than running a script. (`ELECTRON_RUN_AS_NODE` would fix the
 * spawn but not the ABI — the server's child would then load better-sqlite3 against Electron's
 * ABI and fail.) So: the staged runtime when packaged, a real system node in development.
 */
export function nodeBin(): string {
  const override = process.env.SDODS_DESKTOP_NODE;
  if (override && existsSync(override)) return override;

  const root = runtimeRoot();
  if (root) return exeIn(root);

  const system = systemNode();
  if (system) return system;

  throw new Error(
    'No Node runtime found. A packaged build stages one into resources/node; in development, ' +
      'install Node 22+ or set SDODS_DESKTOP_NODE to a node binary.',
  );
}

/**
 * npm's own entry point. Never spawn `npm` by bare name: Windows ships `npm.cmd` rather than an
 * `npm` executable, and a GUI app launched from Finder or the Dock inherits a minimal PATH with no
 * Node on it at all.
 */
export function npmCli(): string {
  const node = nodeBin();
  const root = runtimeRoot();
  const candidates = [
    // Staged runtime, posix and windows layouts.
    ...(root
      ? [
          join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        ]
      : []),
    // npm shipped beside whichever node we resolved.
    join(dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`Could not locate npm next to ${node}.`);
  return found;
}

/** Directory holding node/npm, prepended to PATH so `npx` resolves inside child processes. */
function binDir(): string {
  const root = runtimeRoot();
  if (root) return process.platform === 'win32' ? root : join(root, 'bin');
  return dirname(nodeBin());
}

export interface ChildEnvOptions {
  workspace: string;
  sessionSecret?: string;
  port?: number;
  /** Merged last, so a caller can pin behaviour for one specific child. */
  extraEnv?: NodeJS.ProcessEnv;
}

/**
 * The environment for `sdods` child processes.
 *
 * PATH matters more than it looks: `packages/cli/src/commands/run.ts` spawns `npx bddgen` and
 * `npx playwright test`, so npx must resolve even when the app was launched from the Dock.
 */
export function buildChildEnv(opts: ChildEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [binDir(), process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    // Anchor the server's rootDir explicitly. Without it, findRepoRoot() walks up from cwd and
    // could latch onto an unrelated ancestor directory before `init` has written a workspace file.
    SDODS_ROOT: opts.workspace,
    // App-owned browser cache, so runs do not depend on (or pollute) the user's global one.
    PLAYWRIGHT_BROWSERS_PATH: browsersDir(),
    // Runs download any engine they need that is missing, with progress in the run log, rather
    // than failing with Playwright's "run npx playwright install" (which, run by hand, installs a
    // different revision into a different folder). See ensureBrowsers in the CLI's browsers.ts.
    SDODS_AUTO_INSTALL_BROWSERS: '1',
  };
  if (opts.sessionSecret) env.SESSION_SECRET = opts.sessionSecret;
  if (opts.port) env.PORT = String(opts.port);
  // Electron sets this for its own child processes; leaking it into a plain Node child makes Node
  // behave as Electron-in-node-mode and changes module resolution.
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, ...opts.extraEnv };
}

/** Windows needs the whole tree: `child.kill()` leaves npx/playwright/chromium grandchildren. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // Detached so a slow taskkill cannot block app quit.
    void import('node:child_process').then(({ spawn }) => {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { detached: true, stdio: 'ignore' })
        .on('error', () => undefined)
        .unref();
    });
    return;
  }
  try {
    // Negative pid targets the process group, which requires the child to have been spawned
    // detached. Falls back to the single pid if it was not.
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
