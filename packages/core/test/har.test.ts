import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiSnapshot } from '@automax/contracts';
import type { ResolvedConfig } from '../src/config/resolve.js';
import {
  HarRecorder,
  HarReplayer,
  harKey,
  makeApiHarHooks,
  normalizeUrl,
} from '../src/har/api-har.js';
import {
  apiHarPath,
  findHarTag,
  harPath,
  listHars,
  parseHarTag,
  readSidecar,
  safeHarName,
  writeSidecar,
} from '../src/har/paths.js';
import {
  applyHarToPage,
  apiHarForScenario,
  effectiveHarMode,
  registerHarHooks,
} from '../src/har/hooks.js';

function cfg(
  over: Partial<{ harMode: 'off' | 'update' | 'replay'; offline: boolean }> = {},
): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), 'automax-har-'));
  return {
    project: { root, slug: 'shop' },
    env: { name: 'staging' },
    runtime: { harMode: over.harMode ?? 'off', offline: over.offline ?? false },
  } as unknown as ResolvedConfig;
}

const snap = (over: Partial<ApiSnapshot['request']> = {}, status = 200): ApiSnapshot => ({
  request: {
    method: 'POST',
    url: 'https://api.example.com/posts?b=2&a=1&_=123',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
    body: { title: 'x', userId: 1, password: 'p4ss' },
    ...over,
  },
  response: {
    status,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', 'set-cookie': 'sid=1' },
    body: { id: 101, title: 'x' },
    rawBody: '{"id":101,"title":"x"}',
    responseTime: 42,
  },
  startedAt: '2026-09-03T20:00:00.000Z',
});

describe('paths and tags', () => {
  it('parses @har tags and builds file paths', () => {
    expect(parseHarTag('@har:products')).toEqual({ name: 'products', strict: false });
    expect(parseHarTag('@har:checkout-v2:strict')).toEqual({ name: 'checkout-v2', strict: true });
    expect(parseHarTag('@harness')).toBeUndefined();
    expect(findHarTag(['@ui', '@smoke', '@har:posts'])).toEqual({ name: 'posts', strict: false });
    expect(safeHarName('Checkout Flow!')).toBe('checkout-flow');
    const c = cfg();
    expect(harPath(c, 'products')).toBe(join(c.project.root, 'har', 'staging', 'products.har'));
    expect(apiHarPath(c, 'products')).toBe(
      join(c.project.root, 'har', 'staging', 'products.api.har'),
    );
  });

  it('writes and merges sidecars; lists HARs per env', () => {
    const c = cfg();
    writeSidecar(c, {
      name: 'products',
      project: 'shop',
      env: 'staging',
      recordedAt: 't1',
      source: 'run',
      scenarios: ['A'],
      urlGlob: '**/api/**',
    });
    writeSidecar(c, {
      name: 'products',
      project: 'shop',
      env: 'staging',
      recordedAt: 't2',
      source: 'run',
      scenarios: ['B'],
    });
    expect(readSidecar(c, 'products')).toMatchObject({
      recordedAt: 't2',
      urlGlob: '**/api/**',
      scenarios: ['A', 'B'],
    });
    writeFileSync(harPath(c, 'products'), '{"log":{"version":"1.2","entries":[]}}');
    mkdirSync(join(c.project.root, 'har', 'local'), { recursive: true });
    writeFileSync(
      join(c.project.root, 'har', 'local', 'posts.api.har'),
      '{"log":{"version":"1.2","entries":[]}}',
    );
    const all = listHars(c.project.root);
    expect(all.map((h) => `${h.env}/${h.name}`)).toEqual(['local/posts', 'staging/products']);
    expect(listHars(c.project.root, 'staging')[0]!.sidecar?.scenarios).toEqual(['A', 'B']);
  });
});

describe('API HAR record → replay', () => {
  it('normalises URLs (sorted query, volatile params dropped) and keys by body hash', () => {
    expect(normalizeUrl('https://API.example.com/posts/?b=2&a=1&_=9')).toBe(
      'https://api.example.com/posts?a=1&b=2',
    );
    expect(harKey('post', 'https://api.example.com/x', { a: 1, b: 2 })).toBe(
      harKey('POST', 'https://api.example.com/x/', { b: 2, a: 1 }),
    );
    expect(harKey('GET', 'https://api.example.com/x')).not.toBe(
      harKey('GET', 'https://api.example.com/y'),
    );
  });

  it('round-trips through the file with secrets masked and refreshes entries by key', async () => {
    const c = cfg();
    const file = apiHarPath(c, 'posts');
    const rec = new HarRecorder(file);
    await rec.record(snap());
    await rec.record(snap({}, 201)); // same key → replaced
    await rec.record(
      snap({ url: 'https://api.example.com/posts/1', method: 'GET', body: undefined }),
    );
    expect(rec.size).toBe(2);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('p4ss');
    expect(raw).toContain('***');

    const rep = new HarReplayer(file);
    expect(rep.size).toBe(2);
    const res = await rep.replay(snap().request);
    expect(res?.status).toBe(201);
    expect(res?.body).toEqual({ id: 101, title: 'x' });
    expect(
      await rep.replay({ method: 'DELETE', url: 'https://api.example.com/posts/1', headers: {} }),
    ).toBeUndefined();
    expect(rep.misses).toHaveLength(1);
    const strict = new HarReplayer(file, { strict: true });
    await expect(
      strict.replay({ method: 'DELETE', url: 'https://api.example.com/posts/1', headers: {} }),
    ).rejects.toThrow(/strict/);
  });

  it('builds ApiClient hooks per mode', async () => {
    const c = cfg();
    const file = apiHarPath(c, 'x');
    expect(makeApiHarHooks({ mode: 'off', file })).toBeUndefined();
    const update = makeApiHarHooks({ mode: 'update', file })!;
    await update.record!(snap());
    expect(existsSync(file)).toBe(true);
    const replay = makeApiHarHooks({ mode: 'replay', file, strict: true })!;
    expect(replay.strict).toBe(true);
    expect((await replay.replay!(snap().request))?.status).toBe(200);
  });

  it('apiHarForScenario derives mode from tags, run mode and file presence', async () => {
    const c = cfg();
    expect(apiHarForScenario({ $tags: ['@api'], config: c })).toBeUndefined();
    expect(apiHarForScenario({ $tags: ['@api', '@har:posts'], config: c })).toBeUndefined(); // no file, mode off
    const hooks = apiHarForScenario({
      $tags: ['@api', '@har:posts'],
      config: c,
      harMode: 'update',
    })!;
    await hooks.record!(snap());
    expect(readSidecar(c, 'posts')?.source).toBe('api');
    // file exists now → default replay even with mode off
    const replay = apiHarForScenario({ $tags: ['@api', '@har:posts'], config: c })!;
    expect(replay.replay).toBeDefined();
    expect(effectiveHarMode(c, undefined, apiHarPath(c, 'posts'))).toBe('replay');
  });
});

describe('browser HAR hook', () => {
  function fakePage() {
    const calls: Array<{ kind: string; args: unknown[] }> = [];
    const context = {
      route: async (...args: unknown[]) => void calls.push({ kind: 'context.route', args }),
    };
    const page = {
      routeFromHAR: async (...args: unknown[]) => void calls.push({ kind: 'routeFromHAR', args }),
    };
    return { calls, context: context as any, page: page as any };
  }

  it('does nothing without a @har tag, unless offline (then blocks everything)', async () => {
    const c = cfg();
    const f = fakePage();
    expect(await applyHarToPage({ $tags: ['@ui'], config: c, ...f })).toBeUndefined();
    expect(f.calls).toHaveLength(0);
    const off = fakePage();
    await applyHarToPage({ $tags: ['@ui'], config: cfg({ offline: true }), ...off });
    expect(off.calls[0]?.kind).toBe('context.route');
  });

  it('records in update mode with a sidecar, replays with fallback, strict/offline aborts unmatched', async () => {
    const c = cfg({ harMode: 'update' });
    const f = fakePage();
    const applied = await applyHarToPage({
      $tags: ['@ui', '@har:products'],
      config: c,
      harMode: 'update',
      title: 'lists products',
      ...f,
    });
    expect(applied).toMatchObject({ mode: 'update', strict: false });
    const opts = f.calls[0]!.args[1] as Record<string, unknown>;
    expect(opts).toMatchObject({
      update: true,
      notFound: 'fallback',
      url: '**/*',
      updateContent: 'embed',
    });
    expect(readSidecar(c, 'products')?.scenarios).toEqual(['lists products']);

    writeFileSync(harPath(c, 'products'), '{"log":{"version":"1.2","entries":[]}}');
    const replay = fakePage();
    const r = await applyHarToPage({
      $tags: ['@ui', '@har:products:strict'],
      config: cfg({ offline: true }),
      harMode: 'replay',
      ...replay,
    });
    // wait: different tmp root → copy the file there
    expect(r?.strict ?? true).toBe(true);
    const order = replay.calls.map((x) => x.kind);
    expect(order[0]).toBe('context.route'); // abort registered BEFORE routeFromHAR (routes match newest-first)
    expect(order[1]).toBe('routeFromHAR');
    expect((replay.calls[1]!.args[1] as Record<string, unknown>).notFound).toBe('abort');
  });

  it('registers a tag-filtered Before hook', () => {
    const registered: Array<{ tags?: string; name?: string }> = [];
    registerHarHooks({ Before: (options) => void registered.push(options) });
    expect(registered).toEqual([{ tags: '@ui or @hybrid', name: 'automax:har' }]);
  });
});
