/**
 * Desktop identity.
 *
 * The server always requires authentication. `AUTH_DISABLED=1` would skip this entirely, but it
 * also turns off CSRF checking (`plugins/auth.ts` only validates the token when the caller arrived
 * `via: 'session'`) on a server that spawns arbitrary child processes and is reachable by every
 * other process on the machine. That is not a posture to ship.
 *
 * So the app owns the credentials instead: it creates the admin on first run, stores the password
 * in the OS keychain via Electron's safeStorage, and signs in on every launch — injecting the
 * resulting session cookie into the window before it loads. The user never sees a login form, but
 * a real account exists, roles work, and they can sign in from a browser or the CLI when they want
 * to. "Show credentials" in the menu reveals them.
 *
 * Session TTL is a hardcoded 7 days server-side, so re-authenticating on launch is not optional —
 * without it, opening the app on day 8 would present a login form for an account the user created
 * once and never typed a password for.
 */
import { safeStorage, session as electronSession } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { appDataDir, ensureDir } from './paths.js';

const USERNAME = 'admin';
const vaultPath = () => join(appDataDir(), 'credentials.bin');

export interface Credentials {
  username: string;
  password: string;
}

/** 32 bytes of base64url: no shell-quoting hazards, no ambiguous characters. */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

export function loadCredentials(): Credentials | null {
  const file = vaultPath();
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file);
    const plain = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    return JSON.parse(plain) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  ensureDir(appDataDir());
  const plain = JSON.stringify(creds);
  // safeStorage is unavailable on a Linux box with no keyring (libsecret). Falling back to a 0600
  // plaintext file is a deliberate trade: the alternative is an app that cannot start at all, and
  // the file sits in the user's own profile guarding a localhost-only account.
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain)
    : Buffer.from(plain, 'utf8');
  writeFileSync(vaultPath(), payload, { mode: 0o600 });
}

export function ensureCredentials(): Credentials {
  return loadCredentials() ?? { username: USERNAME, password: generatePassword() };
}

interface AuthResult {
  cookie: string;
  csrfToken?: string;
}

/** Pull the session cookie out of Set-Cookie, keeping the value exactly as the server signed it. */
function extractCookie(res: Response): string | null {
  const raw = res.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith('sdods_sid=')) ?? res.headers.get('set-cookie');
  if (!header) return null;
  const value = header.split(';')[0]?.split('=').slice(1).join('=');
  return value ?? null;
}

/** Create the first admin using the token `serve` printed. Only valid while no users exist. */
export async function completeSetup(
  url: string,
  token: string,
  creds: Credentials,
): Promise<AuthResult> {
  const res = await fetch(`${url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, username: creds.username, password: creds.password }),
  });
  if (!res.ok) throw new Error(`Setup failed (${res.status}): ${await res.text()}`);
  const cookie = extractCookie(res);
  if (!cookie) throw new Error('Setup succeeded but returned no session cookie.');
  const body = (await res.json().catch(() => ({}))) as { csrfToken?: string };
  return { cookie, csrfToken: body.csrfToken };
}

export async function login(url: string, creds: Credentials): Promise<AuthResult> {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: creds.username, password: creds.password }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}): ${await res.text()}`);
  const cookie = extractCookie(res);
  if (!cookie) throw new Error('Sign-in succeeded but returned no session cookie.');
  const body = (await res.json().catch(() => ({}))) as { csrfToken?: string };
  return { cookie, csrfToken: body.csrfToken };
}

/**
 * Put the session cookie into the window's cookie jar.
 *
 * The value is copied verbatim: `@fastify/cookie` signs it, so re-encoding would break the
 * signature and every request would come back 401.
 */
export async function injectCookie(url: string, cookie: string): Promise<void> {
  await electronSession.defaultSession.cookies.set({
    url,
    name: 'sdods_sid',
    value: cookie,
    httpOnly: true,
    secure: false, // plain http on loopback
    sameSite: 'lax',
  });
}

/**
 * Get an authenticated session, whichever way is available: complete setup on a genuine first run,
 * otherwise sign in with the stored credentials.
 */
export async function authenticate(
  url: string,
  setupToken: string | null,
): Promise<{ creds: Credentials; csrfToken?: string }> {
  const creds = ensureCredentials();
  const result = setupToken ? await completeSetup(url, setupToken, creds) : await login(url, creds);
  saveCredentials(creds);
  await injectCookie(url, result.cookie);
  return { creds, csrfToken: result.csrfToken };
}
