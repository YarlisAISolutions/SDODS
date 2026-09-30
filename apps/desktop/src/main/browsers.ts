/**
 * Playwright browser engines, fetched on demand into an app-owned cache.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` points at <appData>/browsers so the app neither depends on nor
 * pollutes the user's own ~/Library/Caches/ms-playwright. The cost of that isolation is that the
 * cache starts empty and *nothing* runs until it is filled.
 *
 * Note "nothing", not "no UI test": SDODS merges one BDD fixture set across @ui, @api and @hybrid,
 * so the runner launches a browser even for an API-layer run. Measured directly — an api-layer run
 * against an empty cache fails with `browserType.launch: Executable doesn't exist`. So this is not
 * a UI-only concern and cannot be deferred until someone opens a UI feature.
 *
 * The compromise: the window loads the dashboard first, then Chromium downloads in the background
 * with a visible status. The app feels instant, and the engine is almost always in place before
 * anyone can navigate to Runs and start something. Every run also checks for itself and downloads
 * whatever is still missing (SDODS_AUTO_INSTALL_BROWSERS, set in runtime.ts), so a download that
 * failed here, or a browser the project asks for later (Firefox, WebKit), repairs itself.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runSdods } from './proc.js';
import { browsersDir } from './paths.js';
import { log } from './log.js';

export type BrowserState = 'present' | 'missing' | 'installing' | 'failed';

export interface ChromiumRevisions {
  chromium: string;
  headlessShell: string;
}

/**
 * The Chromium revisions the workspace's Playwright launches, read from its `browsers.json`.
 *
 * The main process bundles no production dependencies, so it cannot import playwright-core and ask.
 * Resolving through `@playwright/test` finds the copy the runner uses even when another copy (the
 * CLI's own) is hoisted next to it with a different revision.
 */
export function expectedChromiumRevisions(workspace: string): ChromiumRevisions | null {
  // `browsers.json` is not in playwright-core's `exports`, so resolving it directly throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED; `package.json` is exported, and the file sits next to it.
  const candidates: Array<() => string> = [
    () => {
      const ws = createRequire(join(workspace, 'package.json'));
      const test = createRequire(ws.resolve('@playwright/test/package.json'));
      const pw = createRequire(test.resolve('playwright/package.json'));
      return pw.resolve('playwright-core/package.json');
    },
    () => createRequire(join(workspace, 'package.json')).resolve('playwright-core/package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const browsersJson = join(dirname(candidate()), 'browsers.json');
      const file = JSON.parse(readFileSync(browsersJson, 'utf8')) as {
        browsers: Array<{ name: string; revision: string }>;
      };
      const rev = (name: string) => file.browsers.find((b) => b.name === name)?.revision;
      const chromium = rev('chromium');
      const headlessShell = rev('chromium-headless-shell') ?? chromium;
      if (chromium && headlessShell) return { chromium, headlessShell };
    } catch {
      // try the next location
    }
  }
  return null;
}

/**
 * Whether this exact Chromium finished downloading into `dir`.
 *
 * Playwright writes `INSTALLATION_COMPLETE` last, and headless runs launch the separate headless
 * shell, so both folders of the expected revision must carry the marker. The check this replaces
 * accepted any folder whose name started with "chromium": a cut-off download, a lone headless
 * shell or an older revision all passed, the install was skipped for good, and every run failed
 * with "Executable doesn't exist" (seen on Windows in chromium-1243\chrome-win64\chrome.exe).
 */
export function chromiumInstalled(dir: string, revisions: ChromiumRevisions | null): boolean {
  if (!revisions || !existsSync(dir)) return false;
  const complete = (folder: string) => existsSync(join(dir, folder, 'INSTALLATION_COMPLETE'));
  return (
    complete(`chromium-${revisions.chromium}`) &&
    complete(`chromium_headless_shell-${revisions.headlessShell}`)
  );
}

export function chromiumPresent(workspace: string): boolean {
  return chromiumInstalled(browsersDir(), expectedChromiumRevisions(workspace));
}

export interface EnsureOptions {
  workspace: string;
  onProgress?: (line: string) => void;
  /** Delete this revision first and download it again (the "Reinstall test browsers" menu item). */
  force?: boolean;
}

/**
 * Install Chromium if this revision is not complete in the app-owned cache. Idempotent and safe to
 * call on every launch.
 *
 * Deliberately Chromium only: it is what every default suite uses, and it is ~180 MB against
 * ~500 MB for all three engines. Firefox and WebKit are downloaded by the run that first needs them.
 */
export async function ensureChromium(opts: EnsureOptions): Promise<BrowserState> {
  const revisions = expectedChromiumRevisions(opts.workspace);
  if (opts.force && revisions) {
    for (const folder of [
      `chromium-${revisions.chromium}`,
      `chromium_headless_shell-${revisions.headlessShell}`,
    ]) {
      rmSync(join(browsersDir(), folder), { recursive: true, force: true });
    }
  } else if (chromiumInstalled(browsersDir(), revisions)) {
    return 'present';
  }

  log.info('browsers: chromium missing or incomplete, installing into', browsersDir());
  opts.onProgress?.('Downloading the Chromium test browser (about 180 MB)…');

  // `--with-deps` needs root on Linux, which a GUI app cannot elevate to; omit it and surface the
  // missing-library error if a run later fails. Playwright itself re-downloads any folder that
  // lacks its INSTALLATION_COMPLETE marker, so a cut-off download is repaired rather than skipped.
  const res = await runSdods(['browsers', 'install', '-b', 'chromium'], {
    workspace: opts.workspace,
    onLine: (line) => opts.onProgress?.(line),
    timeoutMs: 20 * 60_000,
  });

  if (res.code !== 0) {
    log.error('browsers: install failed:', res.stderr.trim().split('\n').slice(-10).join('\n'));
    return 'failed';
  }
  // A revision this cannot predict (a platform override in browsers.json) still installed fine if
  // Playwright said so; only an unresolvable workspace is reported, not failed.
  if (!chromiumInstalled(browsersDir(), expectedChromiumRevisions(opts.workspace))) {
    log.warn('browsers: install succeeded but the expected revision folders were not found');
  }
  log.info('browsers: chromium ready');
  return 'present';
}
