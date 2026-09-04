/**
 * Renders every page of the web UI (with mocks) in headless chromium and saves PNGs to
 * packages/web/screenshots/. Usage: `bun run --filter @automax/web screenshots` while
 * `VITE_USE_MOCKS=1 vite --port 5199` is running, or let this script start it.
 */
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'screenshots');
mkdirSync(outDir, { recursive: true });
const port = Number(process.env.PORT ?? 5199);
const base = `http://127.0.0.1:${port}`;

const pages: Array<[string, string]> = [
  ['dashboard', '/'],
  ['workspaces', '/workspaces'],
  ['projects', '/projects'],
  ['project-form', '/projects/demo-shop/edit'],
  ['environments', '/projects/demo-shop/envs'],
  ['datasets', '/projects/demo-shop/datasets'],
  ['user-pool', '/projects/demo-shop/pool'],
  ['processes', '/projects/demo-shop/processes'],
  ['runs', '/runs'],
  ['run-detail', '/runs/run-2'],
  ['scenario-steps', '/runs/run-2/scenarios/s-inv-list'],
  ['feature-editor', '/projects/demo-shop/editor/auth/login.feature'],
  ['recorder', '/projects/demo-shop/recorder'],
  ['agents', '/agents'],
  ['integrations', '/projects/demo-shop/integrations'],
  ['schedules', '/schedules'],
  ['users', '/users'],
  ['settings-tokens', '/settings/tokens'],
  ['settings-mcp', '/settings/mcp'],
];

async function waitFor(url: string, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server not reachable at ${url}`);
}

async function main() {
  let server: ReturnType<typeof spawn> | null = null;
  let reachable = true;
  try {
    await waitFor(base, 1500);
  } catch {
    reachable = false;
  }
  if (!reachable) {
    server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd: join(here, '..'),
      env: { ...process.env, VITE_USE_MOCKS: '1' },
      stdio: 'ignore',
    });
    await waitFor(base);
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  const written: string[] = [];
  for (const [name, path] of pages) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    written.push(file);
  }
  await browser.close();
  server?.kill();
  console.log(written.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
