import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BrowserSessionManager } from '../src/browser/session.js';
import type { BrowserDriver } from '../src/browser/types.js';
import type { ResolvedForBrowser } from '../src/browser/config.js';

/**
 * Session lifetime is the operational risk here: a leaked headless browser outlives the run and
 * nobody notices until the machine is out of memory. The driver is faked so the bookkeeping is
 * asserted without launching anything.
 */
const repoRoot = join(tmpdir(), 'sdods-browser-session-test');
const artifactsDir = join(repoRoot, '.sdods', 'runs');

const resolved: ResolvedForBrowser = {
  project: { slug: 'demo-shop' },
  env: { name: 'staging' },
  runtime: { repoRoot, runId: 'run-1', artifactsDir },
};

function manager(opts: { maxSessions?: number; idleMs?: number } = {}) {
  const closed: string[] = [];
  let n = 0;
  const mgr = new BrowserSessionManager({
    rootDir: repoRoot,
    ...opts,
    resolveConfig: async () => resolved,
    createDriver: async () => {
      const id = `d${++n}`;
      const driver: BrowserDriver = {
        info: () => ({ server: 'Fake', version: '0' }),
        listTools: async () => [],
        call: async () => ({ text: 'ok', images: [], isError: false }),
        close: async () => {
          closed.push(id);
        },
      };
      return driver;
    },
  });
  return { mgr, closed };
}

describe('BrowserSessionManager', () => {
  it('starts empty and closes cleanly when it never opened anything', async () => {
    const { mgr } = manager();
    expect(mgr.list()).toEqual([]);
    expect(mgr.has('default')).toBe(false);
    expect(await mgr.close('nope')).toBe(false);
    await expect(mgr.closeAll()).resolves.toBeUndefined();
  });

  it('ensure opens on first use and reuses afterwards', async () => {
    const { mgr, closed } = manager();
    const a = await mgr.ensure('default', { project: 'demo-shop' });
    const b = await mgr.ensure('default', { project: 'demo-shop' });
    expect(a).toBe(b);
    expect(mgr.list()).toHaveLength(1);
    expect(closed).toEqual([]);
  });

  it('records where the session writes and what it is bound to', async () => {
    const { mgr } = manager();
    await mgr.open({ sessionId: 's1', project: 'demo-shop', env: 'staging', browser: 'edge' });
    const [info] = mgr.list();
    expect(info.browser).toBe('edge');
    expect(info.project).toBe('demo-shop');
    expect(info.outputDir).toContain(join('.sdods', 'browser'));
    expect(info.outputDir).not.toContain(join('.sdods', 'runs'));
  });

  it('reopening the same id replaces the old browser rather than leaking it', async () => {
    const { mgr, closed } = manager();
    await mgr.open({ sessionId: 'default', project: 'demo-shop' });
    await mgr.open({ sessionId: 'default', project: 'demo-shop' });
    expect(closed).toEqual(['d1']);
    expect(mgr.list()).toHaveLength(1);
  });

  it('refuses to fork browsers without limit', async () => {
    const { mgr } = manager({ maxSessions: 2 });
    await mgr.open({ sessionId: 'a', project: 'demo-shop' });
    await mgr.open({ sessionId: 'b', project: 'demo-shop' });
    await expect(mgr.open({ sessionId: 'c', project: 'demo-shop' })).rejects.toThrow(
      /At most 2 browser sessions/,
    );
  });

  it('reaps a session nobody has used', async () => {
    const { mgr, closed } = manager({ idleMs: 20 });
    await mgr.open({ sessionId: 'idle', project: 'demo-shop' });
    await new Promise((r) => setTimeout(r, 60));
    expect(closed).toEqual(['d1']);
    expect(mgr.list()).toEqual([]);
  });

  it('use postpones the reap', async () => {
    const { mgr, closed } = manager({ idleMs: 60 });
    await mgr.open({ sessionId: 'busy', project: 'demo-shop' });
    await new Promise((r) => setTimeout(r, 40));
    mgr.get('busy');
    await new Promise((r) => setTimeout(r, 40));
    expect(closed).toEqual([]);
    expect(mgr.list()).toHaveLength(1);
    await mgr.closeAll();
  });

  it('closeAll stops every browser it started', async () => {
    const { mgr, closed } = manager();
    await mgr.open({ sessionId: 'a', project: 'demo-shop' });
    await mgr.open({ sessionId: 'b', project: 'demo-shop' });
    await mgr.closeAll();
    expect(closed.sort()).toEqual(['d1', 'd2']);
    expect(mgr.list()).toEqual([]);
  });
});

rmSync(repoRoot, { recursive: true, force: true });
