import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createMemoryDb } from '@sdods/db';
import { buildServer } from '../src/index.js';
import { lastJsonLine } from '../src/services/agent-manager.js';

/**
 * Routes the web pages call after the UI wiring fixes: environment upsert, integrations save,
 * reading a recorded spec, and schedule history coming with the schedule.
 */
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'sdods-wiring-'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(root, 'sdods.workspace.yaml'),
    `organization: { slug: acme, name: Acme }\nworkspaces:\n  - { slug: web, name: Web, organization: acme }\ndefaultWorkspace: web\n`,
  );
  const dir = join(root, 'projects', 'shop');
  mkdirSync(join(dir, 'envs'), { recursive: true });
  mkdirSync(join(dir, 'recorded'), { recursive: true });
  writeFileSync(
    join(dir, 'sdods.project.yaml'),
    `slug: shop\nname: shop\nworkspace: web\nlayers: [ui, api]\nenvs: { default: local, available: [local] }\nmcp:\n  servers:\n    keep: { transport: http, url: http://localhost:9000/mcp }\n`,
  );
  writeFileSync(
    join(dir, 'envs', 'local.yaml'),
    `# local dev\nui: { baseUrl: http://localhost:3000 }\napi:\n  baseUrl: http://localhost:3000/api\n  auth: { type: bearer, tokenEnv: API_TOKEN }\nvars: { region: eu }\n`,
  );
  writeFileSync(join(dir, 'recorded', 'checkout.spec.ts'), `test('checkout', async () => {});\n`);
  return root;
}

describe('UI wiring routes', () => {
  let app: FastifyInstance;
  let root: string;
  let cookie = '';
  let csrf = '';
  const auth = () => ({ cookie, 'x-csrf-token': csrf });
  const shop = () => join(root, 'projects', 'shop');

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
    cookie = String(setup.headers['set-cookie']).split(';')[0]!;
    csrf = setup.json().csrfToken;
  });
  afterAll(async () => app.close());

  it('edits an environment in place without dropping auth, comments or unlisted keys', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/envs/local',
      headers: auth(),
      payload: {
        uiUrl: 'http://localhost:4000',
        apiUrl: 'http://localhost:4000/api',
        poolSize: 3,
        vars: { region: 'us' },
      },
    });
    expect(res.statusCode).toBe(200);
    const yaml = readFileSync(join(shop(), 'envs', 'local.yaml'), 'utf8');
    expect(yaml).toContain('# local dev');
    expect(yaml).toContain('tokenEnv: API_TOKEN');
    expect(yaml).toContain('http://localhost:4000/api');
    expect(yaml).toContain('poolSize: 3');
    expect(yaml).toContain('region: us');
  });

  it('creates a new environment and lists it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/envs/staging',
      headers: auth(),
      payload: { uiUrl: 'https://staging.example.com', apiUrl: 'https://staging.example.com/api' },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: '/api/projects/shop/envs',
      headers: { cookie },
    });
    expect(list.json().map((e: { name: string }) => e.name)).toEqual(['local', 'staging']);
  });

  it('rejects environment names that are not file-safe', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/envs/..%2Fescape',
      headers: auth(),
      payload: { uiUrl: 'https://x.example.com', apiUrl: 'https://x.example.com/api' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('saves one MCP server without removing the others, and validates first', async () => {
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/integrations',
      headers: auth(),
      payload: { mcp: { broken: { transport: 'http', url: 'not a url' } } },
    });
    expect(bad.statusCode).toBe(422);

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/integrations',
      headers: auth(),
      payload: {
        mcp: {
          added: { transport: 'stdio', command: 'npx', args: ['x'], envFrom: { T: 'TOKEN' } },
        },
        github: { enabled: true, owner: 'acme', repo: 'shop', tokenEnv: 'GITHUB_TOKEN' },
      },
    });
    expect(ok.statusCode).toBe(200);
    const view = await app.inject({
      method: 'GET',
      url: '/api/projects/shop/integrations',
      headers: { cookie },
    });
    expect(Object.keys(view.json().mcp).sort()).toEqual(['added', 'keep']);
    expect(view.json().github).toMatchObject({ owner: 'acme', repo: 'shop', enabled: true });

    const removed = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop/integrations',
      headers: auth(),
      payload: { mcp: { added: null } },
    });
    expect(removed.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/api/projects/shop/integrations',
      headers: { cookie },
    });
    expect(Object.keys(after.json().mcp)).toEqual(['keep']);
  });

  it('reads a recorded spec by file name and refuses anything else', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/shop/recorded/checkout.spec.ts',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: 'recorded/checkout.spec.ts' });
    for (const file of ['sdods.project.yaml', '..%2Fsdods.project.yaml', '.env.spec.ts']) {
      const bad = await app.inject({
        method: 'GET',
        url: `/api/projects/shop/recorded/${file}`,
        headers: { cookie },
      });
      expect(bad.statusCode, file).toBe(400);
    }
  });

  it('returns schedule history with the schedule', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: auth(),
      payload: { project: 'shop', name: 'nightly', cron: '0 2 * * *' },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    const res = await app.inject({
      method: 'GET',
      url: `/api/schedules/${id}`,
      headers: { cookie },
    });
    expect(res.json().history).toEqual([]);
    const paused = await app.inject({
      method: 'POST',
      url: `/api/schedules/${id}/pause`,
      headers: auth(),
    });
    expect(paused.json()).toEqual({ ok: true, enabled: false });
  });
});

describe('lastJsonLine', () => {
  it('takes the last JSON object line of --json output', () => {
    expect(lastJsonLine('recording…\n{"a":1}\nnoise\n{"spec":"x.spec.ts"}\n')).toEqual({
      spec: 'x.spec.ts',
    });
    expect(lastJsonLine('no json here')).toBeNull();
    expect(lastJsonLine('{broken')).toBeNull();
  });
});
