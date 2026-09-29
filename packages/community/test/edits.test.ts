import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Verifier, Viewer } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { ThreadIndex } from '../src/duplicates.js';
import { buildCommunityServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { fakeClient, signals } from './fakes.js';

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
  author: v('author'),
  other: v('other'),
  veteran: v('veteran'),
  editor: v('editor', 'editor'),
};
const verify: Verifier = async (h) => people[(h ?? '').replace('Bearer ', '')] ?? null;

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

async function setup(script: Parameters<typeof fakeClient>[0]) {
  const store = new MemoryStore();
  const put = (path: string, fields: Record<string, unknown>) =>
    store.docs.set(path, {
      fields: { status: 'published', score: 0, ...fields },
      createdAt: new Date('2026-09-01T00:00:00Z'),
    });
  put('questions/q1', {
    uid: 'author',
    name: 'author',
    title: 'sdods run hangs on CI runners',
    body: 'Original body text here.',
  });
  put('questions/q1/answers/a1', {
    uid: 'other',
    name: 'other',
    body: 'An answer that works.',
    parentId: '',
  });
  put('questions/q1/answers/r1', {
    uid: 'veteran',
    name: 'veteran',
    body: '@other thanks, that fixed it',
    parentId: 'a1',
  });
  for (const [uid, rep] of [
    ['author', 1],
    ['other', 1],
    ['veteran', 5000],
  ] as const)
    store.users.set(uid, { uid, display: uid, firstSeen: new Date(), rep });

  app = await buildCommunityServer({
    config: loadConfig({ NODE_ENV: 'test' }),
    client: fakeClient(script),
    verify,
    store,
    index: new ThreadIndex({ url: 'unused', refreshMs: 1e9 }),
    logger: false,
  });
  const edit = (who: string, payload: Record<string, unknown>) =>
    app!.inject({
      method: 'POST',
      url: '/edits',
      headers: { authorization: `Bearer ${who}` },
      payload: { comment: 'fix typo', baseRevision: 0, ...payload },
    });
  const revisions = () =>
    [...store.docs.entries()]
      .filter(([p]) => p.startsWith('revisions/'))
      .map(([, d]) => d.fields)
      .sort((a, b) => Number(a.revision ?? -1) - Number(b.revision ?? -1));
  return { app, store, edit, revisions };
}

describe('editing', () => {
  it('the author edits directly; the original is kept as revision 0', async () => {
    const { edit, store, revisions } = await setup([signals()]);
    const res = await edit('author', {
      path: 'questions/q1',
      body: 'Clearer body text with the error output.',
    });
    expect(res.json()).toEqual({ status: 'applied', revision: 1 });
    expect(store.docs.get('questions/q1')!.fields).toMatchObject({
      body: 'Clearer body text with the error output.',
      revision: 1,
      editedBy: 'author',
    });
    const revs = revisions().filter((r) => r.status === 'applied');
    expect(revs.map((r) => [r.revision, r.body])).toEqual([
      [0, 'Original body text here.'],
      [1, 'Clearer body text with the error output.'],
    ]);
    expect(store.users.get('author')?.badges).toEqual([expect.objectContaining({ id: 'editor' })]);
  });

  it('someone with enough reputation edits directly; others suggest', async () => {
    const { edit, store } = await setup([signals(), signals()]);
    const veteran = await edit('veteran', {
      path: 'questions/q1/answers/a1',
      body: 'An answer that works, with the command.',
    });
    expect(veteran.json().status).toBe('applied');
    const other = await edit('other', {
      path: 'questions/q1',
      body: 'A suggested improvement of the body.',
      baseRevision: 0,
    });
    expect(other.json().status).toBe('pending');
    expect(store.docs.get('questions/q1')!.fields.body).toBe('Original body text here.');
  });

  it('refuses an edit based on an older revision', async () => {
    const { edit } = await setup([signals(), signals()]);
    await edit('author', { path: 'questions/q1', body: 'First edit of the body text.' });
    const stale = await edit('author', {
      path: 'questions/q1',
      body: 'Second edit from a stale page.',
      baseRevision: 0,
    });
    expect(stale.statusCode).toBe(409);
  });

  it('reviews the new text: a rejected edit is refused, an unsure one waits for an editor', async () => {
    const { edit } = await setup([
      signals({ relevance: 'off_topic', confidence: 0.95, reason_for_author: 'Not about SDODS.' }),
      signals({ confidence: 0.4 }),
      signals({ confidence: 0.5 }),
    ]);
    const bad = await edit('author', {
      path: 'questions/q1',
      body: 'Buy cheap watches at example.com today.',
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().reason).toBe('Not about SDODS.');
    const unsure = await edit('author', {
      path: 'questions/q1',
      body: 'Something the reviewer is unsure about.',
    });
    expect(unsure.json().status).toBe('pending');
  });

  it("does not let people rewrite someone else's reply", async () => {
    const { edit } = await setup([signals()]);
    const res = await edit('author', {
      path: 'questions/q1/answers/r1',
      body: 'Rewriting what the veteran said.',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('suggested edits', () => {
  it('an editor approves: applied as the next revision, +2 and the Editor badge to the suggester', async () => {
    const { app, edit, store } = await setup([signals()]);
    const s = await edit('other', {
      path: 'questions/q1',
      body: 'A suggested improvement of the body.',
    });
    const list = await app.inject({
      url: '/review/edits',
      headers: { authorization: 'Bearer editor' },
    });
    expect(list.json().items).toEqual([
      expect.objectContaining({ id: s.json().id, post: 'questions/q1' }),
    ]);

    const ok = await app.inject({
      method: 'POST',
      url: '/review/edits/resolve',
      headers: { authorization: 'Bearer editor' },
      payload: { id: s.json().id, action: 'approve' },
    });
    expect(ok.json()).toEqual({ ok: true, applied: true });
    expect(store.docs.get('questions/q1')!.fields).toMatchObject({
      body: 'A suggested improvement of the body.',
      revision: 1,
    });
    expect(store.users.get('other')?.rep).toBe(3);
    expect(store.users.get('other')?.badges).toEqual([expect.objectContaining({ id: 'editor' })]);
  });

  it('a suggestion overtaken by a newer edit cannot be approved', async () => {
    const { app, edit } = await setup([signals(), signals()]);
    const s = await edit('other', {
      path: 'questions/q1',
      body: 'A suggested improvement of the body.',
    });
    await edit('author', {
      path: 'questions/q1',
      body: "The author's own later edit of the body.",
    });
    const res = await app.inject({
      method: 'POST',
      url: '/review/edits/resolve',
      headers: { authorization: 'Bearer editor' },
      payload: { id: s.json().id, action: 'approve' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('only editors see and resolve suggestions, and a rejection needs a reason', async () => {
    const { app, edit } = await setup([signals()]);
    const s = await edit('other', {
      path: 'questions/q1',
      body: 'A suggested improvement of the body.',
    });
    expect(
      (await app.inject({ url: '/review/edits', headers: { authorization: 'Bearer other' } }))
        .statusCode,
    ).toBe(403);
    const resolve = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/review/edits/resolve',
        headers: { authorization: 'Bearer editor' },
        payload,
      });
    expect((await resolve({ id: s.json().id, action: 'reject' })).statusCode).toBe(400);
    expect(
      (await resolve({ id: s.json().id, action: 'reject', reason: 'Changes the meaning' })).json(),
    ).toEqual({ ok: true, applied: false });
  });
});

describe('badges through votes and accepts', () => {
  it('Supporter for the voter and Teacher for the answerer on a first upvote', async () => {
    const { app, store } = await setup([]);
    await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: 'Bearer veteran' },
      payload: { path: 'questions/q1/answers/a1', value: 1 },
    });
    expect(store.users.get('veteran')?.badges).toEqual([
      expect.objectContaining({ id: 'supporter' }),
    ]);
    expect(store.users.get('other')?.badges).toEqual([expect.objectContaining({ id: 'teacher' })]);
  });

  it('Scholar for the asker who accepts', async () => {
    const { app, store } = await setup([]);
    await app.inject({
      method: 'POST',
      url: '/accept',
      headers: { authorization: 'Bearer author' },
      payload: { questionId: 'q1', answerId: 'a1' },
    });
    expect(store.users.get('author')?.badges).toEqual([expect.objectContaining({ id: 'scholar' })]);
  });
});
