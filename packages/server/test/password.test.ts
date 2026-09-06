import { describe, expect, it } from 'vitest';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { argon2Available, hashPassword, verifyPassword } from '../src/services/password.js';

const scrypt = promisify(scryptCb) as (
  p: string,
  s: Buffer,
  k: number,
  o: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Build a scrypt-format hash directly, which is what a machine with no argon2 prebuild
 * (darwin-x64, win32-arm64) produces. Lets us assert the fallback path on a machine where
 * argon2 loads perfectly well.
 */
async function scryptHash(password: string): Promise<string> {
  const N = 1 << 14; // deliberately cheaper than production, and a different N, to prove the
  const r = 8; //      cost parameters are read back out of the stored string rather than assumed
  const p = 1;
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `$scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

describe('password hashing', () => {
  const pw = 'correct horse battery staple';

  it('round-trips whichever algorithm is available', async () => {
    const hash = await hashPassword(pw);
    await expect(verifyPassword(hash, pw)).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('prefers argon2id when it loads', async () => {
    const hash = await hashPassword(pw);
    // On CI and dev machines argon2 has a prebuild; assert we did not silently downgrade.
    if (await argon2Available()) expect(hash.startsWith('$argon2id$')).toBe(true);
    else expect(hash.startsWith('$scrypt$')).toBe(true);
  });

  it('verifies scrypt hashes, reading cost parameters back from the stored string', async () => {
    const hash = await scryptHash(pw);
    expect(hash.startsWith('$scrypt$')).toBe(true);
    await expect(verifyPassword(hash, pw)).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('dispatches per hash, so a database written by either path keeps working', async () => {
    const argonish = await hashPassword(pw);
    const scryptish = await scryptHash(pw);
    await expect(verifyPassword(argonish, pw)).resolves.toBe(true);
    await expect(verifyPassword(scryptish, pw)).resolves.toBe(true);
  });

  it('produces a distinct hash per call (salted)', async () => {
    expect(await hashPassword(pw)).not.toBe(await hashPassword(pw));
  });

  it('fails closed on malformed input rather than throwing', async () => {
    for (const bad of ['', 'not-a-hash', '$scrypt$', '$scrypt$a$b$c$d$e', '$scrypt$16384$8$1$zz']) {
      await expect(verifyPassword(bad, pw)).resolves.toBe(false);
    }
  });
});
