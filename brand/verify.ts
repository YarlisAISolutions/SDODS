/**
 * Verify the brand against the built sites, in both themes.
 *
 * This exists because "the SVG looks right" is not the same claim as "the page looks right". The
 * failure being fixed was invisible in the asset and only appeared once the asset met a dark
 * background, so the check has to happen on the rendered page.
 *
 *   node --import tsx brand/verify.ts apps/docs/out
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
  const root = resolve(process.argv[2] ?? 'apps/docs/out');
  if (!existsSync(root)) throw new Error(`no build at ${root} — run the site build first`);

  const outDir = join(import.meta.dirname, 'verify');
  mkdirSync(outDir, { recursive: true });

  const server = serve(root);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };

  const browser = await chromium.launch();
  try {
    for (const theme of ['light', 'dark'] as const) {
      // fumadocs and next-themes both persist the choice in localStorage under `theme`, so set it
      // before the app boots rather than clicking a toggle after paint.
      const context = await browser.newContext({ colorScheme: theme, deviceScaleFactor: 2 });
      await context.addInitScript(`localStorage.setItem('theme', '${theme}')`);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

      const path = join(outDir, `docs-${theme}.png`);
      await page.screenshot({ path, clip: { x: 0, y: 0, width: 1280, height: 620 } });
      console.log(`  ${theme.padEnd(5)} ${path}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('brand verify — captured the docs home page in both themes');
}

await main();
