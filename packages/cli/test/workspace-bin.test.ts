import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workspaceBin } from '../src/workspace-bin.js';

describe('workspaceBin', () => {
  it("runs an installed package's bin with this node, whatever shims exist", () => {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), 'sdods-bin-')));
    writeFileSync(join(ws, 'package.json'), '{}');
    const pkg = join(ws, 'node_modules', 'playwright-bdd');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'playwright-bdd',
        bin: { bddgen: 'dist/cli/index.js' },
        exports: { '.': './index.js', './package.json': './package.json' },
      }),
    );
    expect(workspaceBin(ws, 'playwright-bdd', 'bddgen')).toEqual([
      process.execPath,
      join(pkg, 'dist/cli/index.js'),
    ]);
  });

  it('falls back to npx when the package is not installed', () => {
    const ws = mkdtempSync(join(tmpdir(), 'sdods-bin-empty-'));
    writeFileSync(join(ws, 'package.json'), '{}');
    expect(workspaceBin(ws, 'playwright-bdd', 'bddgen')).toEqual(['npx', 'bddgen']);
  });
});
