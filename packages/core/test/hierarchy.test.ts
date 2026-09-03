import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectRegistry, loadWorkspaceFile } from '../src/config/registry.js';

function repo(opts: { workspaceYaml?: string | null; projects?: Record<string, string> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'automax-ws-'));
  writeFileSync(join(root, 'package.json'), '{}');
  if (opts.workspaceYaml !== null) {
    writeFileSync(
      join(root, 'automax.workspace.yaml'),
      opts.workspaceYaml ??
        `organization: { slug: acme, name: Acme }
workspaces:
  - { slug: web, name: Web team, organization: acme }
  - { slug: mobile, name: Mobile team, organization: acme }
defaultWorkspace: web
defaults:
  processes:
    - { name: pr-check, trigger: pr, tags: '@smoke', browsers: [chromium] }
    - { name: nightly, trigger: nightly, tags: '@regression' }
`,
    );
  }
  const projects = opts.projects ?? {
    shop: `slug: shop\nname: Shop\nlayers: [ui, api]\nenvs: { default: local, available: [local] }\nmodules:\n  - { name: auth, testingTypes: [functional, smoke], tags: ['@auth'] }\n  - { name: catalog, path: features/catalog, testingTypes: [regression] }\nprocesses:\n  - { name: pr-check, trigger: pr, tags: '@smoke or @sanity', browsers: [chromium, firefox] }\n  - { name: release-gate, trigger: release, failOnFlaky: true, gates: { minPassRate: 100 } }\n`,
    app: `slug: app\nname: App\nworkspace: mobile\nlayers: [ui]\nenvs: { default: local, available: [local] }\n`,
  };
  for (const [slug, yaml] of Object.entries(projects)) {
    const dir = join(root, 'projects', slug);
    mkdirSync(join(dir, 'envs'), { recursive: true });
    writeFileSync(join(dir, 'automax.project.yaml'), yaml);
    writeFileSync(
      join(dir, 'envs', 'local.yaml'),
      `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n`,
    );
  }
  return root;
}

describe('organization → workspaces → projects → modules → processes', () => {
  it('assigns projects to workspaces (explicit or default) and builds the tree', () => {
    const reg = ProjectRegistry.discover(repo());
    expect(reg.organization().slug).toBe('acme');
    expect(reg.workspaces().map((w) => w.slug)).toEqual(['web', 'mobile']);
    expect(reg.entry('shop').workspace).toBe('web');
    expect(reg.entry('app').workspace).toBe('mobile');
    expect(reg.projectsInWorkspace('mobile').map((p) => p.slug)).toEqual(['app']);
    const tree = reg.tree();
    expect(tree.workspaces[0]!.projects[0]!.modules.map((m) => m.name)).toEqual([
      'auth',
      'catalog',
    ]);
    expect(tree.workspaces[0]!.projects[0]!.processes).toEqual([
      'pr-check',
      'nightly',
      'release-gate',
    ]);
  });

  it('merges workspace default processes with project overrides by name', () => {
    const reg = ProjectRegistry.discover(repo());
    const shop = reg.processesOf('shop');
    expect(shop.find((p) => p.name === 'pr-check')?.browsers).toEqual(['chromium', 'firefox']); // project override
    expect(shop.find((p) => p.name === 'nightly')?.tags).toBe('@regression'); // inherited
    expect(reg.processOf('shop', 'release-gate').gates.minPassRate).toBe(100);
    expect(() => reg.processOf('shop', 'nope')).toThrow(/not defined/);
    expect(reg.processesOf('app').map((p) => p.name)).toEqual(['pr-check', 'nightly']);
  });

  it('maps feature paths to modules by directory', () => {
    const reg = ProjectRegistry.discover(repo());
    expect(reg.moduleOfFeature('shop', 'features/auth/login.feature')?.name).toBe('auth');
    expect(reg.moduleOfFeature('shop', 'catalog/list.feature')?.name).toBe('catalog');
    expect(reg.moduleOfFeature('shop', 'features/misc/x.feature')).toBeUndefined();
  });

  it('falls back to a built-in default org/workspace when the file is missing', () => {
    const reg = ProjectRegistry.discover(
      repo({
        workspaceYaml: null,
        projects: {
          solo: `slug: solo\nname: Solo\nlayers: [api]\nenvs: { default: local, available: [local] }\n`,
        },
      }),
    );
    expect(reg.workspaceFilePath).toBeNull();
    expect(reg.organization().slug).toBe('default');
    expect(reg.entry('solo').workspace).toBe('default');
    expect(loadWorkspaceFile(reg.rootDir).file).toBeNull();
  });

  it('rejects projects that point at undeclared workspaces or a foreign organization', () => {
    expect(() =>
      ProjectRegistry.discover(
        repo({
          projects: {
            x: `slug: x\nname: X\nworkspace: ghost\nlayers: [api]\nenvs: { default: local, available: [local] }\n`,
          },
        }),
      ),
    ).toThrow(/workspace "ghost"/);
    expect(() =>
      ProjectRegistry.discover(
        repo({
          projects: {
            y: `slug: y\nname: Y\norganization: other\nlayers: [api]\nenvs: { default: local, available: [local] }\n`,
          },
        }),
      ),
    ).toThrow(/organization "other"/);
  });
});
