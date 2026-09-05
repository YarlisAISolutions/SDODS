/**
 * Builds a publish-ready copy of each @sdods/* package under a staging directory, and prints the
 * staged paths (one per line) for scripts/publish-npm.sh to pack and publish from.
 *
 * Why this exists: every package keeps `exports` pointing at `src/*.ts` so the workspace runs
 * straight off TypeScript, and declares the real, compiled mapping under `publishConfig.exports`.
 * Applying `publishConfig` field overrides at pack time is a pnpm/yarn feature — verified that
 * neither npm 10, npm 11 nor `bun pm pack` does it. Publishing as-is would ship manifests whose
 * `exports` point at `src/` files that `files: ["dist", ...]` excludes, so every
 * `import '@sdods/core/...'` would fail to resolve. Staging applies the overrides ourselves.
 *
 * Nothing in the working tree is modified: each package is copied out, manifest rewritten in the
 * copy. Run via `bun run publish:stage`, or as part of scripts/publish-npm.sh.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = ['contracts', 'core', 'db', 'mcp', 'integrations', 'agents', 'server', 'cli'];
const outRoot = process.argv[2] ?? join(repoRoot, '.publish-stage');

type Manifest = Record<string, unknown> & {
  name: string;
  version: string;
  files?: string[];
  publishConfig?: Record<string, unknown>;
};

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Manifest;

// Real versions, so `workspace:*` can be pinned to what is actually being published.
const versions = new Map<string, string>();
for (const p of PKGS) {
  const m = read(join(repoRoot, 'packages', p, 'package.json'));
  versions.set(m.name, m.version);
}

// npm reads these from publishConfig itself; everything else there is a field override.
const REGISTRY_KEYS = new Set(['access', 'registry', 'tag', 'provenance']);

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const staged: string[] = [];
for (const p of PKGS) {
  const pkgDir = join(repoRoot, 'packages', p);
  const manifest = read(join(pkgDir, 'package.json'));
  const dest = join(outRoot, p);
  mkdirSync(dest, { recursive: true });

  // 1. apply publishConfig field overrides (exports, main, types, …), keeping registry keys.
  const publishConfig = manifest.publishConfig ?? {};
  const registryOnly: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(publishConfig)) {
    if (REGISTRY_KEYS.has(k)) registryOnly[k] = v;
    else manifest[k] = v;
  }
  manifest.publishConfig = registryOnly;

  // 2. pin workspace protocol deps to the versions being published alongside.
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const deps = manifest[field] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!range.startsWith('workspace:')) continue;
      const version = versions.get(name);
      if (!version) throw new Error(`${manifest.name}: ${name} is workspace:* but not published`);
      deps[name] = version;
    }
  }
  // devDependencies are irrelevant to consumers and can carry workspace: ranges npm rejects.
  delete manifest.devDependencies;

  writeFileSync(join(dest, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

  // 3. copy exactly what `files` promises, plus the conventional extras npm always includes.
  //    Sourcemaps are dropped: they point at `src/` paths that the tarball does not ship.
  for (const entry of [...(manifest.files ?? []), 'README.md', 'LICENSE']) {
    const from = join(pkgDir, entry);
    if (!existsSync(from)) continue;
    cpSync(from, join(dest, entry), { recursive: true, filter: (f) => !f.endsWith('.map') });
  }
  // Apache-2.0 requires the licence text to travel with the distribution, and only the repo root
  // carries it.
  if (!existsSync(join(dest, 'LICENSE')))
    copyFileSync(join(repoRoot, 'LICENSE'), join(dest, 'LICENSE'));

  staged.push(dest);
  console.error(`  staged ${manifest.name}@${manifest.version}`);
}

// stdout carries only the paths, so the shell can consume them.
console.log(staged.join('\n'));
