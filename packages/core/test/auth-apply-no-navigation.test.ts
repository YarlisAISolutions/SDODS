import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthStateCache } from '../src/fixtures/auth.js';

/**
 * #99: `AuthStateCache.apply` used to restore localStorage by `page.goto(origin)`. An app that
 * sends a signed-in visitor away from `/` on the client then had a redirect chain still running
 * when the step returned, and the scenario's first `page.goto` was aborted (`net::ERR_ABORTED` /
 * "interrupted by another navigation").
 *
 * The app below does exactly that: once booted (50 ms), `/` redirects to `/workspace` and that to
 * `/workspace/home` when the visitor carries the token. The property checked is the one the
 * scenario depends on — the first `goto` after applying a cached session lands, repeatedly, and the
 * session is actually there when it does.
 */

const TOKEN = 'cached-session-token';

const shell = (title: string, next?: string) => `<!doctype html><title>${title}</title>
<h1>${title}</h1>
<script>
  window.__sawTokenAtBoot = localStorage.getItem('token');
  ${
    next
      ? `setTimeout(() => { if (localStorage.getItem('token')) location.href = '${next}'; }, 50);`
      : ''
  }
</script>`;

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const body =
      path === '/'
        ? shell('root', '/workspace')
        : path === '/workspace'
          ? shell('workspace', '/workspace/home')
          : path === '/workspace/home'
            ? shell('home')
            : path === '/other'
              ? shell('other')
              : undefined;
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

const user = { id: '1', username: 'u', password: 'x', role: 'member', index: 0 } as any;
const auth = { strategy: 'form' } as any;

function cachedSession(): AuthStateCache {
  const root = mkdtempSync(join(tmpdir(), 'sdods-auth-apply-'));
  const cache = new AuthStateCache({
    project: { root, auth: { maxAgeMinutes: 60, strategy: 'form', storageState: true } },
    env: { name: 'local' },
  } as any);
  cache.save(user, {
    cookies: [
      {
        name: 'sid',
        value: 'cookie-session',
        domain: '127.0.0.1',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [{ origin, localStorage: [{ name: 'token', value: TOKEN }] }],
  });
  return cache;
}

describe('AuthStateCache.apply leaves no navigation running (#99)', () => {
  it('the first goto after applying a cached session is never aborted', async () => {
    const cache = cachedSession();
    const failures: string[] = [];
    const iterations = 10;
    for (let i = 0; i < iterations; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        expect(await cache.apply({ context, page, user, auth, browser })).toBe(true);
        await page.goto(`${origin}/other`, { waitUntil: 'load' });
        // Hold long enough for a leftover 50 ms redirect hop to have fired and moved us on.
        await new Promise((r) => setTimeout(r, 250));
        const url = new URL(page.url()).pathname;
        if (url !== '/other') failures.push(`#${i}: ended on ${url}`);
        const token = await page.evaluate(() => localStorage.getItem('token'));
        if (token !== TOKEN) failures.push(`#${i}: token is ${token}`);
        const cookies = await context.cookies(origin);
        if (!cookies.some((c) => c.name === 'sid')) failures.push(`#${i}: no sid cookie`);
      } catch (e) {
        failures.push(`#${i}: ${(e as Error).message.split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
    expect(failures, `${failures.length}/${iterations} runs failed`).toEqual([]);
  });

  it('plants localStorage before the app boots, without navigating the page', async () => {
    const cache = cachedSession();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await cache.apply({ context, page, user, auth, browser });
      expect(page.url()).toBe('about:blank');
      await page.goto(`${origin}/other`);
      expect(await page.evaluate(() => (window as any).__sawTokenAtBoot)).toBe(TOKEN);
      // Storage is per origin, so a second tab sees the same session.
      const second = await context.newPage();
      await second.goto(`${origin}/other`);
      expect(await second.evaluate(() => localStorage.getItem('token'))).toBe(TOKEN);
    } finally {
      await context.close();
    }
  });

  it('does not plant into other origins', async () => {
    const cache = cachedSession();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await cache.apply({ context, page, user, auth, browser });
      const otherOrigin = origin.replace('127.0.0.1', 'localhost');
      await page.goto(`${otherOrigin}/other`);
      expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    } finally {
      await context.close();
    }
  });

  it('an app that signs out mid-scenario is not silently signed back in', async () => {
    const cache = cachedSession();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await cache.apply({ context, page, user, auth, browser });
      await page.goto(`${origin}/other`);
      expect(await page.evaluate(() => localStorage.getItem('token'))).toBe(TOKEN);
      // Sign out the way apps do: wipe storage, then navigate.
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${origin}/other`);
      expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
      expect(await page.evaluate(() => (window as any).__sawTokenAtBoot)).toBeNull();
    } finally {
      await context.close();
    }
  });

  it('plants straight into a page that is already on the origin', async () => {
    const cache = cachedSession();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/other`);
      await cache.apply({ context, page, user, auth, browser });
      expect(new URL(page.url()).pathname).toBe('/other');
      expect(await page.evaluate(() => localStorage.getItem('token'))).toBe(TOKEN);
    } finally {
      await context.close();
    }
  });
});
