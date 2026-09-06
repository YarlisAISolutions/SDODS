/**
 * Password hashing with a dependency-free fallback.
 *
 * argon2id is the preferred algorithm and stays the default. But `argon2` is a native module and
 * its published prebuilds do not cover every target we ship to: as of 0.45.1 there is no
 * `darwin-x64` and no `win32-arm64` build. Its install script falls back to `node-gyp rebuild`,
 * which needs Xcode Command Line Tools or VS Build Tools — so on an Intel Mac a plain
 * `npm install` of the server fails outright, and the desktop app could not run there at all.
 *
 * So the import is dynamic and guarded. When argon2 is unavailable we hash with scrypt from
 * `node:crypto`, which is always present. Stored hashes are self-describing — argon2 writes
 * `$argon2id$...` and we write `$scrypt$...` — so `verifyPassword` dispatches on the prefix and a
 * database written by either path keeps working after the other becomes available. No migration.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP's scrypt baseline: N=2^17, r=8, p=1. maxmem must exceed 128*N*r (~134 MB) with headroom. */
const SCRYPT = { N: 1 << 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 } as const;
const SCRYPT_PREFIX = '$scrypt$';

type Argon2Module = {
  hash: (password: string, opts: { type: number }) => Promise<string>;
  verify: (hash: string, password: string) => Promise<boolean>;
  argon2id: number;
};

let argon2Promise: Promise<Argon2Module | null> | undefined;

/**
 * Resolve argon2 once. A failure here is expected on platforms with no prebuild and no compiler,
 * and must not be fatal — it simply selects the scrypt path.
 */
function loadArgon2(): Promise<Argon2Module | null> {
  argon2Promise ??= import('argon2')
    .then((m) => ((m as { default?: Argon2Module }).default ?? m) as Argon2Module)
    .catch(() => null);
  return argon2Promise;
}

/** True when argon2 loaded on this machine. Exposed for `sdods doctor` and diagnostics. */
export async function argon2Available(): Promise<boolean> {
  return (await loadArgon2()) !== null;
}

async function scryptHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `${SCRYPT_PREFIX}${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function scryptVerify(stored: string, password: string): Promise<boolean> {
  // $scrypt$N$r$p$salt$hash
  const parts = stored.slice(SCRYPT_PREFIX.length).split('$');
  if (parts.length !== 5) return false;
  // Indexed access is `string | undefined` under noUncheckedIndexedAccess, and the length check
  // above does not narrow a destructure, so read the fields explicitly.
  const nRaw = parts[0] ?? '';
  const rRaw = parts[1] ?? '';
  const pRaw = parts[2] ?? '';
  const saltRaw = parts[3] ?? '';
  const hashRaw = parts[4] ?? '';
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p))
    return false;

  const expected = Buffer.from(hashRaw, 'base64');
  const salt = Buffer.from(saltRaw, 'base64');
  // Read the cost parameters back from the stored hash so old hashes still verify after a tuning
  // change, but keep maxmem generous enough for them.
  const actual = await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: Math.max(SCRYPT.maxmem, 256 * N * r),
  }).catch(() => null);
  if (!actual || actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await loadArgon2();
  if (argon2) return argon2.hash(password, { type: argon2.argon2id });
  return scryptHash(password);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  if (storedHash.startsWith(SCRYPT_PREFIX)) return scryptVerify(storedHash, password);
  const argon2 = await loadArgon2();
  // An argon2 hash on a machine where argon2 will not load: nothing can verify it. Fail closed
  // rather than throwing, so the caller still reports "invalid username or password".
  if (!argon2) return false;
  return argon2.verify(storedHash, password).catch(() => false);
}
