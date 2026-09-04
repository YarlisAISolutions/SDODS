import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthStateCache } from '../src/fixtures/auth.js';

function cache(maxAgeMinutes = 120) {
  const root = mkdtempSync(join(tmpdir(), 'automax-auth-'));
  const config = {
    project: { root, auth: { maxAgeMinutes, strategy: 'form', storageState: true } },
    env: { name: 'staging' },
  } as any;
  return { root, cache: new AuthStateCache(config) };
}

const user = {
  id: '1',
  username: 'standard_user',
  password: 'x',
  role: 'standard',
  index: 0,
} as any;
const nowSec = () => Math.floor(Date.now() / 1000);

describe('AuthStateCache freshness', () => {
  it('is fresh when the sidecar is young and a cookie is still valid', () => {
    const { cache: c } = cache();
    c.save(user, {
      cookies: [{ name: 'session', value: 'v', domain: 'x', path: '/', expires: nowSec() + 600 }],
    });
    expect(c.isFresh(user)).toBe(true);
  });

  it('is stale when every cookie expired, even if localStorage survives (SauceDemo-style 10 min sessions)', () => {
    const { cache: c } = cache();
    c.save(user, {
      cookies: [{ name: 'session', value: 'v', domain: 'x', path: '/', expires: nowSec() - 60 }],
      origins: [{ origin: 'https://x', localStorage: [{ name: 'analytics-id', value: 'abc' }] }],
    });
    expect(c.isFresh(user)).toBe(false);
  });

  it('is stale when the sidecar is older than maxAgeMinutes or the file is corrupt', () => {
    const { cache: c } = cache(1);
    c.save(user, {
      cookies: [{ name: 's', value: 'v', domain: 'x', path: '/', expires: nowSec() + 600 }],
    });
    writeFileSync(
      c.sidecarFor(user),
      JSON.stringify({
        capturedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        user: 'u',
        role: 'standard',
      }),
    );
    expect(c.isFresh(user)).toBe(false);

    const { cache: c2 } = cache();
    mkdirSync(c2.dir, { recursive: true });
    writeFileSync(c2.fileFor(user), '{ not json');
    writeFileSync(c2.sidecarFor(user), JSON.stringify({ capturedAt: new Date().toISOString() }));
    expect(c2.isFresh(user)).toBe(false);
  });

  it('saves atomically (no temp files left) and lists states with age', () => {
    const { cache: c } = cache();
    const file = c.save(user, {
      cookies: [{ name: 's', value: 'v', domain: 'x', path: '/', expires: -1 }],
    });
    expect(JSON.parse(readFileSync(file, 'utf8')).cookies).toHaveLength(1);
    const listed = c.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.role).toBe('standard');
    expect(listed[0]!.ageMinutes).toBe(0);
  });

  it('serialises concurrent refreshes so login runs once', async () => {
    const { cache: c } = cache();
    let logins = 0;
    const auth = {
      strategy: 'form',
      login: async () => {
        logins++;
        await new Promise((r) => setTimeout(r, 50));
        return {
          cookies: [{ name: 's', value: 'v', domain: 'x', path: '/', expires: nowSec() + 600 }],
        };
      },
    } as any;
    const results = await Promise.all([
      c.ensure(user, auth, {} as any),
      c.ensure(user, auth, {} as any),
    ]);
    expect(results[0]).toBe(results[1]);
    expect(logins).toBe(1);
  });
});
