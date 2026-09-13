import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIN_PLAYWRIGHT_FOR_STEP_RESULTS,
  installedPlaywrightVersion,
  stepResultsWarning,
} from '../src/runner-compat.js';

/** A workspace whose node_modules holds only a @playwright/test manifest at `version`. */
function workspace(version?: string) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-runner-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ws', private: true }));
  if (version) {
    const pkg = join(root, 'node_modules', '@playwright', 'test');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: '@playwright/test',
        version,
        exports: { './package.json': './package.json' },
      }),
    );
  }
  return root;
}

describe('step results compatibility (#79)', () => {
  it('warns on every version measured to record steps SKIPPED', () => {
    for (const v of ['1.60.0', '1.61.1', '1.62.0', '1.62.1']) {
      expect(stepResultsWarning(v), v).toContain('record every step SKIPPED');
    }
  });

  it('is silent from 1.63.0 on, including prereleases of later minors', () => {
    for (const v of [
      MIN_PLAYWRIGHT_FOR_STEP_RESULTS,
      '1.63.2',
      '1.64.0-alpha-2026-10-01',
      '2.0.0',
    ]) {
      expect(stepResultsWarning(v), v).toBeUndefined();
    }
  });

  it('reads the version the workspace resolves, not the CLI’s own', () => {
    expect(installedPlaywrightVersion(workspace('1.62.1'))).toBe('1.62.1');
    expect(installedPlaywrightVersion(workspace())).toBeUndefined();
    expect(stepResultsWarning(installedPlaywrightVersion(workspace()))).toBeUndefined();
  });

  it('pins scaffolded workspaces at or above the floor', async () => {
    const { readFileSync } = await import('node:fs');
    const init = readFileSync(
      join(import.meta.dirname, '..', 'src', 'commands', 'init.ts'),
      'utf8',
    );
    const pin = init.match(/'link:@playwright\/test' : '\^([\d.]+)'/)?.[1];
    expect(pin).toBeDefined();
    expect(stepResultsWarning(pin)).toBeUndefined();
  });
});
