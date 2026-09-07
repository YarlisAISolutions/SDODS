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

  it('the lockup carries the tagline from brand.json', () => {
    const { tagline } = loadBrand();
    const lockups = outputs().filter((o) => o.path.endsWith('sdods-logo.svg'));
    expect(lockups.length).toBeGreaterThan(0);
    for (const l of lockups) expect(l.content).toContain(tagline);
  });
});
