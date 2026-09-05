import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthStateCache } from '../src/fixtures/auth.js';
import type { ResolvedConfig } from '../src/config/index.js';

/**
 * A captured storage state is a live session for the application under test — cookies and
 * localStorage, replayable as-is. It used to be written 0644 inside a 0755 directory, so any other
 * account on the machine could lift it. Encryption is not the control here: the state must be
 * decryptable to be replayed, so the key would have to sit on the same disk. Access is.
 */
describe('captured auth state is owner-only', () => {
  let root: string;
  const cacheFor = (r: string) =>
    new AuthStateCache({ project: { root: r }, env: { name: 'local' } } as ResolvedConfig);

  beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'sdods-auth-'))));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes the state file 0600 in a 0700 directory', () => {
    const cache = cacheFor(root);
    const file = cache.save({ username: 'u1', role: 'standard', index: 0 }, { cookies: [] });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(cache.dir).mode & 0o777).toBe(0o700);
  });

  it('protects every file it leaves behind, sidecar included', () => {
    const cache = cacheFor(root);
    cache.save({ username: 'u2', role: 'admin', index: 1 }, { cookies: [] });
    const files = readdirSync(cache.dir);
    expect(files.length).toBeGreaterThan(1); // state + sidecar
    for (const f of files) {
      expect(statSync(join(cache.dir, f)).mode & 0o777, `${f} should be owner-only`).toBe(0o600);
    }
  });
});
