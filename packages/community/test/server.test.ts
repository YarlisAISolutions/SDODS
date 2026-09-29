import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Verifier, Viewer } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { ThreadIndex } from '../src/duplicates.js';
import { buildCommunityServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { fakeClient, signals } from './fakes.js';

const people: Record<string, Viewer> = {
  member: viewer('u-member', 'member'),
  editor: viewer('u-editor', 'editor'),
  admin: viewer('u-admin', 'admin'),
};

function viewer(uid: string, role: Viewer['role']): Viewer {
  return {
    uid,
    name: uid,
    email: null,
    emailVerified: false,
    picture: null,
    provider: 'github.com',
    role,
  };
}

/** Tokens in tests are just the person's key: "Bearer member" is the member. */
const verify: Verifier = async (h) => people[(h ?? '').replace('Bearer ', '')] ?? null;

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

async function setup(script: Parameters<typeof fakeClient>[0], env: Record<string, string> = {}) {
  const store = new MemoryStore();
  const index = new ThreadIndex({ url: 'unused', refreshMs: 1e9 });
  index.set([
    { slug: 'ins-sdods-run-hangs-on-ci', title: 'sdods run hangs forever on CI runners' },
  ]);
  const client = fakeClient(script);
  app = await buildCommunityServer({
    config: { ...loadConfig({ NODE_ENV: 'test', ...env }) },
    client,
    verify,
    store,
    index,
    logger: false,
  });
  return { app, store, client };
}

const ask = (a: FastifyInstance, who: string | null, payload: Record<string, unknown>) =>
  a.inject({
    method: 'POST',
    url: '/questions',
    headers: who ? { authorization: `Bearer ${who}` } : {},
    payload,
  });

const q = {
  title: 'sdods run hangs forever on GitHub Actions',
  body: 'Running sdods run -l ui on CI never finishes; locally it passes in two minutes.',
  category: 'ui',
};

describe('posting a question', () => {
  it('needs a signed-in user', async () => {
    const { app } = await setup([]);
    expect((await ask(app, null, q)).statusCode).toBe(401);
  });

  it('publishes a clear SDODS question and suggests the thread it may duplicate', async () => {
    const { app, store } = await setup([signals()]);
    const res = await ask(app, 'member', q);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('published');
    expect(body.similar[0].slug).toBe('ins-sdods-run-hangs-on-ci');
    const doc = store.docs.get(body.path)!;
    expect(doc.fields).toMatchObject({ status: 'published', uid: 'u-member', title: q.title });
    expect(store.reviews).toHaveLength(1);
  });

  it('rejects an off-topic question and tells the author why', async () => {
    const reason = 'This looks like a general Python question rather than one about SDODS.';
    const { app } = await setup([signals({ relevance: 'off_topic', reason_for_author: reason })]);
    const res = await ask(app, 'member', { ...q, title: 'How do I reverse a list in Python?' });
    expect(res.json()).toMatchObject({ status: 'rejected', reason });
  });

  it('queues for an editor when both reviewers are unsure', async () => {
    const { app } = await setup([signals({ confidence: 0.5 }), signals({ confidence: 0.6 })]);
    expect((await ask(app, 'member', q)).json().status).toBe('pending');
  });

  it('masks a pasted key before storing it or showing it to the reviewer', async () => {
    const { app, store, client } = await setup([signals()]);
    const leaked = {
      ...q,
      body: `${q.body} My key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123`,
    };
    const res = await ask(app, 'member', leaked);
    const stored = String(store.docs.get(res.json().path)!.fields.body);
    expect(stored).not.toContain('sk-ant-api03');
    expect(JSON.stringify(client.calls[0])).not.toContain('sk-ant-api03');
    expect(res.json().redacted).toBe(true);
  });

  it('stops calling the model once the daily budget is spent, and queues instead', async () => {
    const { app, store, client } = await setup([], { COMMUNITY_DAILY_BUDGET_USD: '1' });
    await store.addSpend(new Date().toISOString().slice(0, 10), 5);
    expect((await ask(app, 'member', q)).json().status).toBe('pending');
    expect(client.calls).toHaveLength(0);
  });

  it('limits how fast one account can post', async () => {
    const { app } = await setup(
      Array.from({ length: 5 }, () => signals()),
      { COMMUNITY_POSTS_PER_WINDOW: '2' },
    );
    expect((await ask(app, 'member', q)).statusCode).toBe(200);
    expect((await ask(app, 'member', q)).statusCode).toBe(200);
    expect((await ask(app, 'member', q)).statusCode).toBe(429);
  });

  it('refuses a malformed question before spending anything', async () => {
    const { app, client } = await setup([]);
    expect((await ask(app, 'member', { ...q, title: 'short' })).statusCode).toBe(400);
    expect(client.calls).toHaveLength(0);
  });
});

describe('answers', () => {
  it('answers an archive thread, giving the reviewer the question for context', async () => {
    const { app, store, client } = await setup([signals()]);
    const res = await app.inject({
      method: 'POST',
      url: '/answers',
      headers: { authorization: 'Bearer member' },
      payload: { slug: 'ins-sdods-run-hangs-on-ci', body: 'Set --workers 1 on the CI runner.' },
    });
    expect(res.json().status).toBe('published');
    expect(res.json().path.startsWith('threadAnswers/')).toBe(true);
    expect(JSON.stringify(client.calls[0]!.messages)).toContain('hangs forever on CI');
    expect(store.docs.get(res.json().path)!.fields).toMatchObject({
      slug: 'ins-sdods-run-hangs-on-ci',
      parentId: '',
    });
  });

  it('will not answer a question that does not exist', async () => {
    const { app } = await setup([]);
    const res = await app.inject({
      method: 'POST',
      url: '/answers',
      headers: { authorization: 'Bearer member' },
      payload: { questionId: 'nope', body: 'An answer to nothing at all.' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('the editor queue', () => {
  it('is for editors: they see pending posts and resolve them once', async () => {
    const { app } = await setup([signals({ confidence: 0.5 }), signals({ confidence: 0.5 })]);
    const path = (await ask(app, 'member', q)).json().path;

    const denied = await app.inject({
      url: '/review/queue',
      headers: { authorization: 'Bearer member' },
    });
    expect(denied.statusCode).toBe(403);

    const list = await app.inject({
      url: '/review/queue',
      headers: { authorization: 'Bearer editor' },
    });
    expect(list.json().items.map((i: { path: string }) => i.path)).toEqual([path]);

    const resolve = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/review/resolve',
        headers: { authorization: 'Bearer editor' },
        payload,
      });
    expect((await resolve({ path, action: 'reject' })).statusCode).toBe(400); // needs a reason
    expect((await resolve({ path, action: 'approve' })).statusCode).toBe(200);
    expect((await resolve({ path, action: 'approve' })).statusCode).toBe(409);
  });

  it('refuses paths outside the post collections', async () => {
    const { app } = await setup([]);
    const res = await app.inject({
      method: 'POST',
      url: '/review/resolve',
      headers: { authorization: 'Bearer editor' },
      payload: { path: 'users/u-admin', action: 'approve' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('roles', () => {
  it('only an admin can make someone an editor', async () => {
    const { app, store } = await setup([]);
    const set = (who: string) =>
      app.inject({
        method: 'POST',
        url: '/admin/role',
        headers: { authorization: `Bearer ${who}` },
        payload: { uid: 'uMember', role: 'editor' },
      });
    expect((await set('editor')).statusCode).toBe(403);
    expect((await set('admin')).statusCode).toBe(200);
    expect(store.users.get('uMember')?.role).toBe('editor');
  });
});

describe('CORS', () => {
  it('allows sdods.com and its preview channels, and nothing else', async () => {
    const { app } = await setup([]);
    const pre = (origin: string) =>
      app.inject({ method: 'OPTIONS', url: '/questions', headers: { origin } });
    expect((await pre('https://sdods.com')).statusCode).toBe(204);
    expect((await pre('https://sdods-automax--pr-210-b2bw8lf9.web.app')).statusCode).toBe(204);
    expect((await pre('https://evil.example')).statusCode).toBe(403);
    expect((await pre('https://sdods.com')).headers['access-control-allow-headers']).toContain(
      'authorization',
    );
  });
});
