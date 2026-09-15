import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.1.1',
    getPath: () => '/Applications/SDODS.app/Contents/MacOS/SDODS',
  },
  dialog: { showMessageBox: vi.fn() },
}));

vi.mock('electron', () => electron);
// The real module would construct a platform updater against the real `electron` package.
vi.mock('electron-updater', () => ({ autoUpdater: {}, AppImageUpdater: class {} }));
vi.mock('../src/main/log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), file: () => '' },
}));

const { createUpdater, updateGate, CHECK_INTERVAL_MS } = await import('../src/main/updater.js');
type Deps = Parameters<typeof createUpdater>[0];

const packaged = {
  platform: 'win32' as NodeJS.Platform,
  isPackaged: true,
  signed: false,
  env: {},
  exePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\SDODS\\SDODS.exe',
};

describe('updateGate', () => {
  it('is dormant in development', () => {
    expect(updateGate({ ...packaged, isPackaged: false })).toMatchObject({ active: false });
  });

  it('is dormant when SDODS_DESKTOP_NO_UPDATE=1, even in a signed packaged build', () => {
    const gate = updateGate({
      ...packaged,
      platform: 'darwin',
      signed: true,
      env: { SDODS_DESKTOP_NO_UPDATE: '1' },
    });
    expect(gate).toMatchObject({ active: false });
    expect(gate.active || gate.reason).toMatch(/SDODS_DESKTOP_NO_UPDATE/);
  });

  it('only runs on macOS when the build is signed', () => {
    const unsigned = updateGate({ ...packaged, platform: 'darwin', signed: false });
    expect(unsigned).toMatchObject({ active: false });
    expect(unsigned.active || unsigned.reason).toMatch(/not code-signed/);
    expect(updateGate({ ...packaged, platform: 'darwin', signed: true })).toEqual({ active: true });
  });

  it('runs for the Linux AppImage and leaves the .deb to apt', () => {
    expect(
      updateGate({ ...packaged, platform: 'linux', env: { APPIMAGE: '/opt/SDODS.AppImage' } }),
    ).toEqual({ active: true });
    const deb = updateGate({ ...packaged, platform: 'linux', env: {} });
    expect(deb).toMatchObject({ active: false });
    expect(deb.active || deb.reason).toMatch(/apt/);
  });

  it('runs for the Windows installer unsigned, but not under Scoop', () => {
    expect(updateGate(packaged)).toEqual({ active: true });
    expect(
      updateGate({ ...packaged, exePath: 'C:\\Users\\me\\scoop\\apps\\sdods\\0.1.1\\SDODS.exe' }),
    ).toMatchObject({ active: false });
  });

  it('has nothing to offer other platforms', () => {
    expect(updateGate({ ...packaged, platform: 'freebsd' })).toMatchObject({ active: false });
  });
});

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  logger: unknown = null;
  checkForUpdates = vi.fn();
  quitAndInstall = vi.fn();
}

const info = (version: string) => ({
  version,
  files: [{ url: `SDODS-${version}-mac-arm64.zip`, sha512: 'abc', size: 1 }],
  path: '',
  sha512: 'abc',
  releaseDate: '2026-09-01T00:00:00.000Z',
});

function setup(opts: { active?: boolean; autoCheck?: boolean } = {}) {
  const fake = new FakeUpdater();
  let auto = opts.autoCheck ?? true;
  const deps: Deps = {
    stopServer: vi.fn(async () => undefined),
    autoCheck: () => auto,
    setAutoCheck: vi.fn((on: boolean) => {
      auto = on;
    }),
  };
  const resolve = vi.fn(() => fake as never);
  const controller = createUpdater(deps, {
    gate:
      opts.active === false ? { active: false, reason: 'dormant for a test' } : { active: true },
    updater: resolve,
  });
  return { fake, deps, resolve, controller };
}

/** Let pending promise callbacks run. */
const flush = () => new Promise((r) => setImmediate(r));

describe('createUpdater', () => {
  beforeEach(() => {
    electron.dialog.showMessageBox.mockReset();
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1 });
  });
  afterEach(() => vi.useRealTimers());

  it('stays dormant: no updater is created and a manual check explains why', async () => {
    const { controller, resolve } = setup({ active: false });
    controller.start();
    await controller.checkNow();
    expect(resolve).not.toHaveBeenCalled();
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'dormant for a test' }),
    );
  });

  it('checks on start and every six hours, downloading but never installing on quit', async () => {
    vi.useFakeTimers();
    const { controller, fake } = setup();
    fake.checkForUpdates.mockResolvedValue(null);
    controller.start();
    controller.start(); // idempotent
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('respects the automatic-check setting, and turning it back on checks straight away', async () => {
    vi.useFakeTimers();
    const { controller, fake, deps } = setup({ autoCheck: false });
    fake.checkForUpdates.mockResolvedValue(null);
    controller.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    controller.setAutoCheck(true);
    expect(deps.setAutoCheck).toHaveBeenCalledWith(true);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('asks before restarting, and "Later" installs nothing', async () => {
    const { controller, fake, deps } = setup();
    fake.checkForUpdates.mockResolvedValue(null);
    controller.start();
    fake.emit('update-downloaded', info('0.1.2'));
    await flush();
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'SDODS 0.1.2 is ready — Restart to update',
        buttons: ['Restart', 'Later'],
      }),
    );
    expect(deps.stopServer).not.toHaveBeenCalled();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    // A later background check finding the same download does not ask again.
    fake.emit('update-downloaded', info('0.1.2'));
    await flush();
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('"Restart" stops the server and waits for it before quitting to install', async () => {
    const order: string[] = [];
    const { controller, fake, deps } = setup();
    let serverStopped!: () => void;
    deps.stopServer = vi.fn(
      () =>
        new Promise<void>((r) => {
          order.push('stopServer');
          serverStopped = r;
        }),
    );
    fake.quitAndInstall.mockImplementation(() => order.push('quitAndInstall'));
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });

    fake.checkForUpdates.mockResolvedValue(null);
    controller.start();
    fake.emit('update-downloaded', info('0.1.2'));
    await flush();
    expect(order).toEqual(['stopServer']);
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    serverStopped();
    await flush();
    expect(order).toEqual(['stopServer', 'quitAndInstall']);
    expect(fake.quitAndInstall).toHaveBeenCalledWith(true, true);
    controller.dispose();
  });

  it('still installs when the server fails to stop; the pidfile reaper handles what is left', async () => {
    const { controller, fake, deps } = setup();
    deps.stopServer = vi.fn(async () => {
      throw new Error('taskkill failed');
    });
    await controller.restartToUpdate();
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('a manual check reports "up to date"', async () => {
    const { controller, fake } = setup();
    fake.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: info('0.1.1') });
    await controller.checkNow();
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'SDODS is up to date' }),
    );
  });

  it('a manual check reports errors', async () => {
    const { controller, fake } = setup();
    fake.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await controller.checkNow();
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        detail: expect.stringContaining('ERR_INTERNET_DISCONNECTED'),
      }),
    );
  });

  it('a manual check asks again about a version the user postponed', async () => {
    const { controller, fake } = setup();
    fake.checkForUpdates.mockResolvedValue(null);
    controller.start();
    fake.emit('update-downloaded', info('0.1.2'));
    await flush();
    electron.dialog.showMessageBox.mockClear();

    fake.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: info('0.1.2'),
      downloadPromise: Promise.resolve([]),
    });
    await controller.checkNow();
    const messages = electron.dialog.showMessageBox.mock.calls.map((c) => c[0].message);
    expect(messages).toEqual([
      'SDODS 0.1.2 is available',
      'SDODS 0.1.2 is ready — Restart to update',
    ]);
    controller.dispose();
  });
});
