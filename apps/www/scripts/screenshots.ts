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
  // `networkidle` is the wrong wait for the questions pages: they call the community service, which
  // on a blocked or slow network never goes idle and hangs the capture. Those wait for their own content
  // to be on the page instead, which is the thing being photographed.
  for (const [name, path, width, height, settle] of [
    ['home-desktop', '/', 1280, 800, 'idle'],
    ['home-mobile', '/', 390, 844, 'idle'],
    ['feedback-desktop', '/feedback/', 1280, 800, 'idle'],
    ['questions-desktop', '/questions/', 1280, 900, 'h3'],
    ['questions-mobile', '/questions/', 390, 844, 'h3'],
    ['questions-tags', '/questions/tags/', 1280, 900, 'idle'],
    ['questions-people', '/questions/users/', 1280, 900, 'idle'],
    ['questions-use-cases', '/questions/use-cases/', 1280, 900, 'idle'],
    ['questions-thread', '/questions/heal-expect-hidden-is-never-healed/', 1280, 900, 'idle'],
    ['questions-tag', '/questions/tags/heal/', 1280, 900, 'idle'],
    ['questions-person', '/questions/users/tomas-brekke/', 1280, 900, 'idle'],
    ['questions-thread-dark', '/questions/heal-expect-hidden-is-never-healed/', 1280, 900, 'idle'],
    ['questions-desktop-dark', '/questions/', 1280, 900, 'h3'],
  ] as const) {
    const page = await browser.newPage({
      viewport: { width, height },
      colorScheme: name.endsWith('-dark') ? 'dark' : 'light',
    });
    if (settle === 'idle') {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    } else {
      await page.goto(`${base}${path}`, { waitUntil: 'load' });
      await page.waitForSelector(settle, { timeout: 15_000 });
    }
    await page.screenshot({ path: join(dest, `${name}.png`), fullPage: true });
    console.log(`wrote screenshots/${name}.png`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
