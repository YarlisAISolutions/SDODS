import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browserStatuses,
  ensureBrowsers,
  installationComplete,
  warmupBrowsers,
} from '../src/commands/browsers.js';

/**
 * Edge is a channel, not a Playwright download. Detection used to go through
 * `playwright-core.chromium.executablePath()`, which returns the BUNDLED Chromium path — a file
 * that exists on nearly every machine — so `edge` would have reported itself installed everywhere,
 * and `sdods run -b edge` would then fail deep inside Playwright instead of up front.
 */
describe('browserStatuses', () => {
  it('probes edge by its own binary path, not the bundled engine', async () => {
    const [edge, chromium] = await browserStatuses(['edge', 'chromium']);
    expect(edge?.name).toBe('edge');
    expect(edge?.engine).toBe('chromium');
    expect(edge?.channel).toBe('msedge');
    // The distinguishing assertion: the two must not resolve to the same binary.
    expect(edge?.executable).not.toBe(chromium?.executable);
    expect(edge?.executable ?? '').toMatch(/[Ee]dge/);
    // `installed` is the truth about that path, whichever machine this runs on.
    expect(edge?.installed).toBe(edge?.executable ? existsSync(edge.executable) : false);
  });

  it('reports a downloaded engine with no channel', async () => {
    const [chromium] = await browserStatuses(['chromium']);
    expect(chromium?.channel).toBeNull();
  });

  it('omits channel browsers from the default set', async () => {
    // A bare `sdods browsers list` exits 1 when anything is missing. Including Edge by default
    // would make that a permanently failing command on every machine that does not run Edge.
    const names = (await browserStatuses()).map((s) => s.name);
    expect(names).toContain('chromium');
    expect(names).not.toContain('edge');
  });
});

describe('browsers list filtering', () => {
  it('names only what was asked for', async () => {
    // The CI job that installs just Edge has to be able to check just Edge: `-p <slug>` checks
    // every browser the project declares and exits 1 on the ones that runner never downloaded.
    const only = await browserStatuses(['edge']);
    expect(only.map((s) => s.name)).toEqual(['edge']);
  });
});

describe('warmupBrowsers', () => {
  it('opens and closes each requested browser', async () => {
    // The CI job that provisions a browser and uses it in the same job depends on this: the
    // `node -e "require('playwright-core')…"` it replaced could not resolve playwright-core from
    // the repo root on a runner, so the step failed on every platform while looking like a
    // browser problem.
    const [edge] = await browserStatuses(['edge']);
    if (!edge?.installed) return; // nothing to warm up on a machine without Edge
    await expect(warmupBrowsers(['edge'])).resolves.toEqual(['edge']);
  }, 120_000);
});

/**
 * The Windows desktop failure: `chromium-1243\chrome-win64\chrome.exe` missing while the cache
 * looked populated. Presence has to mean "this exact revision finished downloading", not "some
 * chromium folder exists".
 */
describe('installationComplete', () => {
  const cache = () => mkdtempSync(join(tmpdir(), 'sdods-browsers-'));
  const place = (root: string, dir: string, file: string, complete: boolean) => {
    const full = join(root, dir, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '');
    if (complete) writeFileSync(join(root, dir, 'INSTALLATION_COMPLETE'), '');
    return full;
  };

  it('accepts a finished chromium with its headless shell', () => {
    const root = cache();
    const exe = place(root, 'chromium-1243', 'chrome-win64/chrome.exe', true);
    place(root, 'chromium_headless_shell-1243', 'chrome-headless-shell-win64/shell.exe', true);
    expect(installationComplete(exe)).toBe(true);
  });

  it('rejects a download that was cut off before the marker', () => {
    const root = cache();
    const exe = place(root, 'chromium-1243', 'chrome-win64/chrome.exe', false);
    place(root, 'chromium_headless_shell-1243', 'x/shell.exe', true);
    expect(installationComplete(exe)).toBe(false);
  });

  it('rejects chromium whose headless shell is missing or from another revision', () => {
    const root = cache();
    const exe = place(root, 'chromium-1243', 'chrome-win64/chrome.exe', true);
    expect(installationComplete(exe)).toBe(false);
    place(root, 'chromium_headless_shell-1228', 'x/shell.exe', true);
    expect(installationComplete(exe)).toBe(false);
  });

  it('rejects an executable that is not there', () => {
    const root = cache();
    mkdirSync(join(root, 'chromium-1243'), { recursive: true });
    writeFileSync(join(root, 'chromium-1243', 'INSTALLATION_COMPLETE'), '');
    expect(installationComplete(join(root, 'chromium-1243', 'chrome-win64', 'chrome.exe'))).toBe(
      false,
    );
  });

  it('accepts firefox and webkit on their own marker', () => {
    const root = cache();
    expect(installationComplete(place(root, 'firefox-1543', 'firefox/firefox', true))).toBe(true);
    expect(installationComplete(place(root, 'webkit-2359', 'pw_run.sh', false))).toBe(false);
  });

  it('falls back to existence outside the Playwright cache layout', () => {
    const root = cache();
    expect(installationComplete(place(root, 'custom', 'chrome', false))).toBe(true);
  });
});

describe('ensureBrowsers', () => {
  it('leaves channel browsers to the run check and returns nothing to install', async () => {
    await expect(ensureBrowsers(['edge'], { cwd: process.cwd(), install: false })).resolves.toEqual(
      [],
    );
  });
});
