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
 * anyone can navigate to Runs and start something.
 */
import { existsSync, readdirSync } from 'node:fs';
import { runSdods } from './proc.js';
import { browsersDir } from './paths.js';
import { log } from './log.js';

export type BrowserState = 'present' | 'missing' | 'installing' | 'failed';

/**
 * Cheap presence check: Playwright lays engines out as <cache>/<engine>-<revision>/.
 * `sdods browsers list --json` is authoritative but costs a process spawn, so use this for the
 * hot path and let the install itself be the real source of truth.
 */
export function chromiumPresent(): boolean {
  const dir = browsersDir();
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((entry) => entry.startsWith('chromium'));
  } catch {
    return false;
  }
}

export interface EnsureOptions {
  workspace: string;
  onProgress?: (line: string) => void;
}

/**
 * Install Chromium if the app-owned cache is empty. Idempotent and safe to call on every launch.
 *
 * Deliberately Chromium only: it is what every default suite uses, and it is ~180 MB against
 * ~500 MB for all three engines. Firefox and WebKit stay a deliberate, separate choice.
 */
export async function ensureChromium(opts: EnsureOptions): Promise<BrowserState> {
  if (chromiumPresent()) return 'present';

  log.info('browsers: chromium missing, installing into', browsersDir());
  opts.onProgress?.('Downloading the Chromium test browser (about 180 MB)…');

  // `--with-deps` needs root on Linux, which a GUI app cannot elevate to; omit it and surface the
  // missing-library error if a run later fails.
  const res = await runSdods(['browsers', 'install', '-b', 'chromium'], {
    workspace: opts.workspace,
    onLine: (line) => opts.onProgress?.(line),
    timeoutMs: 20 * 60_000,
  });

  if (res.code !== 0 || !chromiumPresent()) {
    log.error('browsers: install failed:', res.stderr.trim().split('\n').slice(-10).join('\n'));
    return 'failed';
  }
  log.info('browsers: chromium ready');
  return 'present';
}
