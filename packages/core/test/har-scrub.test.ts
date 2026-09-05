import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scrubHar, scrubHarFile } from '../src/har/scrub.js';

/**
 * The API layer redacts secret headers as it builds its HAR. The browser layer never did:
 * Playwright's routeFromHAR({ update: true }) writes the file verbatim, so recording against a
 * real application while signed in put a live Cookie / Authorization header into a file the
 * project is expected to commit.
 */
const har = () => ({
  log: {
    entries: [
      {
        request: {
          headers: [
            { name: 'Cookie', value: 'session=super-secret-value' },
            { name: 'Authorization', value: 'Bearer abc.def.ghi' },
            { name: 'Accept', value: 'application/json' },
          ],
          cookies: [{ name: 'session', value: 'super-secret-value' }],
        },
        response: {
          headers: [
            { name: 'set-cookie', value: 'session=rotated; HttpOnly' },
            { name: 'Content-Type', value: 'application/json' },
          ],
          cookies: [],
        },
      },
    ],
  },
});

describe('scrubHar', () => {
  it('replaces credential headers and leaves the rest alone', () => {
    const h = har();
    const { changed } = scrubHar(h);
    expect(changed).toBe(4); // request Cookie + Authorization + request cookie[], response set-cookie
    const req = h.log.entries[0]!.request;
    expect(req.headers.find((x) => x.name === 'Cookie')!.value).toBe('***');
    expect(req.headers.find((x) => x.name === 'Authorization')!.value).toBe('***');
    expect(req.headers.find((x) => x.name === 'Accept')!.value).toBe('application/json');
    expect(req.cookies[0]!.value).toBe('***');
    expect(h.log.entries[0]!.response.headers[0]!.value).toBe('***');
    expect(h.log.entries[0]!.response.headers[1]!.value).toBe('application/json');
  });

  it('keeps the header present so replay still matches on it', () => {
    const h = har();
    scrubHar(h);
    expect(h.log.entries[0]!.request.headers.map((x) => x.name)).toContain('Cookie');
  });

  it('is idempotent', () => {
    const h = har();
    scrubHar(h);
    expect(scrubHar(h).changed).toBe(0);
  });

  it('tolerates a HAR with no entries and unreadable files', () => {
    expect(scrubHar({}).changed).toBe(0);
    expect(scrubHarFile('/nope/missing.har')).toBe(-1);
  });
});

describe('scrubHarFile', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'sdods-har-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('rewrites the file and reports how many values it replaced', () => {
    const file = join(dir, 'login.har');
    writeFileSync(file, JSON.stringify(har()));
    expect(scrubHarFile(file)).toBe(4);
    const after = readFileSync(file, 'utf8');
    expect(after).not.toContain('super-secret-value');
    expect(after).not.toContain('abc.def.ghi');
    expect(scrubHarFile(file)).toBe(0);
  });
});
