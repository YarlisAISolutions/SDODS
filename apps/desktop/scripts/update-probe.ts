/**
 * Update probe — prove the updater against the REAL release feed, with no Electron and nothing
 * installed.
 *
 * It bundles src/main/updater.ts together with electron-updater through Vite/Rollup, the way
 * electron-vite bundles out/main, with `electron` aliased to a small stub. So what runs is the
 * bundled electron-updater (the thing a packaged app has, with no node_modules) driving our own
 * gate, logging and check logic -- against the `app-update.yml` electron-builder.yml would write.
 *
 * The stub pretends to be a packaged app at `--version`. Downloads are forced off, so a found
 * update is reported and never fetched; nothing is written outside a temp directory.
 *
 * Run:
 *   node --import tsx apps/desktop/scripts/update-probe.ts --version 0.1.0 --expect available
 *   node --import tsx apps/desktop/scripts/update-probe.ts --version 0.1.1 --expect current
 *   node --import tsx apps/desktop/scripts/update-probe.ts --unsigned      # macOS: dormant
 *
 * The feed file is the one for this machine: latest-mac.yml on macOS, latest.yml on Windows,
 * latest-linux.yml on Linux x64 (the AppImage gate needs APPIMAGE set, which the probe fakes).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type Plugin } from 'vite';
import type * as UpdaterModuleNs from '../src/main/updater.js';

type UpdaterModule = typeof UpdaterModuleNs;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const VERSION = flag('--version') ?? '0.1.0';
const EXPECT = flag('--expect'); // available | current | dormant
const UNSIGNED = args.includes('--unsigned');
const KEEP = args.includes('--keep');

const desktop = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'sdods-update-probe-'));
const resources = join(work, 'resources');
const userData = join(work, 'userData');
mkdirSync(resources, { recursive: true });
mkdirSync(userData, { recursive: true });

/** The feed electron-builder writes into Resources/app-update.yml, from the same `publish:` block. */
function appUpdateYml(): string {
  const yml = readFileSync(join(desktop, 'electron-builder.yml'), 'utf8');
  const block = yml.slice(yml.search(/^publish:\s*$/m));
  const field = (key: string) => block.match(new RegExp(`^\\s+${key}:\\s*(\\S+)`, 'm'))?.[1];
  const [provider, owner, repo] = [field('provider'), field('owner'), field('repo')];
  if (!provider || !owner || !repo)
    throw new Error('no publish provider/owner/repo in electron-builder.yml');
  // Field for field what electron-builder 26 wrote into SDODS.app/Contents/Resources/app-update.yml.
  return `owner: ${owner}\nrepo: ${repo}\nprovider: ${provider}\nreleaseType: release\nupdaterCacheDirName: '@sdodsdesktop-updater'\n`;
}

// Stands in for the parts of `electron` the updater path touches. `net.request` is Node's https:
// electron-updater's ElectronHttpExecutor handles the GitHub redirects itself either way.
const ELECTRON_STUB = `
import https from 'node:https';
import { EventEmitter } from 'node:events';
const p = globalThis.__sdodsUpdateProbe;
export const app = {
  isPackaged: true,
  getVersion: () => p.version,
  getName: () => 'SDODS',
  getPath: (name) => (name === 'exe' ? p.exe : p.userData),
  getAppPath: () => p.userData,
  whenReady: async () => {},
  quit() {}, relaunch() {}, once() {}, on() {},
};
export const dialog = {
  showMessageBox: async (o) => {
    console.log('[dialog] ' + o.message + (o.detail ? ' | ' + o.detail : ''));
    return { response: 1 };
  },
};
export const autoUpdater = new EventEmitter();
export const session = { fromPartition: () => ({}) };
export const net = { request: ({ session, redirect, ...options }) => https.request(options) };
export class Notification { show() {} }
export default { app, dialog, autoUpdater, session, net, Notification };
`;

const ENTRY = `export { createUpdater, platformUpdater } from ${JSON.stringify(join(desktop, 'src/main/updater.ts'))};`;

function probeModules(): Plugin {
  return {
    name: 'sdods-update-probe',
    enforce: 'pre',
    resolveId: (id) =>
      id === 'electron' ? '\0electron' : id === 'virtual:probe' ? '\0probe' : null,
    load: (id) => (id === '\0electron' ? ELECTRON_STUB : id === '\0probe' ? ENTRY : null),
  };
}

async function main() {
  writeFileSync(join(resources, 'app-update.yml'), appUpdateYml());
  console.log(`probe: app-update.yml\n${readFileSync(join(resources, 'app-update.yml'), 'utf8')}`);

  const outDir = join(work, 'bundle');
  await build({
    configFile: false,
    root: desktop,
    logLevel: 'warn',
    plugins: [probeModules()],
    define: { __DESKTOP_SIGNED__: JSON.stringify(!UNSIGNED) },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: 'virtual:probe',
        output: { format: 'es', entryFileNames: 'probe.mjs' },
      },
    },
  });

  Object.assign(process, { resourcesPath: resources });
  if (process.platform === 'linux') process.env.APPIMAGE ??= join(work, 'SDODS.AppImage');
  delete process.env.SDODS_DESKTOP_NO_UPDATE;
  (globalThis as Record<string, unknown>).__sdodsUpdateProbe = {
    version: VERSION,
    userData,
    exe: join(work, 'SDODS'),
  };

  const bundle = (await import(pathToFileURL(join(outDir, 'probe.mjs')).href)) as UpdaterModule;

  // The one thing the probe changes: a found update is reported, never downloaded. The instance
  // is the one the app would use; it is only created up front so the property can be pinned.
  const updater = bundle.platformUpdater();
  Object.defineProperty(updater, 'autoDownload', { get: () => false, set: () => {} });

  const controller = bundle.createUpdater(
    { stopServer: async () => undefined, autoCheck: () => true, setAutoCheck: () => undefined },
    { updater: () => updater },
  );
  console.log(`probe: pretending to be SDODS ${VERSION} on ${process.platform}-${process.arch}`);
  console.log('probe: gate', JSON.stringify(controller.gate));

  let outcome: 'available' | 'current' | 'dormant' = 'dormant';
  if (controller.gate.active) {
    controller.start();
    // start() fires the check without waiting; a second call joins the one in flight.
    const result = await updater.checkForUpdates();
    outcome = result?.isUpdateAvailable ? 'available' : 'current';
    if (outcome === 'current') await controller.checkNow();
    controller.dispose();
  } else {
    await controller.checkNow();
  }

  const logFile = join(userData, 'logs', 'desktop.log');
  console.log(`\nprobe: ${logFile}`);
  console.log(readFileSync(logFile, 'utf8').trimEnd());
  console.log(`\nprobe: outcome=${outcome}`);
  if (EXPECT && EXPECT !== outcome) throw new Error(`expected ${EXPECT}, got ${outcome}`);
}

try {
  await main();
} finally {
  if (!KEEP) rmSync(work, { recursive: true, force: true });
}
