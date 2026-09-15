import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
// Commented-out blocks (the sponsor badge) are not rendered, so their images are not checked.
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

const isRemote = (url: string) => /^(https?:)?\/\//.test(url) || url.startsWith('data:');
/** `srcset` can list several candidates, each optionally followed by a width or density. */
const candidates = (srcset: string) =>
  srcset
    .split(',')
    .map((c) => c.trim().split(/\s+/)[0])
    .filter((c): c is string => Boolean(c));

describe('README assets', () => {
  it('every local image the README shows exists', () => {
    const local = [
      ...[...readme.matchAll(/\bsrc="([^"]+)"/g)].map((m) => m[1]!),
      ...[...readme.matchAll(/\bsrcset="([^"]+)"/g)].flatMap((m) => candidates(m[1]!)),
      ...[...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]!),
    ].filter((u) => !isRemote(u));
    expect(local.length, 'the README should show at least the logo').toBeGreaterThan(0);
    const missing = local.filter((p) => !existsSync(join(repoRoot, p.replace(/^\.\//, ''))));
    expect(missing).toEqual([]);
  });

  it('each <picture> pairs its light image with a -dark source for dark mode', () => {
    // GitHub serves README images through camo as isolated documents: an SVG cannot see the page
    // theme, so dark mode needs its own file, chosen by <source media="(prefers-color-scheme: dark)">.
    const pictures = [...readme.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((m) => m[1]!);
    expect(pictures.length).toBeGreaterThan(0);
    for (const picture of pictures) {
      const light = /<img[^>]*\bsrc="([^"]+)"/.exec(picture)?.[1];
      const dark = /<source[^>]*media="\(prefers-color-scheme: dark\)"[^>]*srcset="([^"]+)"/.exec(
        picture,
      )?.[1];
      expect(light, picture).toBeDefined();
      expect(dark, `${light}: no dark source`).toBeDefined();
      if (isRemote(light!)) continue;
      expect(dark, `${light}: the dark source should be the -dark twin`).toBe(
        light!.replace(/(\.[a-z0-9]+)$/i, '-dark$1'),
      );
    }
  });
});
