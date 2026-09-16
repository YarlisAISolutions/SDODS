import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createMemoryDb, getProjectBySlug, listSchedules, type SdodsDb } from '@sdods/db';
import { buildServer } from '../src/index.js';

/**
 * Create, import and delete, exercised against the real CLI: `resolveCliBin` finds
 * `packages/cli/bin/sdods.js`, which runs the live source through tsx. These routes are thin
 * wrappers around that binary, so stubbing it would test nothing.
 */

function workspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sdods-lifecycle-'));
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","private":true,"type":"module"}');
  writeFileSync(
    join(root, 'sdods.workspace.yaml'),
    [
      'organization: { slug: acme, name: Acme }',
      'workspaces:',
      '  - { slug: web, name: Web, organization: acme }',
      '  - { slug: mobile, name: Mobile, organization: acme }',
      'defaultWorkspace: web',
      '',
    ].join('\n'),
  );
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

/** A project directory outside the workspace, standing in for a colleague's checkout. */
function foreignProject(dir: string, slug: string) {
  mkdirSync(join(dir, 'envs'), { recursive: true });
  mkdirSync(join(dir, 'features'), { recursive: true });
  mkdirSync(join(dir, '.auth', 'local'), { recursive: true });
  writeFileSync(
    join(dir, 'sdods.project.yaml'),
    [
      `slug: ${slug}`,
      'organization: someoneelse',
      'workspace: theirspace',
      `name: Imported ${slug}`,
      'description: came from elsewhere',
      'layers: [ui, api]',
      'envs: { default: local, available: [local] }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'envs', 'local.yaml'),
    'ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n',
  );
  writeFileSync(
    join(dir, 'features', 'health.feature'),
    '@api @smoke\nFeature: Health\n  Scenario: ok\n    Given the API is reachable\n',
  );
  writeFileSync(join(dir, '.env.example'), 'TOKEN=\n');
  writeFileSync(join(dir, '.env.local'), 'TOKEN=hunter2\n');
  writeFileSync(join(dir, '.auth', 'local', 'state.json'), '{"cookies":[]}');
  return dir;
}

/**
 * Multipart body with the fields before the file, which is the order the import route needs:
 * @fastify/multipart streams parts in order and `req.file()` stops at the first file, so a field
 * sent after it is never read.
 */
function multipartZip(
  fields: Record<string, string>,
  file: { name: string; body: Buffer },
): { body: Buffer; type: string } {
  const boundary = `----sdods${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

describe('project lifecycle', () => {
  let app: FastifyInstance;
  let adb: SdodsDb;
  let root: string;
  let cookie = '';
  let csrf = '';
  const auth = () => ({ cookie, 'x-csrf-token': csrf });

  beforeAll(async () => {
    root = workspaceRoot();
    adb = createMemoryDb();
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
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0]!;
    csrf = setup.json().csrfToken;
  }, 60_000);

  afterAll(async () => app.close());

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/projects', headers: auth(), payload });

  it('keeps the description the caller sent', async () => {
    // The regression this fixes: CreateProjectBody used to drop every key it did not name, so a
    // project created from the web form came back as a bare scaffold.
    const res = await create({
      slug: 'shop',
      name: 'Shop',
      description: 'the storefront',
      layers: ['ui', 'api'],
      testId: 'data-test',
    });
    expect(res.statusCode).toBe(201);
    const yaml = readFileSync(join(root, 'projects', 'shop', 'sdods.project.yaml'), 'utf8');
    expect(yaml).toContain('description: the storefront');
    expect(yaml).toContain('testIdAttribute: data-test');
  }, 60_000);

  it('rejects a key it does not understand instead of silently dropping it', async () => {
    const res = await create({ slug: 'typo', testIdAttribute: 'data-test' });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/testIdAttribute/);
  });

  it('refuses a workspace the workspace file does not declare', async () => {
    // The DB is not the authority. ProjectRegistry.discover throws for *every* project when one
    // names an undeclared workspace, so accepting this would break the whole registry on reload.
    // POST /api/workspaces declares in the file now, so a DB-only row is made directly: that is
    // what a workspace removed from the yaml leaves behind.
    const orgs = await app.hierarchy.organizations();
    await app.hierarchy.createWorkspace({
      organizationId: orgs[0]!.id,
      slug: 'db-only',
      name: 'DB only',
    });
    const res = await create({ slug: 'poison', workspace: 'db-only' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/sdods\.workspace\.yaml/);
    expect(existsSync(join(root, 'projects', 'poison'))).toBe(false);
  });

  it('accepts a project in a workspace created through the API', async () => {
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth(),
      payload: { slug: 'fresh', name: 'Fresh' },
    });
    expect(ws.statusCode).toBe(201);
    const res = await create({ slug: 'fresh-app', workspace: 'fresh' });
    expect(res.statusCode).toBe(201);
    expect(existsSync(join(root, 'projects', 'fresh-app', 'sdods.project.yaml'))).toBe(true);
  });

  it('refuses to save a project into an undeclared workspace', async () => {
    // Same trap as on create, reached through Settings. The check has to happen before the write:
    // reloadRegistry() throws for every project once one names a workspace the file does not
    // declare, so a saved bad value empties the whole dashboard.
    const before = readFileSync(join(root, 'projects', 'shop', 'sdods.project.yaml'), 'utf8');
    const current = await app.inject({
      method: 'GET',
      url: '/api/projects/shop',
      headers: { cookie },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/shop',
      headers: auth(),
      payload: { config: { ...current.json().config, workspace: 'db-only' } },
    });
    expect(res.statusCode).toBe(422);
    expect(readFileSync(join(root, 'projects', 'shop', 'sdods.project.yaml'), 'utf8')).toBe(before);
    // And the registry is still intact, which is the failure that mattered.
    const listed = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
  });

  describe('import', () => {
    const importBody = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/api/projects/import',
        headers: auth(),
        payload: { kind: 'path', ...payload },
      });

    let source = '';
    beforeAll(() => {
      source = foreignProject(join(mkdtempSync(join(tmpdir(), 'sdods-src-')), 'acme'), 'acme');
    });

    it('reports what it would do without writing anything', async () => {
      const res = await importBody({ source, slug: 'acme-preview', dryRun: true });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        slug: 'acme-preview',
        name: 'Imported acme',
        layers: ['ui', 'api'],
        envs: ['local'],
        workspace: 'web',
      });
      expect(existsSync(join(root, 'projects', 'acme-preview'))).toBe(false);
    }, 60_000);

    it('re-homes the project and leaves its secrets behind', async () => {
      const res = await importBody({ source, workspace: 'mobile' });
      expect(res.statusCode).toBe(201);
      const dir = join(root, 'projects', 'acme');
      const yaml = readFileSync(join(dir, 'sdods.project.yaml'), 'utf8');
      // Keeping the source's organization/workspace would make discover reject the registry.
      expect(yaml).toContain('organization: acme');
      expect(yaml).toContain('workspace: mobile');
      expect(yaml).toContain('description: came from elsewhere');
      expect(existsSync(join(dir, '.env.example'))).toBe(true);
      expect(existsSync(join(dir, '.env.local'))).toBe(false);
      expect(existsSync(join(dir, '.auth'))).toBe(false);

      const listed = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
      expect(listed.json().map((p: { slug: string }) => p.slug)).toContain('acme');
    }, 60_000);

    it('answers a slug collision with 409 so the client can rename', async () => {
      const res = await importBody({ source });
      expect(res.statusCode).toBe(409);
    }, 60_000);

    describe('zip upload', () => {
      let zip: Buffer;
      beforeAll(() => {
        const dir = mkdtempSync(join(tmpdir(), 'sdods-zip-'));
        foreignProject(join(dir, 'zipped'), 'zipped');
        const out = join(dir, 'zipped.zip');
        execFileSync('zip', ['-qr', out, '.'], { cwd: join(dir, 'zipped') });
        zip = readFileSync(out);
      });

      const post = (fields: Record<string, string>, name = 'zipped.zip') => {
        const mp = multipartZip(fields, { name, body: zip });
        return app.inject({
          method: 'POST',
          url: '/api/projects/import',
          headers: { ...auth(), 'content-type': mp.type },
          payload: mp.body,
        });
      };

      it('previews an uploaded archive without writing it', async () => {
        const res = await post({ slug: 'zip-preview', dryRun: 'true' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ slug: 'zip-preview', source: 'zip' });
        expect(existsSync(join(root, 'projects', 'zip-preview'))).toBe(false);
      }, 60_000);

      it('imports it, re-homed and without its secrets', async () => {
        const res = await post({ workspace: 'mobile' });
        expect(res.statusCode).toBe(201);
        const dir = join(root, 'projects', 'zipped');
        expect(readFileSync(join(dir, 'sdods.project.yaml'), 'utf8')).toContain(
          'workspace: mobile',
        );
        expect(existsSync(join(dir, '.env.local'))).toBe(false);
        expect(existsSync(join(dir, '.auth'))).toBe(false);
      }, 60_000);

      it('refuses an upload that is not a zip', async () => {
        const res = await post({}, 'project.tar.gz');
        expect(res.statusCode).toBe(400);
      });
    });
  });

  describe('delete', () => {
    it('requires the confirmation to equal the slug', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/projects/shop?confirm=shp',
        headers: auth(),
      });
      expect(res.statusCode).toBe(400);
      expect(existsSync(join(root, 'projects', 'shop'))).toBe(true);
    });

    it('trashes the directory, keeps the row, and takes the schedules with it', async () => {
      // A schedule left behind keeps firing: syncFromRegistry only upserts, and the scheduler arms
      // every row it finds without checking that the project still exists.
      const row = await getProjectBySlug(adb.db, 'shop');
      const added = await app.inject({
        method: 'POST',
        url: '/api/schedules',
        headers: auth(),
        payload: { project: 'shop', name: 'nightly', cron: '0 2 * * *', tags: '@regression' },
      });
      expect(added.statusCode).toBeLessThan(300);
      expect(await listSchedules(adb.db, row!.id)).toHaveLength(1);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/projects/shop?confirm=shop',
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, slug: 'shop', schedulesRemoved: 1 });

      expect(existsSync(join(root, 'projects', 'shop'))).toBe(false);
      const trashed = readdirSync(join(root, '.sdods', 'trash'));
      expect(trashed.some((d) => d.startsWith('shop-'))).toBe(true);
      // The features came with it, so the delete is recoverable by hand.
      expect(
        existsSync(
          join(
            root,
            '.sdods',
            'trash',
            trashed.find((d) => d.startsWith('shop-'))!,
            'sdods.project.yaml',
          ),
        ),
      ).toBe(true);

      expect(await listSchedules(adb.db, row!.id)).toHaveLength(0);
      // The row survives: runs, results and insights all reference project_id.
      const after = await getProjectBySlug(adb.db, 'shop');
      expect(after?.id).toBe(row!.id);
      expect(after?.archived).toBe(true);

      const listed = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
      expect(listed.json().map((p: { slug: string }) => p.slug)).not.toContain('shop');
    }, 60_000);

    it('404s for a project that is not there', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/projects/ghost?confirm=ghost',
        headers: auth(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('brings the row back when the slug is re-created', async () => {
      // upsertProject only writes `archived` on insert, so an existing row keeps the flag unless
      // the create path clears it -- otherwise the project is live but reads as archived forever.
      const res = await create({ slug: 'shop', name: 'Shop again' });
      expect(res.statusCode).toBe(201);
      const row = await getProjectBySlug(adb.db, 'shop');
      expect(row?.archived).toBe(false);
    }, 60_000);
  });
});
