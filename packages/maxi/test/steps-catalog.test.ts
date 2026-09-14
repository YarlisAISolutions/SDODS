import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSteps, StepCatalog, validateFeature } from '../src/tools.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const catalogFile = join(import.meta.dirname, '..', 'data', 'steps.json');

describe('data/steps.json', () => {
  it('matches the demo-shop steps (run `bun run maxi:steps` after changing them)', () => {
    const live = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'packages/cli/src/bin.ts',
          'steps',
          'list',
          '-p',
          'demo-shop',
          '--json',
        ],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      ),
    ) as Array<{ keyword: string; pattern: string }>;
    const key = (s: { keyword: string; pattern: string }) => `${s.keyword} ${s.pattern}`;
    expect(loadSteps(catalogFile).map(key).sort()).toEqual(live.map(key).sort());
  });

  it('recognises every step the docs teach with in the demo-shop login feature', () => {
    const feature = readFileSync(
      join(repoRoot, 'packages/cli/templates/projects/demo-shop/features/auth/login.feature'),
      'utf8',
    );
    const report = validateFeature(feature, new StepCatalog(loadSteps(catalogFile)));
    expect(report.stepsNotInCatalog).toEqual([]);
    expect(report.valid).toBe(true);
  });
});
