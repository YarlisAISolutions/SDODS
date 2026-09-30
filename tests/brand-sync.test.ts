import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { outputs, loadBrand } from '../scripts/sync-brand.js';

const repoRoot = join(import.meta.dirname, '..');

describe('brand sync', () => {
  it('every generated file matches brand/', () => {
    const drift = outputs()
      .filter(({ path, content }) => {
        const full = join(repoRoot, path);
        return !existsSync(full) || readFileSync(full, 'utf8') !== content;
      })
      .map((o) => o.path);
    expect(drift, 'run: bun run brand:sync').toEqual([]);
  });

  it('no copy still carries the retired backronym', () => {
    // packages/web drifted for months saying "Deployment System" while both sites said
    // "Delivery System" — the dashboard disagreed with the marketing site. One source now.
    const stale = outputs().filter(({ content }) =>
      /Orchestration &(amp;)? De(livery|ployment)/.test(content),
    );
    expect(stale.map((s) => s.path)).toEqual([]);
  });

  it('the inline components carry the same geometry as brand/', () => {
    // The components restate the geometry by hand -- they must, because an <img> cannot inherit
    // currentColor or the page font. Nothing structural stops them drifting, and the spacing fix
    // had to be applied in both places, so assert the numbers agree.
    //
    // Each component file holds SdodsMark then SdodsLockup, so it is compared against mark.svg
    // followed by sdods.svg.
    const shape = (svg: string) => ({
      arcs: [...svg.matchAll(/d="(M-?\d+ -?\d+ A [^"]+)"/g)].map((m) => m[1]),
      radii: [...svg.matchAll(/r="(\d+)"/g)].map((m) => m[1]),
    });
    const mark = shape(readFileSync(join(repoRoot, 'brand/mark.svg'), 'utf8'));
    const lockup = shape(readFileSync(join(repoRoot, 'brand/sdods.svg'), 'utf8'));
    const want = { arcs: [...mark.arcs, ...lockup.arcs], radii: [...mark.radii, ...lockup.radii] };

    for (const rel of [
      'apps/www/components/sdods-mark.tsx',
      'apps/docs/components/sdods-mark.tsx',
      'packages/web/src/components/sdods-mark.tsx',
    ]) {
      const got = shape(readFileSync(join(repoRoot, rel), 'utf8'));
      expect(got.arcs, `${rel}: arcs differ from brand/`).toEqual(want.arcs);
      expect(got.radii, `${rel}: circle radii differ from brand/`).toEqual(want.radii);
    }
  });

  it('the wordmark halves sit where brand/sdods.svg puts them', () => {
    // The gap either side of the centre O is the thing that broke: at x=62 the lockup read as
    // "SD ODS", 30.2 units before the O against 14.0 after it.
    const source = readFileSync(join(repoRoot, 'brand/sdods.svg'), 'utf8');
    const xs = [...source.matchAll(/x="(\d+)"\s+y="(?:94|129)"/g)].map((m) => m[1]);
    expect(xs).toEqual(['78', '272', '237']);
    for (const rel of [
      'apps/www/components/sdods-mark.tsx',
      'apps/docs/components/sdods-mark.tsx',
      'packages/web/src/components/sdods-mark.tsx',
    ]) {
      const c = readFileSync(join(repoRoot, rel), 'utf8');
      const got = [...c.matchAll(/x="(\d+)"\n\s+y="(?:94|129)"/g)].map((m) => m[1]);
      expect(got, `${rel}: wordmark x differ from brand/sdods.svg`).toEqual(xs);
    }
  });

  it('every brand SVG is well-formed XML', () => {
    // An <img> (the README on github.com, every <img src=".../sdods-logo.svg">) parses SVG as
    // strict XML; the inline components use the forgiving HTML parser. A "--" inside a comment in
    // brand/sdods.svg was therefore invisible on the sites and broke every <img> of the lockup,
    // including the README header and the web UI's tab icon.
    const files = [
      ...outputs(),
      ...['brand/sdods.svg', 'brand/mark.svg'].map((path) => ({
        path,
        content: readFileSync(join(repoRoot, path), 'utf8'),
      })),
    ];
    const bad = files.filter(({ content }) =>
      [...content.matchAll(/<!--([\s\S]*?)-->/g)].some((m) => m[1]!.includes('--')),
    );
    expect(bad.map((b) => b.path)).toEqual([]);
  });

  it('the tab icon fills its square', () => {
    // The bare mark is 2:1, so as a favicon it was a sliver in an empty square, and the web UI used
    // the full lockup. The favicon is the mark on a full-bleed tile.
    const icons = outputs().filter((o) => /favicon\.svg$/.test(o.path));
    expect(icons.map((i) => i.path)).toContain('packages/web/public/favicon.svg');
    for (const i of icons) expect(i.content).toMatch(/<rect width="128" height="128"/);
    expect(readFileSync(join(repoRoot, 'packages/web/index.html'), 'utf8')).toContain(
      'href="/favicon.svg"',
    );
  });

  it('the lockup carries the tagline from brand.json', () => {
    const { tagline } = loadBrand();
    const lockups = outputs().filter((o) => o.path.endsWith('sdods-logo.svg'));
    expect(lockups.length).toBeGreaterThan(0);
    for (const l of lockups) expect(l.content).toContain(tagline);
  });
});
