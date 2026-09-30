import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOidcVerifier, type Verifier } from '../src/auth.js';
import {
  firebaseIssuer,
  FirestoreStore,
  fromFields,
  identityToolkitRoleClaims,
} from '../src/firebase/index.js';

// The Firebase adapters: these tests move to the private deployment package with ./src/firebase.

const PROJECT = 'test-project';
let privateKey: CryptoKey;
let verify: Verifier;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  verify = createOidcVerifier({
    ...firebaseIssuer(PROJECT),
    adminEmails: [],
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
});

async function token(claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    auth_time: now - 10,
    name: 'Ada',
    firebase: { sign_in_provider: 'github.com' },
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('uid123')
    .setIssuer(`https://securetoken.google.com/${PROJECT}`)
    .setAudience(PROJECT)
    .setIssuedAt(now - 10)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}

describe('firebaseIssuer', () => {
  it("accepts the project's ID tokens and reads the sign-in provider", async () => {
    expect(await verify(`Bearer ${await token()}`)).toMatchObject({
      uid: 'uid123',
      provider: 'github.com',
    });
  });

  it('requires auth_time, which Firebase always sets', async () => {
    expect(await verify(`Bearer ${await token({ auth_time: undefined })}`)).toBeNull();
  });
});

describe('identityToolkitRoleClaims', () => {
  it('writes the role as a custom claim, and clears it for members', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{}');
    }) as unknown as typeof fetch;
    const claims = identityToolkitRoleClaims({
      project: PROJECT,
      fetch: fetchImpl,
      token: async () => 't',
    });
    await claims('u1', 'editor');
    await claims('u1', 'member');
    expect(calls[0]!.url).toBe(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,
    );
    expect(calls.map((c) => c.body)).toEqual([
      { localId: 'u1', customAttributes: '{"role":"editor"}' },
      { localId: 'u1', customAttributes: '{}' },
    ]);
  });
});

function recorder(respond: (url: string) => unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(respond(url)));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const root = 'projects/p1/databases/(default)/documents';
const base = `https://firestore.googleapis.com/v1/${root}`;

describe('FirestoreStore public reads', () => {
  it('queries published questions newest first, then each one’s published answers', async () => {
    const { impl, calls } = recorder((url) =>
      url === `${base}:runQuery`
        ? [
            {
              document: {
                name: `${root}/questions/q1`,
                fields: {
                  title: { stringValue: 'T' },
                  createdAt: { timestampValue: '2026-09-01T00:00:00Z' },
                },
              },
            },
          ]
        : [{ document: { name: `${root}/questions/q1/answers/a1`, fields: {} } }, {}],
    );
    const store = new FirestoreStore({ project: 'p1', fetch: impl, token: async () => 't' });
    const [q] = await store.publishedQuestions(50);
    expect(calls[0]!.body).toEqual({
      structuredQuery: {
        from: [{ collectionId: 'questions' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'published' },
          },
        },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: 50,
      },
    });
    expect(calls[1]!.url).toBe(`${base}/questions/q1:runQuery`);
    expect(q).toMatchObject({ id: 'q1', title: 'T', createdAt: '2026-09-01T00:00:00Z' });
    expect(q!.answers.map((a) => a.id)).toEqual(['a1']);
  });

  it('combines equality filters for archive-thread answers', async () => {
    const { impl, calls } = recorder(() => []);
    const store = new FirestoreStore({ project: 'p1', fetch: impl, token: async () => 't' });
    await store.threadAnswers('some-thread');
    const where = (calls[0]!.body as { structuredQuery: { where: unknown } }).structuredQuery.where;
    expect(where).toMatchObject({ compositeFilter: { op: 'AND' } });
  });

  it('creates feedback with the server time and never overwrites', async () => {
    const { impl, calls } = recorder(() => ({}));
    const store = new FirestoreStore({ project: 'p1', fetch: impl, token: async () => 't' });
    await store.saveFeedback({
      type: 'page',
      path: '/x',
      title: 'X',
      verdict: 'helpful',
      note: '',
    });
    const write = (calls[0]!.body as { writes: Array<Record<string, unknown>> }).writes[0]!;
    expect(calls[0]!.url).toBe(`${base}:commit`);
    expect((write.update as { name: string }).name).toMatch(/\/pageFeedback\/[A-Za-z0-9]{20}$/);
    expect(write.currentDocument).toEqual({ exists: false });
    expect(write.updateTransforms).toEqual([
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
    ]);
  });
});

describe('fromFields', () => {
  it('decodes Firestore REST values', () => {
    expect(
      fromFields({
        n: { integerValue: '3' },
        s: { stringValue: 'x' },
        a: { arrayValue: { values: [{ booleanValue: true }, { nullValue: null }] } },
        m: { mapValue: { fields: { d: { doubleValue: 1.5 } } } },
      }),
    ).toEqual({ n: 3, s: 'x', a: [true, null], m: { d: 1.5 } });
  });
});
