/**
 * Verify the brand against the built sites, in both themes.
 *
 * This exists because "the SVG looks right" is not the same claim as "the page looks right". The
 * failure being fixed was invisible in the asset and only appeared once the asset met a dark
 * background, so the check has to happen on the rendered page.
 *
 *   node --import tsx brand/verify.ts apps/docs/out          # a local build
 *   node --import tsx brand/verify.ts https://docs.sdods.com  # what is actually deployed
 *
 * The URL form matters after a deploy. A green workflow says the build shipped, not that the page
 * renders — and the failure this whole pipeline exists to fix was invisible everywhere except on a
 * rendered dark page.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

/** Serve the static export the way Firebase Hosting does: clean URLs, index.html fallback. */
function serve(root: string) {
  return createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const candidates = [join(root, url), join(root, url, 'index.html'), join(root, `${url}.html`)];
    const file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
}

async function main() {
  const target = process.argv[2] ?? 'apps/docs/out';
  const live = /^https?:\/\//.test(target);
  const label = live ? new URL(target).hostname.split('.')[0] : 'docs';

  const outDir = join(import.meta.dirname, 'verify');
  mkdirSync(outDir, { recursive: true });

  // A local build is served the way Firebase Hosting serves it; a URL is used as given.
  let base = target;
  let server: ReturnType<typeof serve> | null = null;
  if (!live) {
    const root = resolve(target);
    if (!existsSync(root)) throw new Error(`no build at ${root} — run the site build first`);
    server = serve(root);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  }

  const browser = await chromium.launch();
  try {
    for (const theme of ['light', 'dark'] as const) {
      // fumadocs and next-themes both persist the choice in localStorage under `theme`, so set it
      // before the app boots rather than clicking a toggle after paint.
      const context = await browser.newContext({ colorScheme: theme, deviceScaleFactor: 2 });
      await context.addInitScript(`localStorage.setItem('theme', '${theme}')`);
      const page = await context.newPage();
      // 'networkidle' never settles on the live site — analytics and the search index keep it
      // busy — so wait for the lockup itself, which is the thing being verified.
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator('h1 svg').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(600);

      const path = join(outDir, `${label}-${theme}.png`);
      await page.screenshot({ path, clip: { x: 0, y: 0, width: 1280, height: 620 } });
      console.log(`  ${theme.padEnd(5)} ${path}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server?.close();
  }
  console.log(`brand verify — captured ${live ? target : 'the local build'} in both themes`);
}

await main();
