import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryDb, migrateToLatest } from '@sdods/db';
import { loadServerConfig } from '../src/config.js';
import { RunManager } from '../src/services/run-manager.js';

/**
 * Stop, for real: a UI run of the demo project is started through the RunManager, stopped once its
 * browsers are up, and the OS is asked whether anything from it is still alive.
 *
 * Opt-in (SDODS_E2E_STOP=1) because it launches Chromium and takes tens of seconds. CI runs it on
 * Linux, macOS and Windows (ci.yml, browsers-and-stop), which is the point: before kill-tree.ts a
 * stop on Windows ended only the CLI and left Playwright and its browsers running.
 */
const enabled = process.env.SDODS_E2E_STOP === '1';

function leftovers(pattern: string): string[] {
  if (process.platform === 'win32') {
    const ps =
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${pattern}' ` +
      `-and $_.CommandLine -notmatch 'Get-CimInstance' } | ForEach-Object { $_.ProcessId }`;
    return execSync(`powershell -NoProfile -Command "${ps}"`)
      .toString()
      .split(/\s+/)
      .filter(Boolean);
  }
  return execSync(`pgrep -f '${pattern}' || true`).toString().split(/\s+/).filter(Boolean);
}

const until = async (cond: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end && !cond();)
    await new Promise((r) => setTimeout(r, 250));
};

describe.skipIf(!enabled)('stopping a real run', () => {
  it('ends the CLI, Playwright, its workers and their browsers', async () => {
    const root = resolve(import.meta.dirname, '../../..');
    const config = loadServerConfig({ rootDir: root, maxConcurrentRuns: 1 });
    const adb = createMemoryDb();
    await migrateToLatest(adb);
    const manager = new RunManager(config, adb);
    const job = await manager.start({
      project: 'demo-shop',
      env: 'staging',
      layers: ['ui'],
      browsers: ['chromium'],
      workers: 2,
      harMode: 'replay',
    });
    const pattern = `${job.runId}|headless_shell|chrome-headless-shell`;

    await until(() => job.log.since(0).some((l) => /Running \d+ tests?/.test(l.line)), 120_000);
    await until(() => leftovers(pattern).length > 1, 20_000);
    expect(job.status).toBe('running');
    expect(leftovers(pattern).length).toBeGreaterThan(1);

    expect(manager.cancel(job.runId)).toBe(true);
    await until(() => job.status !== 'running', 30_000);
    await until(() => leftovers(pattern).length === 0, 15_000);

    expect(job.status).toBe('cancelled');
    expect(leftovers(pattern)).toEqual([]);
  }, 240_000);
});
