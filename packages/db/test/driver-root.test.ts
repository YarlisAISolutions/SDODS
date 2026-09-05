import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SQLITE_PATH, findWorkspaceRoot, resolveDriverConfig } from '../src/driver.js';

/**
 * `sdods serve` run from inside a run's artifacts folder used to create an empty database there
 * and then reject every login, because `sdods users create` had written to the workspace database
 * several levels up. The default path is anchored to the workspace so both agree.
 */
describe('sqlite path anchoring', () => {
  let root: string;
  let cwd: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sdods-root-')));
    writeFileSync(join(root, 'sdods.workspace.yaml'), 'name: test\n');
    cwd = process.cwd();
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves the default database against the workspace, not the current directory', () => {
    const deep = join(root, '.sdods/runs/01abc/dashboard');
    mkdirSync(deep, { recursive: true });
    process.chdir(deep);
    expect(resolveDriverConfig({ DB_DRIVER: 'sqlite' } as never).sqlitePath).toBe(
      join(root, DEFAULT_SQLITE_PATH),
    );
  });

  it('agrees from the workspace root and from a subdirectory', () => {
    const deep = join(root, 'projects/demo-shop/features');
    mkdirSync(deep, { recursive: true });
    process.chdir(root);
    const fromRoot = resolveDriverConfig({ DB_DRIVER: 'sqlite' } as never).sqlitePath;
    process.chdir(deep);
    const fromDeep = resolveDriverConfig({ DB_DRIVER: 'sqlite' } as never).sqlitePath;
    expect(fromDeep).toBe(fromRoot);
  });

  it('leaves an explicit SQLITE_PATH alone', () => {
    process.chdir(root);
    expect(
      resolveDriverConfig({ DB_DRIVER: 'sqlite', SQLITE_PATH: '/tmp/explicit.db' } as never)
        .sqlitePath,
    ).toBe('/tmp/explicit.db');
  });

  it('falls back to the relative default outside any workspace', () => {
    const orphan = realpathSync(mkdtempSync(join(tmpdir(), 'sdods-orphan-')));
    process.chdir(orphan);
    expect(findWorkspaceRoot()).toBeNull();
    expect(resolveDriverConfig({ DB_DRIVER: 'sqlite' } as never).sqlitePath).toBe(
      DEFAULT_SQLITE_PATH,
    );
    rmSync(orphan, { recursive: true, force: true });
  });
});
