import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createVerifier, type Verifier } from '../src/auth.js';

const PROJECT = 'test-project';
let privateKey: CryptoKey;
let verify: Verifier;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  verify = createVerifier({
    project: PROJECT,
    adminEmails: ['admin@sdods.com'],
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
});

async function token(
  claims: Record<string, unknown> = {},
  opts: { aud?: string; iss?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    auth_time: now - 10,
    name: 'Ada',
    email: 'ada@example.com',
    email_verified: true,
    firebase: { sign_in_provider: 'github.com' },
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('uid123')
    .setIssuer(opts.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(opts.aud ?? PROJECT)
    .setIssuedAt(now - 10)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}

describe('createVerifier', () => {
  it('accepts a token for this project and reads the viewer from it', async () => {
    const v = await verify(`Bearer ${await token()}`);
    expect(v).toMatchObject({ uid: 'uid123', name: 'Ada', provider: 'github.com', role: 'member' });
  });

  it('rejects a token for another project, or from another issuer, or none at all', async () => {
    expect(await verify(`Bearer ${await token({}, { aud: 'other' })}`)).toBeNull();
    expect(await verify(`Bearer ${await token({}, { iss: 'https://evil.example' })}`)).toBeNull();
    expect(await verify(undefined)).toBeNull();
    expect(await verify('Bearer not.a.jwt')).toBeNull();
  });

  it('makes the configured admin email an admin only when it is verified', async () => {
    const verified = await verify(`Bearer ${await token({ email: 'Admin@SDODS.com' })}`);
    expect(verified?.role).toBe('admin');
    const unverified = await verify(
      `Bearer ${await token({ email: 'admin@sdods.com', email_verified: false })}`,
    );
    expect(unverified?.role).toBe('member');
  });

  it('reads editor and admin roles from the custom claim', async () => {
    expect((await verify(`Bearer ${await token({ role: 'editor' })}`))?.role).toBe('editor');
    expect((await verify(`Bearer ${await token({ role: 'admin' })}`))?.role).toBe('admin');
    expect((await verify(`Bearer ${await token({ role: 'superuser' })}`))?.role).toBe('member');
  });

  it('never uses the email address as a display name when a name exists', async () => {
    const v = await verify(`Bearer ${await token({ name: undefined })}`);
    expect(v?.name).toBe('ada');
  });
});
