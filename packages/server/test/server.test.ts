import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createMemoryDb } from '@sdods/db';
import { buildServer, nextTimes } from '../src/index.js';

/** Fake `sdods run` child: prints lines, exits 0 (or 1 when the tags mention "fail"), obeys SIGTERM. */
function fakeSpawn(_config: unknown, args: string[]): ChildProcess {
  const child = new EventEmitter() as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (s?: string) => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let killed = false;
  child.kill = (signal?: string) => {
    killed = true;
    setTimeout(() => child.emit('exit', null, signal ?? 'SIGTERM'), 5);
    return true;
  };
  const shouldFail = args.some((a) => a.includes('fail'));
  const slow = args.some((a) => a.includes('slow'));
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from('Running 3 tests\n[1/3] ok\n'));
    setTimeout(
      () => {
        if (killed) return;
        child.stdout.emit('data', Buffer.from('[3/3] done\n'));
        child.emit('exit', shouldFail ? 1 : 0, null);
      },
      slow ? 2000 : 20,
    );
  }, 5);
  return child;
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'sdods-srv-'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(root, 'sdods.workspace.yaml'),
    `organization: { slug: acme, name: Acme }\nworkspaces:\n  - { slug: web, name: Web, organization: acme }\n  - { slug: mobile, name: Mobile, organization: acme }\ndefaultWorkspace: web\n`,
  );
  const mk = (slug: string, ws?: string) => {
    const dir = join(root, 'projects', slug);
    mkdirSync(join(dir, 'envs'), { recursive: true });
    mkdirSync(join(dir, 'features', 'auth'), { recursive: true });
    writeFileSync(
      join(dir, 'sdods.project.yaml'),
      `slug: ${slug}\nname: ${slug}\n${ws ? `workspace: ${ws}\n` : ''}layers: [ui, api]\nenvs: { default: local, available: [local] }\nmodules:\n  - { name: auth, testingTypes: [smoke] }\nschedules:\n  - { name: nightly, cron: '0 2 * * *', tags: '@regression' }\n`,
    );
    writeFileSync(
      join(dir, 'envs', 'local.yaml'),
      `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n`,
    );
    writeFileSync(
      join(dir, 'features', 'auth', 'login.feature'),
      `@ui @smoke\nFeature: Login\n  Scenario: ok\n    Given I am on the login page\n`,
    );
  };
  mk('shop');
  mk('app', 'mobile');
  return root;
}

function png(w: number, h: number, color: number): string {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    p.data[i * 4] = color;
    p.data[i * 4 + 1] = color;
    p.data[i * 4 + 2] = color;
    p.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(p).toString('base64');
}

describe('SDODS server', () => {
  let app: FastifyInstance;
  let root: string;
  let adminCookie = '';
  let adminCsrf = '';
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    String(res.headers['set-cookie'] ?? '').split(';')[0]!;

  beforeAll(async () => {
    root = repo();
    const adb = createMemoryDb();
    app = await buildServer({
      adb,
      config: {
        rootDir: root,
        projectsDir: join(root, 'projects'),
        artifactsDir: join(root, '.sdods/runs'),
        authDisabled: false,
        sessionSecret: 'test-secret-test-secret-test-secret',
        maxConcurrentRuns: 1,
      },
      runner: { spawn: fakeSpawn },
      logger: false,
      scheduler: false,
      minimal: true,
    });
    await app.ready();
  });
  afterAll(async () => app.close());

  it('bootstraps the first admin through /setup and makes them org owner', async () => {
    expect(app.setupState.token).toBeTruthy();
    const status = await app.inject({ method: 'GET', url: '/api/auth/setup-status' });
    expect(status.json()).toEqual({ needsSetup: true });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { token: 'nope', username: 'admin', password: 'Admin#12345' },
    });
    expect(bad.statusCode).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { token: app.setupState.token, username: 'admin', password: 'Admin#12345' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ownerOf).toEqual(['acme']);
    adminCookie = cookieOf(res);
    adminCsrf = res.json().csrfToken;
    expect(app.setupState.token).toBeNull();
  });

  it('rejects unauthenticated API calls and wrong passwords', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('logs in, exposes csrf + workspaces with roles, and enforces csrf on writes', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'Admin#12345' },
    });
    expect(login.statusCode).toBe(200);
    adminCookie = cookieOf(login);
    adminCsrf = login.json().csrfToken;
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: adminCookie },
    });
    expect(me.json().user.role).toBe('admin');
    const ws = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { cookie: adminCookie },
    });
    expect(
      ws
        .json()
        .map((w: { slug: string; role: string }) => `${w.slug}:${w.role}`)
        .sort(),
    ).toEqual(['mobile:admin', 'web:admin']);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: adminCookie },
      payload: { username: 'x', password: 'password123' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  let viewerCookie = '';
  let viewerCsrf = '';
  it('creates a viewer, grants workspace membership and filters projects by workspace role', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { username: 'vera', password: 'Viewer#12345', role: 'viewer' },
    });
    expect(created.statusCode).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'vera', password: 'Viewer#12345' },
    });
    viewerCookie = cookieOf(login);
    viewerCsrf = login.json().csrfToken;
    // no memberships yet → no workspaces, no projects
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/workspaces',
          headers: { cookie: viewerCookie },
        })
      ).json(),
    ).toEqual([]);
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: viewerCookie } })
      ).json(),
    ).toEqual([]);
    const wsList = (
      await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: adminCookie } })
    ).json() as Array<{ id: string; slug: string }>;
    const web = wsList.find((w) => w.slug === 'web')!;
    const add = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${web.id}/members`,
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { userId: created.json().id, role: 'editor' },
    });
    expect(add.statusCode).toBe(200);
    const login2 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'vera', password: 'Viewer#12345' },
    });
    viewerCookie = cookieOf(login2);
    viewerCsrf = login2.json().csrfToken;
    const projects = (
      await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: viewerCookie } })
    ).json() as Array<{ slug: string; role: string }>;
    expect(projects.map((p) => `${p.slug}:${p.role}`)).toEqual(['shop:editor']); // app lives in the mobile workspace
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/projects/app',
          headers: { cookie: viewerCookie },
        })
      ).statusCode,
    ).toBe(403);
    // users:admin scope is not part of the editor scope set
    expect(
      (await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: viewerCookie } }))
        .statusCode,
    ).toBe(403);
  });

  it('creates a second workspace under the org and lists it with the creator as admin', async () => {
    const orgs = (
      await app.inject({ method: 'GET', url: '/api/orgs', headers: { cookie: adminCookie } })
    ).json() as Array<{ id: string; slug: string; role: string }>;
    expect(orgs[0]!.role).toBe('owner');
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${orgs[0]!.id}/workspaces`,
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { slug: 'qa', name: 'QA' },
    });
    expect(res.statusCode).toBe(201);
    const ws = (
      await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: adminCookie } })
    ).json() as Array<{ slug: string }>;
    expect(ws.map((w) => w.slug).sort()).toEqual(['mobile', 'qa', 'web']);
  });

  it('starts, streams and finishes a run through the fake runner; cancels a slow one', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { cookie: viewerCookie, 'x-csrf-token': viewerCsrf },
      payload: { project: 'shop', env: 'local', tags: '@smoke' },
    });
    expect(start.statusCode).toBe(202);
    const runId = start.json().runId as string;
    await new Promise((r) => setTimeout(r, 150));
    const detail = await app.inject({
      method: 'GET',
      url: `/api/runs/${runId}`,
      headers: { cookie: viewerCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(['passed', 'running']).toContain(detail.json().run.status);
    const list = await app.inject({
      method: 'GET',
      url: '/api/runs?project=shop',
      headers: { cookie: viewerCookie },
    });
    expect(list.json().some((r: { id: string }) => r.id === runId)).toBe(true);

    const slow = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { project: 'shop', tags: '@slow' },
    });
    const slowId = slow.json().runId as string;
    await new Promise((r) => setTimeout(r, 50));
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/runs/${slowId}/cancel`,
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
    });
    expect(cancel.json().ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(app.runManager.get(slowId)!.status).toBe('cancelled');
    // a failing run maps to status failed
    const failing = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { project: 'shop', tags: '@fail' },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(app.runManager.get(failing.json().runId)!.status).toBe('failed');
    // the log buffer replays with sequence numbers
    const job = app.runManager.get(runId)!;
    expect(job.log.since(0).map((l) => l.line)).toContain('[3/3] done');
  });

  it('validates features on write (tag taxonomy) and lists them by module', async () => {
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/features/auth/bad.feature',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { content: 'Feature: X\n  Scenario: no tags\n    Given nothing\n' },
    });
    expect(bad.statusCode).toBe(422);
    const good = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/features/auth/good.feature',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { content: '@ui @smoke\nFeature: X\n  Scenario: tagged\n    Given nothing\n' },
    });
    expect(good.statusCode).toBe(200);
    const list = (
      await app.inject({
        method: 'GET',
        url: '/api/projects/shop/features',
        headers: { cookie: adminCookie },
      })
    ).json() as Array<{ path: string; module: string | null }>;
    expect(list.find((f) => f.path.endsWith('good.feature'))?.module).toBe('auth');
    const escape = await app.inject({
      method: 'GET',
      url: '/api/projects/shop/features/../sdods.project.yaml',
      headers: { cookie: adminCookie },
    });
    expect([400, 403, 404]).toContain(escape.statusCode);
  });

  it('creates, uses and revokes API tokens; token scopes stay within the role', async () => {
    const tooMuch = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: viewerCookie, 'x-csrf-token': viewerCsrf },
      payload: { name: 'x', scopes: ['users:admin'] },
    });
    expect(tooMuch.statusCode).toBe(400);
    const created = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { name: 'ci', scopes: ['runs:read', 'runs:ingest'] },
    });
    expect(created.statusCode).toBe(201);
    const token = created.json().token as string;
    expect(token.startsWith('amx_')).toBe(true);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { project: 'shop' },
    });
    expect(denied.statusCode).toBe(403);
    const mint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'y', scopes: ['runs:read'] },
    });
    expect(mint.statusCode).toBe(403);
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${created.json().id}`,
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
    });
    expect(revoke.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/runs',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('diffs two screenshots of a run (padded canvases) and caches the result', async () => {
    const runId = 'diff-run';
    const dir = join(root, '.sdods/runs', runId, 'shop', 'abc', 'r0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '00-before.png'), Buffer.from(png(4, 4, 0), 'base64'));
    writeFileSync(join(dir, '00-after.png'), Buffer.from(png(6, 4, 255), 'base64'));
    const url = `/api/runs/${runId}/compare?before=shop/abc/r0/00-before.png&after=shop/abc/r0/00-after.png`;
    const res = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff.width).toBe(6);
    expect(res.json().mismatchPixels).toBeGreaterThan(0);
    expect(res.json().cached).toBe(false);
    expect(
      (await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } })).json().cached,
    ).toBe(true);
    const file = await app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/files/shop/abc/r0/00-before.png`,
      headers: { cookie: adminCookie },
    });
    expect(file.headers['content-type']).toBe('image/png');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/runs/${runId}/files/../../package.json`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(403);
  });

  it('mirrors yaml schedules, previews fire times and supports pause/resume', async () => {
    const n = await app.scheduler.syncFromRegistry(app.registry);
    expect(n).toBeGreaterThanOrEqual(2);
    const list = (
      await app.inject({
        method: 'GET',
        url: '/api/schedules?project=shop',
        headers: { cookie: adminCookie },
      })
    ).json() as Array<{ id: string; name: string; nextFireTimes: string[]; enabled: boolean }>;
    const nightly = list.find((s) => s.name === 'nightly')!;
    expect(nightly.nextFireTimes.length).toBe(5);
    const next = await app.inject({
      method: 'GET',
      url: '/api/schedules/next?cron=0%202%20*%20*%20*&tz=America/New_York&count=2',
      headers: { cookie: adminCookie },
    });
    expect(next.json().times.length).toBe(2);
    expect(nextTimes('not a cron')).toEqual([]);
    const pause = await app.inject({
      method: 'POST',
      url: `/api/schedules/${nightly.id}/pause`,
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
    });
    expect(pause.json().enabled).toBe(false);
    const created = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { project: 'shop', name: 'hourly', cron: '0 * * * *', tags: '@smoke' },
    });
    expect(created.statusCode).toBe(201);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: { project: 'shop', name: 'bad', cron: 'nope nope' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('serves health and audit for admins', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().ok).toBe(true);
    const audit = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie: adminCookie },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().some((a: { action: string }) => a.action === 'run.start')).toBe(true);
  });
});
