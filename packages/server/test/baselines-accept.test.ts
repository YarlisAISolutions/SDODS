import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { VisualFailure } from '@sdods/contracts';
import { scenarioFiles } from '@sdods/contracts';
import { createMemoryDb } from '@sdods/db';
import { buildServer } from '../src/index.js';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'sdods-baselines-'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(root, 'sdods.workspace.yaml'),
    `organization: { slug: acme, name: Acme }\nworkspaces:\n  - { slug: web, name: Web, organization: acme }\ndefaultWorkspace: web\n`,
  );
  const dir = join(root, 'projects', 'shop');
  mkdirSync(join(dir, 'envs'), { recursive: true });
  writeFileSync(
    join(dir, 'sdods.project.yaml'),
    `slug: shop\nname: shop\nlayers: [ui, api]\nenvs: { default: local, available: [local] }\n`,
  );
  writeFileSync(
    join(dir, 'envs', 'local.yaml'),
    `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n`,
  );
  return root;
}

/** A PNG header is all the accept path reads; the bytes only have to round-trip. */
const png = (tag: string) =>
  Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from(tag)]);

/** A run directory as the runtime leaves it after a failed visual check. */
function seedRun(root: string, runId: string, over: Partial<VisualFailure> = {}) {
  const runDir = join(root, '.sdods/runs', runId);
  const attempt = join(runDir, 'shop', 'fp1', 'r0');
  const rp = 'shop--ui--chromium';
  mkdirSync(join(attempt, 'visual', rp), { recursive: true });
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({ runId, projectSlug: 'shop', env: 'local', trigger: 'ci' }),
  );
  for (const phase of ['actual', 'expected', 'diff'] as const)
    writeFileSync(join(attempt, scenarioFiles.visualImage(rp, 'home', phase)), png(phase));
  const rel = (phase: 'actual' | 'expected' | 'diff') =>
    `shop/fp1/r0/${scenarioFiles.visualImage(rp, 'home', phase)}`;
  const record: VisualFailure = {
    name: 'home',
    snapshot: 'home.png',
    project: 'shop',
    runnerProject: rp,
    platform: 'linux',
    fingerprint: 'fp1',
    scenarioName: 'Home matches',
    featureUri: 'features/home.feature',
    retry: 0,
    stepIndex: 1,
    reason: 'changed',
    baseline: `features/__screenshots__/${rp}/linux/home.png`,
    actual: rel('actual'),
    expected: rel('expected'),
    diff: rel('diff'),
    diffPixels: 42,
    diffRatio: 0.05,
    maxDiffPixelRatio: 0.01,
    recordedAt: new Date().toISOString(),
    ...over,
  };
  writeFileSync(
    join(attempt, scenarioFiles.visualFailure(rp, 'home')),
    JSON.stringify(record, null, 2),
  );
  return { runDir, attempt };
}

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie'] ?? '').split(';')[0]!;

describe('visual baseline routes', () => {
  let app: FastifyInstance;
  let root: string;
  let admin = { cookie: '', csrf: '' };
  const users: Record<string, { cookie: string; csrf: string }> = {};

  beforeAll(async () => {
    root = repo();
    app = await buildServer({
      adb: createMemoryDb(),
      config: {
        rootDir: root,
        projectsDir: join(root, 'projects'),
        artifactsDir: join(root, '.sdods/runs'),
        authDisabled: false,
        sessionSecret: 'test-secret-test-secret-test-secret',
        maxConcurrentRuns: 1,
        ingestMaxMb: 5,
      },
      logger: false,
      scheduler: false,
      minimal: true,
    });
    await app.ready();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { token: app.setupState.token, username: 'admin', password: 'Admin#12345' },
    });
    expect(setup.statusCode).toBe(200);
    admin = { cookie: cookieOf(setup), csrf: setup.json().csrfToken };
    const ws = (
      await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: admin.cookie } })
    ).json() as Array<{ id: string; slug: string }>;
    const web = ws.find((w) => w.slug === 'web')!;
    for (const role of ['viewer', 'editor'] as const) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
        payload: { username: `${role}1`, password: 'Member#12345', role },
      });
      expect(created.statusCode, created.body).toBe(201);
      const add = await app.inject({
        method: 'POST',
        url: `/api/workspaces/${web.id}/members`,
        headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
        payload: { userId: created.json().id, role },
      });
      expect(add.statusCode, add.body).toBe(200);
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: `${role}1`, password: 'Member#12345' },
      });
      users[role] = { cookie: cookieOf(login), csrf: login.json().csrfToken };
    }
  });
  afterAll(async () => app.close());

  const as = (who: { cookie: string; csrf: string }) => ({
    cookie: who.cookie,
    'x-csrf-token': who.csrf,
  });
  const baseline = () =>
    join(root, 'projects/shop/features/__screenshots__/shop--ui--chromium/linux/home.png');

  it('lists the failed checks of a run with their image URLs', async () => {
    seedRun(root, 'run-list');
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/run-list/baselines',
      headers: as(users.viewer!),
    });
    expect(res.statusCode, res.body).toBe(200);
    const [f] = res.json().failures;
    expect(f).toMatchObject({ name: 'home', platform: 'linux', reason: 'changed' });
    expect(f.diffUrl).toBe(
      '/api/runs/run-list/files/shop/fp1/r0/visual/shop--ui--chromium/home-diff.png',
    );
  });

  it('refuses a viewer', async () => {
    seedRun(root, 'run-viewer');
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/run-viewer/baselines/accept',
      headers: as(users.viewer!),
      payload: { names: ['home'] },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(baseline())).toBe(false);
  });

  it('lets an editor accept: copies the actual image to the platform the run happened on', async () => {
    const { attempt } = seedRun(root, 'run-accept');
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/run-accept/baselines/accept',
      headers: as(users.editor!),
      payload: { names: ['home'] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().accepted).toEqual([
      expect.objectContaining({
        name: 'home',
        platform: 'linux',
        created: true,
        baseline: 'features/__screenshots__/shop--ui--chromium/linux/home.png',
      }),
    ]);
    expect(readFileSync(baseline())).toEqual(
      readFileSync(join(attempt, 'visual/shop--ui--chromium/home-actual.png')),
    );
  });

  it('rejects an empty body, an unknown name and a record pointing outside __screenshots__', async () => {
    seedRun(root, 'run-bad');
    const post = (id: string, payload: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/runs/${id}/baselines/accept`,
        headers: as(users.editor!),
        payload: payload as Record<string, unknown>,
      });
    expect((await post('run-bad', {})).statusCode).toBe(400);
    expect((await post('run-bad', { names: ['nope'] })).statusCode).toBe(400);

    seedRun(root, 'run-escape', { baseline: 'sdods.project.yaml' });
    const before = readFileSync(join(root, 'projects/shop/sdods.project.yaml'), 'utf8');
    expect((await post('run-escape', { all: true })).statusCode).toBe(400);
    expect(readFileSync(join(root, 'projects/shop/sdods.project.yaml'), 'utf8')).toBe(before);
  });

  it('needs the features:write scope on a token', async () => {
    seedRun(root, 'run-token');
    const created = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: as(admin),
      payload: { name: 'read-only', scopes: ['runs:read', 'artifacts:read'] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/run-token/baselines/accept',
      headers: { authorization: `Bearer ${created.json().token}` },
      payload: { all: true },
    });
    expect(res.statusCode).toBe(403);
  });
});
