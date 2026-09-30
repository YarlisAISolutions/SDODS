import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { noSignIn } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { ThreadIndex } from '../src/duplicates.js';
import { buildCommunityServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { fakeClient } from './fakes.js';

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

const at = (s: string) => new Date(`2026-09-${s}T00:00:00Z`);

async function setup(env: Record<string, string> = {}) {
  const store = new MemoryStore();
  const put = (path: string, fields: Record<string, unknown>, day: string) =>
    store.docs.set(path, { fields, createdAt: at(day) });
  put('questions/q1', { status: 'published', title: 'Old', body: 'b', name: 'A', uid: 'u1' }, '01');
  put('questions/q2', { status: 'published', title: 'New', body: 'b', name: 'B', score: 3 }, '02');
  put('questions/q3', { status: 'pending', title: 'Hidden', body: 'b', name: 'C' }, '03');
  put('questions/q1/answers/a2', { status: 'published', body: 'second', parentId: '' }, '05');
  put('questions/q1/answers/a1', { status: 'published', body: 'first', parentId: '' }, '04');
  put('questions/q1/answers/a3', { status: 'rejected', body: 'spam', parentId: '' }, '06');
  put('threadAnswers/t1', { status: 'published', slug: 'some-thread', body: 'yes' }, '07');
  put('threadAnswers/t2', { status: 'published', slug: 'other-thread', body: 'no' }, '07');
  put('revisions/r1', { post: 'questions/q1', revision: 1, body: 'v1', status: 'applied' }, '08');
  put('revisions/r0', { post: 'questions/q1', revision: 0, body: 'v0', status: 'applied' }, '01');
  put('revisions/r2', { post: 'questions/q1', revision: 2, body: 'v2', status: 'pending' }, '09');
  store.users.set('u1', { uid: 'u1', display: 'Ada', firstSeen: at('01'), rep: 42 });

  app = await buildCommunityServer({
    config: loadConfig({ NODE_ENV: 'test', ...env }),
    client: fakeClient([]),
    verify: noSignIn,
    store,
    index: new ThreadIndex({ url: 'unused', refreshMs: 1e9 }),
    logger: false,
  });
  return { app, store };
}

describe('public reads', () => {
  it('lists published questions newest first, each with its published answers in order', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/questions' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const { items } = res.json();
    expect(items.map((q: { id: string }) => q.id)).toEqual(['q2', 'q1']);
    expect(items[1].answers.map((a: { body: string }) => a.body)).toEqual(['first', 'second']);
    expect(items[1].createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(items[0]).toMatchObject({ score: 3, uid: null, acceptedAnswerId: null });
  });

  it('returns one published question, and 404 for a pending or missing one', async () => {
    const { app } = await setup();
    const get = (id: string) => app.inject({ method: 'GET', url: `/questions/${id}` });
    expect((await get('q1')).json()).toMatchObject({ id: 'q1', title: 'Old' });
    expect((await get('q3')).statusCode).toBe(404);
    expect((await get('nope')).statusCode).toBe(404);
    expect((await get('bad%2Fid')).statusCode).toBe(400);
  });

  it("returns an archive thread's published answers", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/threads/some-thread/answers' });
    expect(res.json().items.map((a: { id: string }) => a.id)).toEqual(['t1']);
  });

  it('returns public profiles and skips unknown users', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/profiles?uids=u1,ghost' });
    expect(res.json().profiles).toEqual({
      u1: { rep: 42, role: 'member', display: 'Ada', badges: [] },
    });
    const tooMany = Array.from({ length: 51 }, (_, i) => `u${i}`).join(',');
    expect((await app.inject({ method: 'GET', url: `/profiles?uids=${tooMany}` })).statusCode).toBe(
      400,
    );
  });

  it("returns a post's applied revisions, oldest first", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/revisions?path=questions/q1' });
    expect(res.json().items.map((r: { body: string }) => r.body)).toEqual(['v0', 'v1']);
    const bad = await app.inject({ method: 'GET', url: '/revisions?path=users/u1' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('feedback', () => {
  it('stores site and page feedback without sign-in', async () => {
    const { app, store } = await setup();
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/feedback', payload });
    const site = await post({
      type: 'site',
      kind: 'bug',
      title: 'Crash',
      body: 'It crashed',
      name: '',
      email: '',
    });
    expect(site.statusCode).toBe(200);
    const page = await post({
      type: 'page',
      path: '/docs/x',
      title: 'X',
      verdict: 'not-helpful',
      note: 'missing y',
    });
    expect(page.statusCode).toBe(200);
    const saved = [...store.docs.entries()].filter(([p]) => /^(feedback|pageFeedback)\//.test(p));
    expect(saved.map(([p, d]) => [p.split('/')[0], d.fields.status])).toEqual([
      ['feedback', 'new'],
      ['pageFeedback', 'new'],
    ]);
    expect(saved[0]![1].fields).not.toHaveProperty('type');
  });

  it('rejects what the old security rules rejected', async () => {
    const { app } = await setup();
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/feedback', payload });
    expect((await post({ type: 'site', kind: 'rant', title: 't', body: 'b' })).statusCode).toBe(
      400,
    );
    expect((await post({ type: 'site', kind: 'bug', title: '', body: 'b' })).statusCode).toBe(400);
    expect(
      (await post({ type: 'page', path: '/', title: '', verdict: 'meh', note: '' })).statusCode,
    ).toBe(400);
    expect((await post({ type: 'other' })).statusCode).toBe(400);
  });

  it('limits anonymous submissions per IP', async () => {
    const { app } = await setup({ COMMUNITY_FEEDBACK_PER_WINDOW: '2' });
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/feedback',
        payload: { type: 'page', path: '/', title: '', verdict: 'helpful', note: '' },
      });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
  });
});
