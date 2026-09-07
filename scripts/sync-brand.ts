/**
 * One source of truth for the brand: edit `brand/sdods.svg`, `brand/mark.svg` and
 * `brand/brand.json` only. Everything else is generated.
 *
 * Run automatically before `docs:build` and `www:build`; also available as `bun run brand:sync`.
 * `--check` exits 2 on drift, for CI, the same way `sync-roadmap.ts` does.
 *
 * Why generated rather than hand-copied: the lockup existed as six duplicated files and one of
 * them drifted. `packages/web/public/sdods-logo.svg` still said "Orchestration & Deployment
 * System" while the two websites said "Delivery System" -- the product's own dashboard disagreed
 * with its marketing site for months, because a rebrand commit updated three copies and missed the
 * fourth.
 *
 * Rasterising uses Playwright's chromium, already a root devDependency and already how
 * `apps/docs/scripts/preview-art.tsx` turns SVG into PNG. `rsvg-convert` is not a repo assumption
 * and is on no CI runner.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolveRepoRoot();
function resolveRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

const SRC = join(repoRoot, 'brand');

export interface Brand {
  name: string;
  tagline: string;
  description: string;
  palette: Record<string, string>;
}

export function loadBrand(): Brand {
  return JSON.parse(readFileSync(join(SRC, 'brand.json'), 'utf8')) as Brand;
}

/**
 * Bake `currentColor` down to a literal for contexts that cannot inherit one.
 *
 * An SVG loaded through `<img src=…>` is an isolated document: `currentColor` resolves against the
 * SVG's own root, not the page, so a theme-aware inline component is the only way to track the
 * page. Standalone files therefore ship a fixed ink, plus a `prefers-color-scheme` block so a
 * favicon still adapts in browser chrome.
 */
export function bake(svg: string, ink: string, opts: { adaptive?: boolean } = {}): string {
  const out = svg.replace(/currentColor/g, ink);
  if (!opts.adaptive) return out;
  // Only meaningful for files the browser renders directly, e.g. the favicon.
  return out.replace(
    '<style>',
    `<style>\n    @media (prefers-color-scheme: dark) { .ink { fill: #E6E9EE; } .rule { stroke: #E6E9EE; } .tag { fill: #E6E9EE; } }`,
  );
}

/** Short content hash, so a changed brand is never masked by a week-long CDN cache. */
export function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

interface Output {
  /** Repo-relative destination. */
  path: string;
  content: string;
}

/** Everything generated from the source, as (path, content) pairs. */
export function outputs(): Output[] {
  const brand = loadBrand();
  const lockup = readFileSync(join(SRC, 'sdods.svg'), 'utf8').replace(
    />Test automation you can defend\.</,
    `>${brand.tagline}<`,
  );
  const mark = readFileSync(join(SRC, 'mark.svg'), 'utf8');

  const ink = brand.palette.ink;
  const lockupLight = bake(lockup, ink);
  const markAdaptive = bake(mark, ink, { adaptive: true });

  const siteDirs = ['apps/www/public/img', 'apps/docs/public/img'];
  const out: Output[] = [];

  for (const dir of siteDirs) {
    out.push({ path: `${dir}/sdods-logo.svg`, content: lockupLight });
    out.push({ path: `${dir}/sdods-mark.svg`, content: bake(mark, ink) });
    out.push({ path: `${dir}/favicon.svg`, content: markAdaptive });
  }

  // The README renders on github.com, which has its own dark mode and no way to influence it.
  out.push({ path: 'docs/assets/sdods-logo.svg', content: lockupLight });
  out.push({ path: 'docs/assets/sdods-mark.svg', content: bake(mark, ink) });
  out.push({ path: 'docs/assets/sdods-favicon.svg', content: markAdaptive });

  // The web UI serves this from its own public dir. This is the copy that had drifted.
  out.push({ path: 'packages/web/public/sdods-logo.svg', content: lockupLight });

  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const generated = outputs();
  const drift: string[] = [];
  let written = 0;

  for (const { path, content } of generated) {
    const full = join(repoRoot, path);
    const current = existsSync(full) ? readFileSync(full, 'utf8') : null;
    if (current === content) continue;
    if (check) {
      drift.push(path);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    written += 1;
  }

  if (check) {
    if (!drift.length) {
      console.log('sync-brand — every generated file matches brand/');
      return;
    }
    console.error(`sync-brand — ${drift.length} file(s) differ from brand/`);
    for (const p of drift) console.error(`  ${p}`);
    console.error('\nrun: bun run brand:sync');
    process.exit(2);
  }

  console.log(`sync-brand — ${written} file(s) written from brand/`);
  for (const { path } of generated) console.log(`  ${path}`);
}

// Guarded so the drift test can import `outputs()` without running the sync.
if (import.meta.url === `file://${process.argv[1]}`) main();
