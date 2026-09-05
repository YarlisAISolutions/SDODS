import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { currentBlock, renderReadmeBlock } from '../scripts/sync-roadmap';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('roadmap sync', () => {
  it('keeps the README block in step with the roadmap data', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    expect(currentBlock(readme), 'run: bun run roadmap:sync').toBe(renderReadmeBlock());
  });
});
