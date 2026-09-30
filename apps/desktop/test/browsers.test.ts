import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
vi.mock('../src/main/log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), file: () => '' },
}));

const { chromiumInstalled, expectedChromiumRevisions } = await import('../src/main/browsers.js');

const REV = { chromium: '1243', headlessShell: '1243' };

function cache(folders: Record<string, boolean>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-desktop-browsers-'));
  for (const [folder, complete] of Object.entries(folders)) {
    mkdirSync(join(dir, folder), { recursive: true });
    if (complete) writeFileSync(join(dir, folder, 'INSTALLATION_COMPLETE'), '');
  }
  return dir;
}

/**
 * The Windows failure: a cache that "had chromium" by folder name, so the app never installed
 * again, while chromium-1243\chrome-win64\chrome.exe did not exist.
 */
describe('chromiumInstalled', () => {
  it('is true only for a complete chromium and headless shell of the expected revision', () => {
    const dir = cache({ 'chromium-1243': true, 'chromium_headless_shell-1243': true });
    expect(chromiumInstalled(dir, REV)).toBe(true);
  });

  it('is false for an empty or missing cache', () => {
    expect(chromiumInstalled(cache({}), REV)).toBe(false);
    expect(chromiumInstalled(join(tmpdir(), 'sdods-no-such-dir'), REV)).toBe(false);
  });

  it('is false for a download cut off before the marker', () => {
    const dir = cache({ 'chromium-1243': false, 'chromium_headless_shell-1243': true });
    expect(chromiumInstalled(dir, REV)).toBe(false);
  });

  it('is false for a lone headless shell', () => {
    expect(chromiumInstalled(cache({ 'chromium_headless_shell-1243': true }), REV)).toBe(false);
  });

  it('is false for an older revision left behind by an update', () => {
    const dir = cache({ 'chromium-1228': true, 'chromium_headless_shell-1228': true });
    expect(chromiumInstalled(dir, REV)).toBe(false);
  });

  it('is false when the workspace revision cannot be read', () => {
    const dir = cache({ 'chromium-1243': true, 'chromium_headless_shell-1243': true });
    expect(chromiumInstalled(dir, null)).toBe(false);
  });
});

describe('expectedChromiumRevisions', () => {
  it("reads the revision from the runner's own playwright-core", () => {
    const ws = mkdtempSync(join(tmpdir(), 'sdods-ws-'));
    writeFileSync(join(ws, 'package.json'), '{}');
    const pkg = (name: string, files: Record<string, string>) => {
      const dir = join(ws, 'node_modules', ...name.split('/'));
      mkdirSync(dir, { recursive: true });
      // An exports map like the real playwright-core's: package.json is exported, browsers.json
      // is not, so the code has to reach it through package.json.
      const exports = { '.': './index.js', './package.json': './package.json' };
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', exports }));
      for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body);
    };
    const browsers = (rev: string) =>
      JSON.stringify({
        browsers: [
          { name: 'chromium', revision: rev },
          { name: 'chromium-headless-shell', revision: rev },
        ],
      });
    pkg('@playwright/test', {});
    pkg('playwright', {});
    pkg('playwright-core', { 'browsers.json': browsers('1243') });
    expect(expectedChromiumRevisions(ws)).toEqual({ chromium: '1243', headlessShell: '1243' });
  });

  it('is null for a workspace without Playwright', () => {
    const ws = mkdtempSync(join(tmpdir(), 'sdods-ws-empty-'));
    writeFileSync(join(ws, 'package.json'), '{}');
    expect(expectedChromiumRevisions(ws)).toBeNull();
  });
});
