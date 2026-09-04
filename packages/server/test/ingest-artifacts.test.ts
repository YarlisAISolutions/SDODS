import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as tar from 'tar';

// The route must accept artifacts.tgz and hand the files found in the run dir to ingestRun;
// the DB side of ingest is covered by packages/db, so it is mocked here.
const ingestCalls: unknown[] = [];
vi.mock('@automax/db', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    ingestRun: vi.fn(async (_adb: unknown, input: unknown) => {
      ingestCalls.push(input);
      return { runId: (input as { runId: string }).runId, scenarios: 0 };
    }),
  };
});

const { createMemoryDb } = await import('@automax/db');
const { buildServer } = await import('../src/index.js');
const { extractArtifacts, ArchiveTooLargeError } =
  await import('../src/services/artifacts-archive.js');
const { resolveTraceViewerDir } = await import('../src/config.js');

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'automax-ingest-'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(root, 'automax.workspace.yaml'),
    `organization: { slug: acme, name: Acme }\nworkspaces:\n  - { slug: web, name: Web, organization: acme }\ndefaultWorkspace: web\n`,
  );
  const dir = join(root, 'projects', 'shop');
  mkdirSync(join(dir, 'envs'), { recursive: true });
  writeFileSync(
    join(dir, 'automax.project.yaml'),
    `slug: shop\nname: shop\nlayers: [ui, api]\nenvs: { default: local, available: [local] }\n`,
  );
  writeFileSync(
    join(dir, 'envs', 'local.yaml'),
    `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n`,
  );
  return root;
}

/** Build a .tgz whose entries include one path-traversal attempt. */
async function buildArchive(workDir: string): Promise<string> {
  const src = join(workDir, 'src');
  mkdirSync(join(src, 'shop', 'abc123', 'r0', 'api'), { recursive: true });
  writeFileSync(join(src, 'shop', 'abc123', 'r0', 'meta.json'), '{"fingerprint":"abc123"}');
  writeFileSync(join(src, 'shop', 'abc123', 'r0', 'api', '00-1-request.json'), '{"method":"GET"}');
  writeFileSync(
    join(src, 'messages.ndjson'),
    '{"testRunStarted":{"timestamp":{"seconds":1,"nanos":0}}}\n',
  );
  writeFileSync(join(workDir, 'evil.txt'), 'escaped');
  const archive = join(workDir, 'artifacts.tgz');
  await tar.c({ gzip: true, cwd: src, file: archive, preservePaths: true, portable: true }, [
    'shop',
    'messages.ndjson',
    '../evil.txt',
  ]);
  return archive;
}

function multipart(files: Array<{ name: string; body: Buffer }>): { body: Buffer; type: string } {
  const boundary = `----automax${Date.now()}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      f.body,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

describe('extractArtifacts', () => {
  it('extracts files, drops traversal entries and enforces the size cap', async () => {
    const work = mkdtempSync(join(tmpdir(), 'automax-tgz-'));
    const archive = await buildArchive(work);
    const out = join(work, 'out');
    mkdirSync(out);
    const res = await extractArtifacts(archive, out, 10 * 1024 * 1024);
    expect(res.files).toBe(3);
    expect(res.skipped).toBe(1);
    expect(existsSync(join(out, 'shop', 'abc123', 'r0', 'meta.json'))).toBe(true);
    expect(existsSync(join(out, 'messages.ndjson'))).toBe(true);
    expect(existsSync(resolve(out, '..', 'evil.txt'))).toBe(true); // the source file we created…
    expect(readFileSync(join(work, 'evil.txt'), 'utf8')).toBe('escaped'); // …but untouched
    expect(existsSync(join(work, 'out', '..', 'out-evil.txt'))).toBe(false);
    await expect(extractArtifacts(archive, join(work, 'small'), 10)).rejects.toBeInstanceOf(
      ArchiveTooLargeError,
    );
  });
});

describe('POST /api/runs/:id/ingest with artifacts.tgz', () => {
  let app: FastifyInstance;
  let root: string;
  let token = '';

  beforeAll(async () => {
    root = repo();
    app = await buildServer({
      adb: createMemoryDb(),
      config: {
        rootDir: root,
        projectsDir: join(root, 'projects'),
        artifactsDir: join(root, '.automax/runs'),
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
    const cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0]!;
    const created = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie, 'x-csrf-token': setup.json().csrfToken },
      payload: { name: 'ci', scopes: ['runs:ingest', 'runs:read'] },
    });
    expect(created.statusCode).toBe(201);
    token = created.json().token;
  });
  afterAll(async () => app.close());

  it('extracts the archive into the run dir and ingests the files it contains', async () => {
    const work = mkdtempSync(join(tmpdir(), 'automax-up-'));
    const archive = await buildArchive(work);
    const manifest = Buffer.from(
      JSON.stringify({ runId: 'ci-run-1', projectSlug: 'shop', env: 'local', trigger: 'ci' }),
    );
    const mp = multipart([
      { name: 'run.json', body: manifest },
      { name: 'artifacts.tgz', body: readFileSync(archive) },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/ci-run-1/ingest',
      headers: { authorization: `Bearer ${token}`, 'content-type': mp.type },
      payload: mp.body,
    });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    expect(json.files).toEqual(['run.json', 'artifacts.tgz']);
    expect(json.extracted).toMatchObject({ files: 3, skipped: 1 });
    const runDir = join(root, '.automax/runs', 'ci-run-1');
    expect(existsSync(join(runDir, 'shop', 'abc123', 'r0', 'meta.json'))).toBe(true);
    expect(existsSync(join(root, '.automax/runs', 'evil.txt'))).toBe(false);
    const call = ingestCalls.at(-1) as { runId: string; ndjsonPaths: string[] };
    expect(call.runId).toBe('ci-run-1');
    expect(call.ndjsonPaths).toEqual([join(runDir, 'messages.ndjson')]);
  });

  it('rejects an upload with no accepted files and an invalid run id', async () => {
    const mp = multipart([{ name: 'notes.txt', body: Buffer.from('x') }]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/ci-run-2/ingest',
      headers: { authorization: `Bearer ${token}`, 'content-type': mp.type },
      payload: mp.body,
    });
    expect(res.statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/runs/..%2Fescape/ingest',
      headers: { authorization: `Bearer ${token}`, 'content-type': mp.type },
      payload: mp.body,
    });
    expect([400, 404]).toContain(bad.statusCode);
  });
});

describe('trace viewer resolution', () => {
  it('finds playwright-core’s trace viewer under the bun/pnpm layout', () => {
    const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
    const dir = resolveTraceViewerDir(repoRoot);
    expect(dir).not.toBeNull();
    expect(existsSync(join(dir!, 'index.html'))).toBe(true);
  });
});
