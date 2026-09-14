/**
 * Stages the files that a published install needs but that live outside the packages themselves.
 * Everything written here is generated and gitignored; run by scripts/publish-npm.sh before
 * packing, and available as `bun run publish:assets`.
 *
 *  1. `packages/cli/templates/` — the assets `sdods init` copies into a new workspace. In a
 *     checkout `init` reads these from the repo root; a published install has no checkout, so
 *     without this step `sdods init` yields a workspace with no demo project while the installer
 *     and docs both say to run `sdods run -p demo-shop`. The staged layout mirrors the repo root
 *     so `init` resolves the same relative paths either way.
 *  2. `packages/server/web/` — the built dashboard. `sdods serve` looks for it under `rootDir`,
 *     but nothing depends on `@sdods/web` (it is private and unpublished), so off a registry
 *     install the server would fall through to its "web UI is not built yet" placeholder.
 *     Vendoring it into @sdods/server keeps it to one published package.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repoRoot, 'packages/cli/templates');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Same exclusions as the copy in init.ts: local auth state, installed deps, generated specs and
// real .env files must never end up in a published tarball. Matched on the path within the copied
// tree, not the absolute path, so a checkout living under a directory called node_modules (or
// .sdods) does not silently exclude everything.
const relFilter = (root: string) => (p: string) => {
  const rel = relative(root, p).replace(/\\/g, '/');
  if (!rel) return true;
  return (
    !/(^|\/)(\.auth|node_modules|\.features-gen|\.sdods)(\/|$)/.test(rel) &&
    !/(^|\/)\.env\.(?!example)[^/]*$/.test(rel)
  );
};

const staged: string[] = [];

const demo = join(repoRoot, 'projects/demo-shop');
if (!existsSync(demo)) throw new Error(`missing ${demo} — the demo project is required`);
cpSync(demo, join(out, 'projects/demo-shop'), { recursive: true, filter: relFilter(demo) });
staged.push('projects/demo-shop/');

// Skills are not staged: the user-facing set lives in packages/cli/skills/, which the package ships
// directly ("files"), and `init` copies from there rather than from this repository's
// .claude/skills (which also holds skills for releasing SDODS itself).

// init.ts has inline fallbacks for these two, but shipping the real ones keeps a published
// workspace identical to one scaffolded from a checkout.
for (const file of ['.env.example', 'docker-compose.yml']) {
  const from = join(repoRoot, file);
  if (!existsSync(from)) continue;
  copyFileSync(from, join(out, file));
  staged.push(file);
}

console.log(`publish assets — staged ${staged.length} item(s) into packages/cli/templates`);
for (const s of staged) console.log(`  ${s}`);

// 2. the built dashboard, vendored into @sdods/server (see the header note).
const webDist = join(repoRoot, 'packages/web/dist');
const webOut = join(repoRoot, 'packages/server/web');
rmSync(webOut, { recursive: true, force: true });
if (!existsSync(webDist)) {
  throw new Error(`missing ${webDist} — run \`bun run web:build\` before staging publish assets`);
}
// Sourcemaps are ~6x the bundle here and point at sources that do not ship; drop them.
cpSync(webDist, webOut, { recursive: true, filter: (p) => !p.endsWith('.map') });
console.log('publish assets — staged packages/web/dist into packages/server/web');
