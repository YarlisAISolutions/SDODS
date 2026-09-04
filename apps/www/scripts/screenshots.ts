/**
 * Headless screenshots of the exported landing site at desktop and mobile widths.
 * Serves apps/www/out on a local port, captures, writes to apps/www/screenshots/.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out');
const dest = join(root, 'screenshots');
if (!existsSync(join(out, 'index.html'))) {
  console.error('apps/www/out is missing; run `bun run www:build` first');
  process.exit(2);
}
mkdirSync(dest, { recursive: true });

const types: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  let file = join(out, urlPath);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});

await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
try {
  for (const [name, width, height] of [
    ['home-desktop', 1280, 800],
    ['home-mobile', 390, 844],
    ['feedback-desktop', 1280, 800],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    const path = name.startsWith('feedback') ? '/feedback/' : '/';
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(dest, `${name}.png`), fullPage: true });
    console.log(`wrote screenshots/${name}.png`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
