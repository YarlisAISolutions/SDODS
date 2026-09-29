import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Verifier, Viewer } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { ThreadIndex } from '../src/duplicates.js';
import { buildCommunityServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { fakeClient } from './fakes.js';

const v = (uid: string, role: Viewer['role'] = 'member'): Viewer => ({
  uid,
  name: uid,
  email: null,
  emailVerified: false,
  picture: null,
  provider: 'github.com',
  role,
});
const people: Record<string, Viewer> = {
  asker: v('asker'),
  answerer: v('answerer'),
  voter: v('voter'),
  newbie: v('newbie'),
  editor: v('editor', 'editor'),
};
const verify: Verifier = async (h) => people[(h ?? '').replace('Bearer ', '')] ?? null;

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

/** A published question by `asker` with one answer by `answerer` and one reply, seeded directly. */
async function setup(env: Record<string, string> = {}) {
  const store = new MemoryStore();
  const put = (path: string, fields: Record<string, unknown>) =>
    store.docs.set(path, {
      fields: { status: 'published', score: 0, ...fields },
      createdAt: new Date(),
    });
  put('questions/q1', { uid: 'asker', title: 'Q', body: 'B' });
  put('questions/q1/answers/a1', { uid: 'answerer', body: 'A', parentId: '' });
  put('questions/q1/answers/a2', { uid: 'voter', body: 'A2', parentId: '' });
  put('questions/q1/answers/r1', { uid: 'voter', body: '@answerer thanks', parentId: 'a1' });
  put('questions/q2', { uid: 'asker', title: 'Q2', body: 'B', status: 'pending' });
  for (const [uid, rep] of [
    ['asker', 1],
    ['answerer', 1],
    ['voter', 200],
    ['newbie', 1],
  ] as const)
    store.users.set(uid, { uid, display: uid, firstSeen: new Date(), rep });

  app = await buildCommunityServer({
    config: loadConfig({ NODE_ENV: 'test', ...env }),
    client: fakeClient([]),
    verify,
    store,
    index: new ThreadIndex({ url: 'unused', refreshMs: 1e9 }),
    logger: false,
  });
  const send = (who: string, url: string, payload: Record<string, unknown>) =>
    app!.inject({ method: 'POST', url, headers: { authorization: `Bearer ${who}` }, payload });
  return { app, store, send, rep: (uid: string) => store.users.get(uid)?.rep };
}

describe('voting', () => {
  it('an upvote scores the post and gives its author 10', async () => {
    const { send, store, rep } = await setup();
    const res = await send('voter', '/votes', { path: 'questions/q1/answers/a1', value: 1 });
    expect(res.json()).toEqual({ ok: true, score: 1, value: 1 });
    expect(store.docs.get('questions/q1/answers/a1')!.fields.score).toBe(1);
    expect(rep('answerer')).toBe(11);
  });

  it('voting twice the same way changes nothing; switching reverses the first vote', async () => {
    const { send, rep } = await setup();
    const path = 'questions/q1/answers/a1';
    await send('voter', '/votes', { path, value: 1 });
    await send('voter', '/votes', { path, value: 1 });
    expect(rep('answerer')).toBe(11);
    const flipped = await send('voter', '/votes', { path, value: -1 });
    expect(flipped.json().score).toBe(-1);
    expect(rep('answerer')).toBe(1); // 11 - 12, floored at 1
    expect(rep('voter')).toBe(199); // downvoting an answer costs 1
    await send('voter', '/votes', { path, value: 0 });
    expect(rep('voter')).toBe(200);
  });

  it('keeps the rules: no voting on your own post, on replies, or on unpublished posts', async () => {
    const { send } = await setup();
    expect(
      (await send('answerer', '/votes', { path: 'questions/q1/answers/a1', value: 1 })).statusCode,
    ).toBe(403);
    expect(
      (await send('voter', '/votes', { path: 'questions/q1/answers/r1', value: 1 })).statusCode,
    ).toBe(400);
    expect((await send('voter', '/votes', { path: 'questions/q2', value: 1 })).statusCode).toBe(
      404,
    );
    expect((await send('voter', '/votes', { path: 'users/voter', value: 1 })).statusCode).toBe(400);
  });

  it('needs 15 reputation to vote up and 125 to vote down, unless you are an editor', async () => {
    const { send } = await setup();
    const up = await send('newbie', '/votes', { path: 'questions/q1', value: 1 });
    expect(up.statusCode).toBe(403);
    expect(up.json()).toMatchObject({ need: 15, rep: 1 });
    expect((await send('editor', '/votes', { path: 'questions/q1', value: -1 })).statusCode).toBe(
      200,
    );
  });

  it('caps votes per day', async () => {
    const { send } = await setup({ COMMUNITY_VOTES_PER_DAY: '1' });
    expect((await send('voter', '/votes', { path: 'questions/q1', value: 1 })).statusCode).toBe(
      200,
    );
    expect(
      (await send('voter', '/votes', { path: 'questions/q1/answers/a1', value: 1 })).statusCode,
    ).toBe(429);
  });

  it('tells a user how they voted', async () => {
    const { app, send } = await setup();
    await send('voter', '/votes', { path: 'questions/q1', value: 1 });
    const res = await app.inject({
      url: '/votes/mine?paths=questions/q1,questions/q1/answers/a1',
      headers: { authorization: 'Bearer voter' },
    });
    expect(res.json()).toEqual({ votes: { 'questions/q1': 1 }, rep: 200 });
  });
});

describe('accepting an answer', () => {
  it('only the asker can accept; +15 to the answerer, +2 to the asker', async () => {
    const { send, store, rep } = await setup();
    expect((await send('voter', '/accept', { questionId: 'q1', answerId: 'a1' })).statusCode).toBe(
      403,
    );
    const ok = await send('asker', '/accept', { questionId: 'q1', answerId: 'a1' });
    expect(ok.json()).toEqual({ ok: true, acceptedAnswerId: 'a1' });
    expect(store.docs.get('questions/q1')!.fields.acceptedAnswerId).toBe('a1');
    expect(rep('answerer')).toBe(16);
    expect(rep('asker')).toBe(3);
  });

  it('switching moves the 15; clearing reverses everything; replies cannot be accepted', async () => {
    const { send, rep } = await setup();
    await send('asker', '/accept', { questionId: 'q1', answerId: 'a1' });
    await send('asker', '/accept', { questionId: 'q1', answerId: 'a2' });
    expect(rep('answerer')).toBe(1);
    expect(rep('voter')).toBe(215);
    expect(rep('asker')).toBe(3);
    await send('asker', '/accept', { questionId: 'q1', answerId: null });
    expect(rep('voter')).toBe(200);
    expect(rep('asker')).toBe(1);
    expect((await send('asker', '/accept', { questionId: 'q1', answerId: 'r1' })).statusCode).toBe(
      400,
    );
  });

  it('records every reputation change', async () => {
    const { send, store } = await setup();
    await send('asker', '/accept', { questionId: 'q1', answerId: 'a1' });
    const events = [...store.docs.entries()]
      .filter(([p]) => p.startsWith('repEvents/'))
      .map(([, d]) => d.fields);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uid: 'answerer',
          delta: 15,
          reason: 'accepted',
          post: 'questions/q1',
        }),
        expect.objectContaining({ uid: 'asker', delta: 2, reason: 'accepted-an-answer' }),
      ]),
    );
  });
});
