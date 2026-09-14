/**
 * Writes data/steps.json: the step catalog Maxi's find_steps and validate_feature use. It is the
 * demo-shop template project, the one the docs teach with.
 *
 *   bun run --filter @sdods/maxi steps
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const out = join(here, '..', 'data', 'steps.json');

const json = execFileSync(
  process.execPath,
  [
    '--import',
    'tsx',
    join(repoRoot, 'packages/cli/src/bin.ts'),
    'steps',
    'list',
    '-p',
    'demo-shop',
    '--json',
  ],
  { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
const steps = (JSON.parse(json) as Array<{ keyword: string; pattern: string; source: string }>)
  .map(({ keyword, pattern, source }) => ({ keyword, pattern, source }))
  .sort((a, b) => a.pattern.localeCompare(b.pattern) || a.keyword.localeCompare(b.keyword));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(steps, null, 2)}\n`);
console.log(`wrote ${steps.length} steps to ${out}`);
