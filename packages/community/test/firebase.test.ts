import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOidcVerifier, type Verifier } from '../src/auth.js';
import { firebaseIssuer, fromFields, identityToolkitRoleClaims } from '../src/firebase/index.js';

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
