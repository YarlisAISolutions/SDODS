import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { featureTools } from '@sdods/mcp';

const root = resolve(import.meta.dirname, '..', '..');

const cli = (cwd: string, ...args: string[]) =>
  execa('node', ['--import', 'tsx', join(root, 'packages/cli/src/bin.ts'), '--cwd', cwd, ...args], {
    cwd: root,
    reject: false,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });

const MATRIX = `matrices:
  admin-surfaces:
    roles: [owner, viewer]
    default: denied
    rows:
      - surface: /settings/billing
        expect: { owner: allowed }
      - surface: /settings/profile
        expect: allowed
`;

const TEMPLATE = `@ui
Feature: Admin surfaces

  @regression @matrix:admin-surfaces
  Scenario Outline: Surface access by role
    Given I open the surface "<surface>"
    Then access should be "<expect>"
`;

/**
 * `base` defaults to the OS tmpdir. The MCP tool spawns `node --import tsx` with the workspace as its
 * cwd, which only resolves inside a checkout, so that test uses the repo's ignored `.sdods/` dir.
 */
function workspace(base = tmpdir()) {
  mkdirSync(base, { recursive: true });
  const ws = mkdtempSync(join(base, 'sdods-matrix-cli-'));
  const files: Record<string, string> = {
    'package.json': '{}',
    'projects/shop/sdods.project.yaml':
      'slug: shop\nname: Shop\nlayers: [ui]\nbrowsers: [chromium]\nenvs: { default: local, available: [local] }\ntags: { roles: [owner, viewer] }\n',
    'projects/shop/envs/local.yaml':
      'ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n',
    'projects/shop/roles.matrix.yaml': MATRIX,
    'projects/shop/features/admin/surfaces.feature': TEMPLATE,
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(ws, rel)), { recursive: true });
    writeFileSync(join(ws, rel), body);
  }
  return { ws, feature: join(ws, 'projects/shop/features/admin/surfaces.feature') };
}

describe('sdods matrix expand (#118)', () => {
  it('--check fails on an unexpanded outline, expand writes it, --check then passes', async () => {
    const { ws, feature } = workspace();

    let r = await cli(ws, '--json', 'matrix', 'expand', '-p', 'shop', '--check');
    expect(r.exitCode, r.stderr).toBe(3);
    expect(JSON.parse(r.stdout).files).toEqual([
      { project: 'shop', path: 'features/admin/surfaces.feature', status: 'stale', examples: 4 },
    ]);
    expect(readFileSync(feature, 'utf8')).toBe(TEMPLATE);

    r = await cli(ws, 'matrix', 'expand', '-p', 'shop');
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      'updated  shop/features/admin/surfaces.feature  (4 generated example(s))',
    );
    const expanded = readFileSync(feature, 'utf8');
    expect(expanded).toContain('    @user:viewer\n    Examples: viewer\n');
    expect(expanded).toContain('      | viewer | /settings/billing | denied  |');

    r = await cli(ws, 'matrix', 'expand', '-p', 'shop', '--check');
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('matrix features are up to date');

    // Idempotent on disk, too.
    r = await cli(ws, 'matrix', 'expand', '-p', 'shop');
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(feature, 'utf8')).toBe(expanded);

    // A matrix edit makes the committed feature stale again; lint sees it as a warning.
    writeFileSync(
      join(ws, 'projects/shop/roles.matrix.yaml'),
      MATRIX.replace('{ owner: allowed }', '{ owner: denied }'),
    );
    r = await cli(ws, 'matrix', 'expand', '-p', 'shop', '--check');
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toContain('out of date  shop/features/admin/surfaces.feature');
    r = await cli(ws, '--json', 'lint', '-p', 'shop');
    expect(JSON.parse(r.stdout).warnings.map((w: { rule: string }) => w.rule)).toContain(
      'matrix/stale',
    );
  }, 120_000);

  it('--dry-run --json returns the expanded text without writing', async () => {
    const { ws, feature } = workspace();
    const r = await cli(ws, '--json', 'matrix', 'expand', '-p', 'shop', '--dry-run');
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.files[0].status).toBe('stale');
    expect(out.files[0].content).toContain('# sdods:matrix:end admin-surfaces');
    expect(readFileSync(feature, 'utf8')).toBe(TEMPLATE);
  }, 60_000);

  it('--file without -p belongs to the project whose folder holds it, not one with a prefix of its name', async () => {
    const { ws } = workspace();
    // A second project whose slug starts with the first one's: projects/shop-admin vs projects/shop.
    for (const [rel, body] of Object.entries({
      'projects/shop-admin/sdods.project.yaml':
        'slug: shop-admin\nname: Shop admin\nlayers: [ui]\nbrowsers: [chromium]\nenvs: { default: local, available: [local] }\ntags: { roles: [owner, viewer] }\n',
      'projects/shop-admin/envs/local.yaml':
        'ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n',
      'projects/shop-admin/roles.matrix.yaml': MATRIX,
      'projects/shop-admin/features/admin/surfaces.feature': TEMPLATE,
    })) {
      mkdirSync(dirname(join(ws, rel)), { recursive: true });
      writeFileSync(join(ws, rel), body);
    }
    const file = join(ws, 'projects/shop-admin/features/admin/surfaces.feature');
    const r = await cli(ws, '--json', 'matrix', 'expand', '--dry-run', '--file', file);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(
      (JSON.parse(r.stdout).files as Array<{ project: string; path: string }>).map(
        (f) => `${f.project}:${f.path}`,
      ),
    ).toEqual(['shop-admin:features/admin/surfaces.feature']);
  }, 60_000);

  it('exits 2 on an invalid matrix file and does not rewrite features', async () => {
    const { ws, feature } = workspace();
    writeFileSync(
      join(ws, 'projects/shop/roles.matrix.yaml'),
      MATRIX.replace('roles: [owner, viewer]', 'roles: owner'),
    );
    const r = await cli(ws, 'matrix', 'expand', '-p', 'shop');
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain('matrix/config');
    expect(readFileSync(feature, 'utf8')).toBe(TEMPLATE);
  }, 60_000);

  it('the MCP matrix_expand tool proposes the expansion instead of writing it', async () => {
    const { ws, feature } = workspace(join(root, '.sdods', 'test-tmp'));
    const tool = featureTools.find((t) => t.name === 'matrix_expand')!;
    expect(tool.access).toBe('write');
    const res = await tool.handler({ project: 'shop' }, { rootDir: ws } as never);
    expect(res.isError).toBeFalsy();
    const manifest = (
      res.data as { proposal: { id: string; files: Array<{ path: string; op: string }> } }
    ).proposal;
    expect(manifest.files).toEqual([
      expect.objectContaining({
        path: 'projects/shop/features/admin/surfaces.feature',
        op: 'modify',
      }),
    ]);
    expect(readFileSync(feature, 'utf8')).toBe(TEMPLATE);
    const staged = readFileSync(
      join(ws, 'proposals', manifest.id, 'files', 'projects/shop/features/admin/surfaces.feature'),
      'utf8',
    );
    expect(staged).toContain('@user:owner');
    rmSync(ws, { recursive: true, force: true });
  }, 60_000);
});
