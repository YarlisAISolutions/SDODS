/**
 * SDODS desktop — application lifecycle.
 *
 * The flow, in one place:
 *   already installed?  -> start server -> sign in -> load the dashboard      ("just open it")
 *   not installed?      -> show progress -> bootstrap -> as above             (one click)
 *
 * The window shows a local bootstrap page first and only navigates to the served SPA once the
 * server is healthy and a session cookie is in the jar. The product UI is the Fastify-served app;
 * the renderer here covers only the states that exist before that server does.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appDataDir,
  defaultWorkspace,
  isBootstrapped,
  readConfig,
  writeConfig,
  type DesktopConfig,
} from './paths.js';
import { killTree } from './runtime.js';
import { bootstrap, BootstrapError, generateSessionSecret } from './bootstrap.js';
import { percentFor, type Progress } from '../shared/stages.js';
import { startServer, ServerStartError, type ServerHandle } from './server.js';
import { authenticate, loadCredentials } from './auth.js';
import { buildMenu } from './menu.js';
import { log } from './log.js';
import { ensureChromium, chromiumPresent, type BrowserState } from './browsers.js';
import { createUpdater, SERVER_STOP_TIMEOUT_MS, type UpdateController } from './updater.js';

// Keep the userData path free of spaces and out of the roaming profile's way. Must run before
// `app.whenReady()`, because Electron resolves userData on first access.
app.setName('SDODS');

let win: BrowserWindow | null = null;
let server: ServerHandle | null = null;
let starting = false;
let updates: UpdateController | null = null;

/**
 * Teardown that does not depend on the app being asked politely.
 *
 * Measured: a SIGTERM to the packaged app does NOT run `before-quit`, `will-quit`, `exit`, or even
 * an explicit `process.on('SIGTERM')` handler -- Electron terminates natively and none of them
 * fire. So the server child, which is spawned detached in its own process group, can outlive the
 * app that owns it. Two servers on one SQLite file with two schedulers firing the same crons is a
 * genuinely bad state.
 *
 * Recording the *child's* pid makes the next launch able to clean up regardless of how the last
 * one died. The graceful paths above still run when they can; this is the floor, not the plan.
 */
function pidfilePath(): string {
  return join(appDataDir(), 'server.pid');
}

function writePidfile(pid: number | undefined, port: number) {
  if (!pid) return;
  try {
    writeFileSync(pidfilePath(), JSON.stringify({ pid, port }), { mode: 0o600 });
  } catch {
    /* a missing pidfile only costs us the orphan check */
  }
}

function clearPidfile() {
  try {
    rmSync(pidfilePath(), { force: true });
  } catch {
    /* nothing to clear */
  }
}

/** Kill a server left behind by a previous crash, so its port and database are free. */
function reapOrphanServer() {
  let record: { pid?: number } | null;
  try {
    record = JSON.parse(readFileSync(pidfilePath(), 'utf8')) as { pid?: number };
  } catch {
    return;
  }
  if (!record?.pid || record.pid === process.pid) return clearPidfile();
  try {
    process.kill(record.pid, 0); // probe only
    log.warn('found a server from a previous session (pid', String(record.pid), '), stopping it');
    killTree(record.pid);
  } catch {
    /* already gone */
  }
  clearPidfile();
}

function loadOrCreateConfig(): DesktopConfig {
  const existing = readConfig();
  if (existing) return existing;
  const fresh: DesktopConfig = {
    workspace: defaultWorkspace(),
    port: 4444,
    sessionSecret: generateSessionSecret(),
    bootstrapped: false,
  };
  writeConfig(fresh);
  return fresh;
}

/** The two failure types carry their captured child output under different names. */
function errorDetail(err: unknown): string {
  if (err instanceof BootstrapError) return err.detail;
  if (err instanceof ServerStartError) return err.output;
  return '';
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

let browserInstall: Promise<BrowserState> | null = null;

/**
 * Download the Chromium test browser, one download at a time.
 *
 * The outcome is reported with a native dialog: the dashboard is the served web app with no
 * preload, so it never hears `browsers:state`, and a download that failed silently left every run
 * failing with Playwright's "Executable doesn't exist". Runs also install what they are missing on
 * their own, so a failure here is not the end of it, only the earliest chance to say so.
 */
function installTestBrowsers(
  workspace: string,
  opts: { force?: boolean; interactive?: boolean } = {},
): Promise<BrowserState> {
  if (browserInstall) return browserInstall;
  browserInstall = ensureChromium({
    workspace,
    force: opts.force,
    onProgress: (line) => send('browsers:progress', line),
  })
    .then(async (state) => {
      log.info('browsers:', state);
      send('browsers:state', state);
      if (state === 'failed') {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          message: 'The Chromium test browser could not be downloaded',
          detail:
            'Test runs will try to download it again on their own. If it keeps failing, check the ' +
            'network or proxy (HTTPS_PROXY) and whether antivirus quarantined the download. ' +
            'Details are in SDODS → Open Logs Folder.',
          buttons: ['Retry now', 'Close'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) {
          browserInstall = null;
          return installTestBrowsers(workspace, { interactive: true });
        }
      } else if (opts.interactive) {
        void dialog.showMessageBox({
          type: 'info',
          message: 'The Chromium test browser is ready.',
        });
      }
      return state;
    })
    .finally(() => {
      browserInstall = null;
    });
  return browserInstall;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'SDODS',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.once('ready-to-show', () => window.show());

  // Anything that is not our own server opens in the real browser, not inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}

/** Load the local bootstrap/progress page. */
async function showBootstrapUI(window: BrowserWindow) {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

/**
 * The whole startup sequence. Safe to call again after a failure — the renderer's Retry button
 * does exactly that.
 */
async function startup(config: DesktopConfig) {
  if (starting) return;
  starting = true;
  log.info('startup: workspace=', config.workspace, 'port=', String(config.port));
  try {
    /** Report a step in the final stage, which lives here rather than in bootstrap.ts. */
    const launching = (step: string, fraction: number, message: string) =>
      send('bootstrap:progress', {
        stage: 'launch',
        step,
        percent: percentFor('launch', fraction),
        message,
      } satisfies Progress);

    if (!isBootstrapped(config.workspace)) {
      log.info('bootstrap: workspace is not installed, running first-run install');
      // The UI wants every tick; the log wants one line per step. Fetching ~640 packages emits a
      // progress event per package, and logging each would bury the four lines that matter.
      let lastLogged = '';
      await bootstrap({
        workspace: config.workspace,
        onProgress: (p) => {
          const key = `${p.stage}/${p.step}`;
          if (p.message && key !== lastLogged) {
            lastLogged = key;
            log.info(`bootstrap: ${p.percent}% ${key} ${p.message}`);
          }
          send('bootstrap:progress', p);
        },
      });
      log.info('bootstrap: complete');
      config.bootstrapped = true;
      writeConfig(config);
    }

    launching('secret', 0.1, 'Generating a session key…');
    launching('serve', 0.25, 'Starting the local server…');

    server = await startServer({
      workspace: config.workspace,
      sessionSecret: config.sessionSecret,
      port: config.port,
      onLog: (line) => {
        send('server:log', line);
        launching('health', 0.6, 'Waiting for the server to answer…');
      },
    });

    // Remember the port so the URL stays stable for .mcp.json clients and bookmarks.
    if (server.port !== config.port) {
      config.port = server.port;
      writeConfig(config);
    }
    writePidfile(server.pid, server.port);

    log.info('server: ready at', server.url, server.setupToken ? '(first run)' : '');
    launching('account', 0.85, server.setupToken ? 'Creating your account…' : 'Signing you in…');
    await authenticate(server.url, server.setupToken);
    log.info('auth: session established');
    launching('account', 1, 'Ready.');
    buildMenu({
      workspace: config.workspace,
      serverUrl: server.url,
      credentials: () => loadCredentials(),
      updates: updates ?? undefined,
      reinstallBrowsers: () =>
        void installTestBrowsers(config.workspace, { force: true, interactive: true }),
    });
    await win?.loadURL(server.url);
    log.info('window: loaded the dashboard');

    // After the server is healthy, never before: a first launch is busy installing, and an update
    // prompt that restarts the app mid-bootstrap would only make it start over.
    updates?.start();

    // Only now, with the dashboard on screen, fetch the browser engine. SDODS launches a browser
    // for every layer -- api runs included -- so nothing can run until this lands; doing it before
    // the window loaded would just make first launch feel broken for several minutes.
    if (!chromiumPresent(config.workspace)) void installTestBrowsers(config.workspace);
  } catch (err) {
    log.error('startup failed:', err);
    send('bootstrap:error', {
      message: err instanceof Error ? err.message : String(err),
      detail: errorDetail(err),
    });
  } finally {
    starting = false;
  }
}

// One instance only: two supervisors would mean two servers writing one SQLite file and two
// schedulers firing the same crons.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    const config = loadOrCreateConfig();
    reapOrphanServer();

    updates = createUpdater({
      stopServer: stopServerAndWait,
      autoCheck: () => config.autoUpdate !== false,
      setAutoCheck: (on) => {
        config.autoUpdate = on;
        writeConfig(config);
      },
    });

    ipcMain.handle('bootstrap:retry', () => startup(config));
    ipcMain.handle('app:info', () => ({
      workspace: config.workspace,
      version: app.getVersion(),
      platform: `${process.platform}-${process.arch}`,
    }));

    win = createWindow();
    await showBootstrapUI(win);
    void startup(config);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        win = createWindow();
        void showBootstrapUI(win).then(() => startup(config));
      }
    });
  });
}

/** Stop the server tree whenever the app goes away, however it goes away. */
function shutdown() {
  updates?.dispose();
  if (!server) return;
  void server.stop();
  server = null;
  clearPidfile();
}

/**
 * The same teardown, for a caller that can wait for it: restarting into an update. The installer
 * replaces the directory the server's node binary runs from (on Windows a running .exe cannot be
 * overwritten), and a relaunched app would otherwise find port 4444 still held and move to another.
 * If the child outlives the timeout the pidfile stays, so the relaunch reaps it like any orphan.
 */
async function stopServerAndWait() {
  const running = server;
  server = null;
  if (!running) return;
  if (await running.stop(SERVER_STOP_TIMEOUT_MS)) {
    clearPidfile();
    log.info('server: stopped');
  } else {
    log.warn(
      'server: still running after',
      String(SERVER_STOP_TIMEOUT_MS),
      'ms, leaving the pidfile',
    );
  }
}
app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.on('exit', shutdown);

// Best-effort signal handling. It does fire under `electron-vite dev` and for SIGINT from a
// terminal, where it stops the server promptly. It does NOT fire in the packaged app -- measured:
// a SIGTERM there runs none of before-quit, will-quit, exit, or this handler. So this is a
// convenience for development, not the guarantee; the pidfile above is the guarantee.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    log.info(`received ${signal}, stopping the server`);
    shutdown();
    app.exit(0);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  log.error('uncaught:', err);
  shutdown();
  dialog.showErrorBox('SDODS', err.stack ?? String(err));
});

process.on('unhandledRejection', (reason) => {
  // Startup runs inside `void app.whenReady().then(...)`, so without this an early failure would
  // vanish exactly the way the first supervisor run did.
  log.error('unhandled rejection:', reason);
});
