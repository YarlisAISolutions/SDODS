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
import { join } from 'node:path';
import {
  defaultWorkspace,
  isBootstrapped,
  readConfig,
  writeConfig,
  type DesktopConfig,
} from './paths.js';
import { bootstrap, BootstrapError, generateSessionSecret, type Progress } from './bootstrap.js';
import { startServer, ServerStartError, type ServerHandle } from './server.js';
import { authenticate, loadCredentials } from './auth.js';
import { buildMenu } from './menu.js';
import { log } from './log.js';
import { ensureChromium, chromiumPresent } from './browsers.js';

// Keep the userData path free of spaces and out of the roaming profile's way. Must run before
// `app.whenReady()`, because Electron resolves userData on first access.
app.setName('SDODS');

let win: BrowserWindow | null = null;
let server: ServerHandle | null = null;
let starting = false;

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
    if (!isBootstrapped(config.workspace)) {
      send('bootstrap:progress', {
        phase: 'checking',
        message: 'Setting up SDODS for the first time…',
      } satisfies Progress);
      log.info('bootstrap: workspace is not installed, running first-run install');
      await bootstrap({
        workspace: config.workspace,
        onProgress: (p) => {
          if (p.message) log.info('bootstrap:', p.phase, p.message);
          send('bootstrap:progress', p);
        },
      });
      log.info('bootstrap: complete');
      config.bootstrapped = true;
      writeConfig(config);
    }

    send('bootstrap:progress', {
      phase: 'done',
      message: 'Starting the SDODS server…',
    } satisfies Progress);

    server = await startServer({
      workspace: config.workspace,
      sessionSecret: config.sessionSecret,
      port: config.port,
      onLog: (line) => send('server:log', line),
    });

    // Remember the port so the URL stays stable for .mcp.json clients and bookmarks.
    if (server.port !== config.port) {
      config.port = server.port;
      writeConfig(config);
    }

    log.info('server: ready at', server.url, server.setupToken ? '(first run)' : '');
    await authenticate(server.url, server.setupToken);
    log.info('auth: session established');
    buildMenu({
      workspace: config.workspace,
      serverUrl: server.url,
      credentials: () => loadCredentials(),
    });
    await win?.loadURL(server.url);
    log.info('window: loaded the dashboard');

    // Only now, with the dashboard on screen, fetch the browser engine. SDODS launches a browser
    // for every layer -- api runs included -- so nothing can run until this lands; doing it before
    // the window loaded would just make first launch feel broken for several minutes.
    if (!chromiumPresent()) {
      void ensureChromium({
        workspace: config.workspace,
        onProgress: (line) => send('browsers:progress', line),
      }).then((state) => {
        log.info('browsers:', state);
        send('browsers:state', state);
      });
    }
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
  server?.stop();
  server = null;
}
app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.on('exit', shutdown);

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
