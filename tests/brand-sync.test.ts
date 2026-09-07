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

  it('the lockup carries the tagline from brand.json', () => {
    const { tagline } = loadBrand();
    const lockups = outputs().filter((o) => o.path.endsWith('sdods-logo.svg'));
    expect(lockups.length).toBeGreaterThan(0);
    for (const l of lockups) expect(l.content).toContain(tagline);
  });
});
