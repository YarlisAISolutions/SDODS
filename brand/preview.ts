/**
 * Render the candidate lockups on both backgrounds, so a choice is made by looking rather than by
 * reading SVG source.
 *
 * Uses Playwright's chromium, which is already a root devDependency and is how
 * `apps/docs/scripts/preview-art.tsx` rasterises SVG today. `rsvg-convert` is on this machine but
 * is not a repo assumption and is on no CI runner.
 *
 *   node --import tsx brand/preview.ts
 */
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const outDir = join(here, 'candidates', 'preview');

/** The two grounds the mark has to survive: the www light background and the docs dark one. */
const GROUNDS = [
  { name: 'light', bg: '#f8fafc', fg: '#0f172a' },
  { name: 'dark', bg: '#0a0a0a', fg: '#e2e8f0' },
];

/** Sizes that matter: hero, header, favicon. A mark that dies at 16px is not a mark. */
const WIDTHS = [520, 240, 96];

async function main() {
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(join(here, 'candidates')).filter((f) => f.endsWith('.svg'));
  if (!files.length) throw new Error('no candidate SVGs found');

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });

  for (const ground of GROUNDS) {
    // One sheet per ground, every candidate at every size, so they can be compared side by side.
    const rows = files
      .map((file) => {
        const svg = readFileSync(join(here, 'candidates', file), 'utf8');
        const cols = WIDTHS.map(
          (w) => `<div class="cell"><div style="width:${w}px">${svg}</div><b>${w}px</b></div>`,
        ).join('');
        return `<section><h2>${file}</h2><div class="row">${cols}</div></section>`;
      })
      .join('');

    await page.setContent(
      `<html><body>
        <style>
          body { margin:0; padding:40px; background:${ground.bg}; color:${ground.fg};
                 font:13px ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif; }
          section { margin-bottom:44px; }
          h2 { font:600 12px ui-monospace,Menlo,monospace; opacity:.5; margin:0 0 14px;
               letter-spacing:.08em; text-transform:uppercase; }
          .row { display:flex; align-items:flex-end; gap:40px; flex-wrap:wrap; }
          .cell { display:flex; flex-direction:column; gap:8px; }
          .cell b { font:500 11px ui-monospace,Menlo,monospace; opacity:.4; }
          svg { display:block; width:100%; height:auto; }
        </style>
        ${rows}
      </body></html>`,
    );

    const path = join(outDir, `${ground.name}.png`);
    await page.locator('body').screenshot({ path });
    console.log(`  ${ground.name.padEnd(6)} ${path}`);
  }

  await browser.close();
  console.log(`brand preview — ${files.length} candidate(s) on ${GROUNDS.length} grounds`);
}

await main();
