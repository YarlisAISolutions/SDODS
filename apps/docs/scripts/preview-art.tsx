/**
 * Renders every illustration to a PNG so it can be reviewed the way a reader sees it, without
 * starting the docs site. Output goes to a temporary directory (default `.art-preview/`),
 * which is not part of the site.
 *
 *   node --import tsx apps/docs/scripts/preview-art.tsx [outDir]
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { SCENES } from '../components/art/scenes';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, '..', '.art-preview'));

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; padding: 20px; background: #fff; font: 14px ui-sans-serif, system-ui }
  .s { margin-bottom: 18px } h3 { font: 600 13px ui-monospace; margin: 0 0 6px; color: #334155 }
  .wrap { max-width: 760px }
</style><div class="wrap">${Object.entries(SCENES)
  .map(
    ([name, Scene]) =>
      `<div class="s"><h3>${name}</h3>${renderToStaticMarkup(createElement(Scene))}</div>`,
  )
  .join('')}</div>`;

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 820, height: 1000 },
    deviceScaleFactor: 2,
  });
  await page.setContent(html);
  for (const scene of await page.locator('.s').all()) {
    const name = await scene.locator('h3').innerText();
    await scene.screenshot({ path: join(outDir, `${name}.png`) });
  }
  await browser.close();
  console.log(`rendered ${Object.keys(SCENES).length} scenes to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
