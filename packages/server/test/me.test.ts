import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createMemoryDb } from '@sdods/db';
import { buildServer } from '../src/index.js';

/** Self-service account routes: profile, password change and session management. */
describe('/api/me', () => {
  let app: FastifyInstance;
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    String(res.headers['set-cookie'] ?? '').split(';')[0]!;
  let cookie = '';
  let csrf = '';
  const PASSWORD = 'Admin#12345';

  const login = async (password = PASSWORD, ua = 'vitest') => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'user-agent': ua },
      payload: { username: 'admin', password },
    });
    return { status: res.statusCode, cookie: cookieOf(res), csrf: res.json().csrfToken as string };
  };
  const as = (c: string, x: string) => ({ cookie: c, 'x-csrf-token': x });

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdods-me-'));
    writeFileSync(join(root, 'package.json'), '{}');
    app = await buildServer({
      adb: createMemoryDb(),
      config: {
        rootDir: root,
        projectsDir: join(root, 'projects'),
        artifactsDir: join(root, '.sdods/runs'),
        authDisabled: false,
        sessionSecret: 'test-secret-test-secret-test-secret',
        loginRateLimit: 100,
      },
      logger: false,
      scheduler: false,
      minimal: true,
    });
    await app.ready();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { token: app.setupState.token, username: 'admin', password: PASSWORD },
    });
    expect(setup.statusCode).toBe(200);
    cookie = cookieOf(setup);
    csrf = setup.json().csrfToken;
  });
  afterAll(async () => app.close());

  it('returns profile fields and the current session id from /me', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ username: 'admin', role: 'admin', displayName: null });
    expect(body.user.createdAt).toBeTruthy();
    expect(body.sessionId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('updates display name and email, and clears them with an empty string', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: as(cookie, csrf),
      payload: { displayName: '  Ada Admin ', email: 'ada@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ displayName: 'Ada Admin', email: 'ada@example.com' });

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: as(cookie, csrf),
      payload: { email: 'not-an-email' },
    });
    expect(bad.statusCode).toBe(400);

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: as(cookie, csrf),
      payload: { displayName: '' },
    });
    expect(cleared.json()).toMatchObject({ displayName: null, email: 'ada@example.com' });

    // What the profile form sends when only the name changed and the email field is empty.
    const blankEmail = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: as(cookie, csrf),
      payload: { displayName: 'Ada', email: '' },
    });
    expect(blankEmail.statusCode).toBe(200);
    expect(blankEmail.json()).toMatchObject({ displayName: 'Ada', email: null });
  });

  it('requires the CSRF token for profile writes', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { cookie },
      payload: { displayName: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists sessions, marks the current one, and revokes another', async () => {
    const other = await login(PASSWORD, 'other-browser');
    const list = await app.inject({ method: 'GET', url: '/api/me/sessions', headers: { cookie } });
    const sessions = list.json() as Array<{ id: string; current: boolean; userAgent: string }>;
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const target = sessions.find((s) => s.userAgent === 'other-browser')!;
    expect(target.current).toBe(false);

    const self = sessions.find((s) => s.current)!;
    const refuse = await app.inject({
      method: 'DELETE',
      url: `/api/me/sessions/${self.id}`,
      headers: as(cookie, csrf),
    });
    expect(refuse.statusCode).toBe(400);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/me/sessions/${target.id}`,
      headers: as(cookie, csrf),
    });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: other.cookie },
    });
    expect(gone.statusCode).toBe(401);
  });

  it('rejects a wrong current password with 400, not 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: as(cookie, csrf),
      payload: { currentPassword: 'wrong-password', newPassword: 'Another#12345' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PASSWORD');
  });

  it('changes the password, signs out other sessions and keeps this one', async () => {
    const other = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: as(cookie, csrf),
      payload: { currentPassword: PASSWORD, newPassword: 'Changed#12345' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().otherSessionsSignedOut).toBeGreaterThanOrEqual(1);

    const mine = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(mine.statusCode).toBe(200);
    const theirs = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: other.cookie },
    });
    expect(theirs.statusCode).toBe(401);
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login('Changed#12345')).status).toBe(200);
  });

  it('refuses account routes for API tokens', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: as(cookie, csrf),
      payload: { name: 'ci', scopes: ['runs:read'] },
    });
    expect(created.statusCode).toBe(201);
    const bearer = { authorization: `Bearer ${created.json().token}` };
    for (const [method, url] of [
      ['GET', '/api/me/sessions'],
      ['PATCH', '/api/me'],
      ['POST', '/api/me/password'],
      ['POST', '/api/me/sessions/revoke-others'],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: bearer,
        payload: method === 'GET' ? undefined : { displayName: 'x' },
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});
