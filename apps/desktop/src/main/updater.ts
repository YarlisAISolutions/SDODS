/**
 * Desktop self-update, from the `latest*.yml` feeds every `desktop-v*` release publishes to the
 * public siri1410/sdods-releases repository (`publish:` in electron-builder.yml names it, and
 * electron-builder copies that into the packaged `Resources/app-update.yml`).
 *
 * What it does:
 *   - checks once the server is healthy, then every six hours, unless the user turned that off;
 *   - downloads in the background, then ASKS: "SDODS <version> is ready — Restart to update".
 *     Nothing restarts on its own, and nothing installs on an ordinary quit either
 *     (`autoInstallOnAppQuit` is off) -- the only way in is `restartToUpdate`, which stops the
 *     server first;
 *   - "Check for Updates…" in the menu does the same on demand and says what it found.
 *
 * Where it stays dormant, and why -- `updateGate` is the single place that decides:
 *   - development (`app.isPackaged` false) and `SDODS_DESKTOP_NO_UPDATE=1`;
 *   - macOS builds that are not Developer ID signed: Squirrel.Mac refuses to install into them, so
 *     a check would only download a 150 MB zip to fail on;
 *   - Linux without `$APPIMAGE`, i.e. the .deb. apt owns that install; electron-updater would pick
 *     its DebUpdater and run `dpkg -i` behind the package manager's back;
 *   - Windows installs under a Scoop `apps` directory, which `scoop update` owns the same way.
 *
 * electron-updater is bundled into out/main by rollup (see electron.vite.config.ts): apps/desktop
 * declares no production dependencies, so it must never be loaded from node_modules.
 */
import { app, dialog } from 'electron';
import { AppImageUpdater, autoUpdater, type AppUpdater, type UpdateInfo } from 'electron-updater';
import { log } from './log.js';

/** How often a running app looks again. Releases are days apart; this only bounds the lag. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** How long a restart waits for `sdods serve` to exit before installing anyway. */
export const SERVER_STOP_TIMEOUT_MS = 10_000;

export type UpdateGate = { active: true } | { active: false; reason: string };

export interface GateInput {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** Build-time: this build is Developer ID signed (`__DESKTOP_SIGNED__`). */
  signed: boolean;
  env: Record<string, string | undefined>;
  /** Absolute path of the running executable, `app.getPath('exe')`. */
  exePath: string;
}

/** Decide whether this install may update itself, and if not, what to tell the user instead. */
export function updateGate(input: GateInput): UpdateGate {
  const off = (reason: string): UpdateGate => ({ active: false, reason });

  if (input.env.SDODS_DESKTOP_NO_UPDATE === '1') {
    return off('Update checks are turned off by SDODS_DESKTOP_NO_UPDATE=1.');
  }
  if (!input.isPackaged) {
    return off('Update checks are off in a development build.');
  }
  switch (input.platform) {
    case 'darwin':
      return input.signed
        ? { active: true }
        : off(
            'This build of SDODS is not code-signed, and macOS only installs updates into a signed app. ' +
              'Download new versions from https://sdods.com/download.',
          );
    case 'linux':
      // The AppImage runtime exports APPIMAGE; nothing else does. A .deb install is apt's to update.
      return input.env.APPIMAGE
        ? { active: true }
        : off(
            'This copy of SDODS was installed from a package, so your package manager keeps it current: ' +
              'sudo apt update && sudo apt upgrade',
          );
    case 'win32':
      return /[\\/]scoop[\\/]apps[\\/]/i.test(input.exePath)
        ? off('This copy of SDODS is managed by Scoop. Update it with: scoop update sdods')
        : { active: true };
    default:
      return off(`Updates are not published for ${input.platform}.`);
  }
}

/** The gate for the running app. */
export function currentGate(): UpdateGate {
  return updateGate({
    platform: process.platform,
    isPackaged: app.isPackaged,
    signed: typeof __DESKTOP_SIGNED__ !== 'undefined' && __DESKTOP_SIGNED__,
    env: process.env,
    exePath: app.getPath('exe'),
  });
}

export interface UpdaterDeps {
  /**
   * Stop the `sdods serve` child and resolve once it has exited (or given up). This is the app's
   * own shutdown path, so the pidfile is handled the same way as on any other quit.
   */
  stopServer: () => Promise<void>;
  /** The persisted "check automatically" setting. */
  autoCheck: () => boolean;
  setAutoCheck: (on: boolean) => void;
}

export interface UpdaterOptions {
  /** Defaults to `currentGate()`. */
  gate?: UpdateGate;
  /** Defaults to `platformUpdater`, which is only called once the gate is open. */
  updater?: () => AppUpdater;
}

/**
 * electron-updater's own pick, except on Linux. Its singleton chooses DebUpdater whenever
 * `resources/package-type` exists, and electron-builder writes that file for the deb target into
 * `linux-unpacked` -- the same directory the x64 AppImage is squashed from. The gate has already
 * established this is an AppImage, so say so rather than trust a file that can leak across targets.
 */
export function platformUpdater(): AppUpdater {
  return process.platform === 'linux' ? new AppImageUpdater() : autoUpdater;
}

export interface UpdateController {
  readonly gate: UpdateGate;
  /** First automatic check and the six-hourly timer. Idempotent. */
  start: () => void;
  /** The menu's "Check for Updates…": always answers, one way or another. */
  checkNow: () => Promise<void>;
  autoCheck: () => boolean;
  setAutoCheck: (on: boolean) => void;
  /** Stop the server, then quit and install the downloaded update. */
  restartToUpdate: () => Promise<void>;
  dispose: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One line per file, so the log records exactly which bytes the update was pinned to. */
function describe(info: UpdateInfo): string {
  return info.files.map((f) => `${f.url} sha512=${f.sha512}`).join(', ');
}

export function createUpdater(deps: UpdaterDeps, options: UpdaterOptions = {}): UpdateController {
  const gate = options.gate ?? currentGate();
  const resolveUpdater = options.updater ?? platformUpdater;

  let instance: AppUpdater | null = null;
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  /** A "ready" dialog is on screen; don't stack another. */
  let prompting = false;
  /** Version the user was already asked about, so a six-hourly re-check does not nag. */
  let promptedVersion: string | null = null;

  function updater(): AppUpdater {
    if (instance) return instance;
    const u = resolveUpdater();
    u.logger = {
      info: (m: unknown) => log.info('update:', String(m)),
      warn: (m: unknown) => log.warn('update:', String(m)),
      error: (m: unknown) => log.error('update:', String(m)),
    };
    u.autoDownload = true;
    // Installing on an ordinary quit would bypass restartToUpdate, and with it the wait for the
    // server child: on Windows its node.exe lives inside the install directory being replaced.
    u.autoInstallOnAppQuit = false;
    u.on('update-available', (info: UpdateInfo) =>
      log.info(`update: ${info.version} is available, downloading:`, describe(info)),
    );
    u.on('update-not-available', (info: UpdateInfo) =>
      log.info(`update: up to date (running ${app.getVersion()}, latest ${info.version})`),
    );
    u.on('update-downloaded', (info: UpdateInfo) => void promptRestart(info, false));
    u.on('error', (err: Error) => log.error('update: failed:', message(err)));
    instance = u;
    return u;
  }

  async function promptRestart(info: UpdateInfo, force: boolean) {
    if (prompting || (!force && promptedVersion === info.version)) return;
    prompting = true;
    promptedVersion = info.version;
    log.info(`update: ${info.version} downloaded, asking to restart`);
    try {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        message: `SDODS ${info.version} is ready — Restart to update`,
        detail: `You are running ${app.getVersion()}. Restarting stops the local server for a moment; your workspace and results are untouched.`,
        buttons: ['Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await restartToUpdate();
      else log.info('update: restart postponed');
    } finally {
      prompting = false;
    }
  }

  /** Background check: logs, never dialogs, except the "ready" prompt once a download lands. */
  async function automaticCheck() {
    if (!deps.autoCheck()) return;
    try {
      const result = await updater().checkForUpdates();
      // The download's own failure is reported through the 'error' event.
      result?.downloadPromise?.catch(() => undefined);
    } catch {
      /* already logged by the 'error' listener */
    }
  }

  async function checkNow() {
    if (!gate.active) {
      log.info('update: manual check, but updates are dormant:', gate.reason);
      await dialog.showMessageBox({
        type: 'info',
        message: 'Automatic updates are not available for this copy of SDODS',
        detail: gate.reason,
      });
      return;
    }
    log.info('update: manual check');
    try {
      const result = await updater().checkForUpdates();
      if (!result?.isUpdateAvailable) {
        await dialog.showMessageBox({
          type: 'info',
          message: 'SDODS is up to date',
          detail: `You are running ${app.getVersion()}, the latest release.`,
        });
        return;
      }
      const { version } = result.updateInfo;
      void dialog.showMessageBox({
        type: 'info',
        message: `SDODS ${version} is available`,
        detail:
          'It is downloading in the background. You will be asked to restart when it is ready.',
      });
      await result.downloadPromise;
      // Asked on a manual check even if "Later" was chosen for this version before.
      await promptRestart(result.updateInfo, true);
    } catch (err) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Could not check for updates',
        detail: `${message(err)}\n\nThe desktop log has the details (SDODS ▸ Open Logs Folder).`,
      });
    }
  }

  async function restartToUpdate() {
    log.info('update: stopping the server before installing');
    try {
      await deps.stopServer();
    } catch (err) {
      // Install regardless: the pidfile is still on disk, and the next launch reaps what is left.
      log.warn('update: server did not stop cleanly:', message(err));
    }
    log.info('update: quitting to install');
    // Silent on Windows (no installer wizard for an update the user already accepted), and
    // relaunch afterwards on every platform.
    updater().quitAndInstall(true, true);
  }

  function start() {
    if (started) return;
    started = true;
    if (!gate.active) {
      log.info('update: dormant:', gate.reason);
      return;
    }
    if (!deps.autoCheck()) log.info('update: automatic checks are off in the menu');
    void automaticCheck();
    timer = setInterval(() => void automaticCheck(), CHECK_INTERVAL_MS);
    timer.unref();
  }

  return {
    gate,
    start,
    checkNow,
    autoCheck: () => deps.autoCheck(),
    setAutoCheck: (on) => {
      deps.setAutoCheck(on);
      log.info(`update: automatic checks ${on ? 'on' : 'off'}`);
      if (on && started && gate.active) void automaticCheck();
    },
    restartToUpdate,
    dispose: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
