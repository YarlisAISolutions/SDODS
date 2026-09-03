/**
 * Verifies that every internal link and image in the exported site resolves to a file in out/.
 * Fails the docs build on the first broken link.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'cheerio';

const outDir = resolve(import.meta.dirname, '..', 'out');
const basePath = '/AutoMax';

function walk(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (f.endsWith('.html')) acc.push(p);
  }
  return acc;
}

function resolvesInOut(href: string): boolean {
  let path = href.split('#')[0]!.split('?')[0]!;
  if (path === '') return true;
  if (path.startsWith(basePath)) path = path.slice(basePath.length);
  if (!path.startsWith('/')) return true; // relative links are resolved by the browser; ignore
  const candidates = [
    join(outDir, path),
    join(outDir, path, 'index.html'),
    join(outDir, path.replace(/\/$/, '') + '.html'),
    join(outDir, path.replace(/\/$/, '')),
  ];
  return candidates.some((c) => existsSync(c));
}

if (!existsSync(outDir)) {
  console.error('check-links — out/ does not exist; run next build first');
  process.exit(1);
}
const files = walk(outDir);
const broken: Array<{ file: string; href: string }> = [];
let checked = 0;
for (const file of files) {
  const $ = load(readFileSync(file, 'utf8'));
  const hrefs = [
    ...$('a[href]')
      .map((_, el) => $(el).attr('href')!)
      .get(),
    ...$('img[src]')
      .map((_, el) => $(el).attr('src')!)
      .get(),
  ];
  for (const href of hrefs) {
    if (/^(https?:|mailto:|tel:|data:|#)/.test(href)) continue;
    checked++;
    if (!resolvesInOut(href)) broken.push({ file: file.replace(outDir + '/', ''), href });
  }
}
if (broken.length) {
  console.error(`check-links — ${broken.length} broken link(s) out of ${checked}:`);
  for (const b of broken) console.error(`  ${b.file} → ${b.href}`);
  process.exit(1);
}
console.log(`check-links — ${checked} internal link(s) in ${files.length} page(s), none broken`);
