import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REDACTED,
  redactRunTraces,
  redactTraceJsonl,
  redactTraceZip,
} from '../src/evidence/trace-redact.js';
import { crc32, entryContent, readZip, writeZip } from '../src/evidence/zip.js';

/**
 * A REAL Playwright trace, recorded against a local server, with a credential in every channel the
 * redactor claims to cover. Each secret enters only through that channel — never as a literal in
 * page source, an evaluated script or a response body — so "absent after" proves redaction rather
 * than luck, and "present before" proves the trace actually carried it.
 */
const SECRETS = {
  setCookie: 'SETCOOKIE_session_7f3a',
  presetCookie: 'PRESETCOOKIE_4b1c',
  addedCookie: 'ADDEDCOOKIE_9d2e',
  bearer: 'BEARER_eyJhbGciOiJSUzI1NiJ9_a1b2',
  apiKey: 'APIKEY_c3d4',
  refreshToken: 'REFRESH_AMf-vBx_e5f6',
  httpPassword: 'HTTPPASS_g7h8',
  typedPassword: 'TYPEDPASS_i9j0',
} as const;

let server: Server;
let base: string;
let dir: string;
let tracePath: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Set-Cookie', `__session=${SECRETS.setCookie}; Path=/; HttpOnly`);
      res.setHeader('content-type', 'text/html');
      // No secret literal here: the page copies the preset localStorage token into
      // sessionStorage and IndexedDB, the way Firebase persists its auth user.
      res.end(`<!doctype html><html><body>
        <label>Password <input id="password" type="password"></label>
        <script>
          const token = localStorage.getItem('firebase:authUser');
          sessionStorage.setItem('firebase:authUser', token);
          const open = indexedDB.open('firebaseLocalStorageDb', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
          open.onsuccess = () => {
            const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
            tx.objectStore('firebaseLocalStorage').put({ fbase_key: 'authUser', value: token });
            tx.oncomplete = () => { document.title = 'ready'; };
          };
          fetch('/api/me');
        </script></body></html>`);
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(join(tmpdir(), 'sdods-trace-redact-'));
  tracePath = join(dir, 'trace.zip');

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${SECRETS.bearer}`, 'X-Api-Key': SECRETS.apiKey },
      httpCredentials: { username: 'pool-user', password: SECRETS.httpPassword },
      storageState: {
        cookies: [
          {
            name: 'pre',
            value: SECRETS.presetCookie,
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [
          {
            origin: base,
            localStorage: [
              {
                name: 'firebase:authUser',
                value: JSON.stringify({ stsTokenManager: { refreshToken: SECRETS.refreshToken } }),
              },
            ],
          },
        ],
      },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    await page.goto(`${base}/`);
    await page.waitForFunction(() => document.title === 'ready');
    await context.addCookies([{ name: 'added', value: SECRETS.addedCookie, url: base }]);
    await page.locator('#password').fill(SECRETS.typedPassword);
    await context.storageState({ indexedDB: true });
    await page.reload();
    await context.tracing.stop({ path: tracePath });
  } finally {
    await browser.close();
  }
}, 60_000);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Every entry's decompressed content, by name. */
function contents(buf: Buffer): Map<string, Buffer> {
  return new Map(readZip(buf).map((e) => [e.name, entryContent(e)]));
}

function leaks(buf: Buffer): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [name, body] of contents(buf)) {
    const text = body.toString('latin1');
    for (const [label, secret] of Object.entries(SECRETS))
      if (text.includes(secret)) (found[label] ??= []).push(name);
  }
  return found;
}

describe('redactTraceZip on a real Playwright trace', () => {
  it('the unredacted trace carries every credential (the test is meaningful)', () => {
    const found = leaks(readFileSync(tracePath));
    expect(Object.keys(found).sort()).toEqual(Object.keys(SECRETS).sort());
    // Only the event streams carry them: nothing leaked through a body the redactor does not cover.
    for (const names of Object.values(found))
      for (const name of names) expect(name).toMatch(/\.(trace|network)$/);
  });

  it('removes every credential and keeps the trace structurally intact', () => {
    const original = readFileSync(tracePath);
    const { buffer, changed, trace } = redactTraceZip(original);
    expect(trace).toBe(true);
    expect(changed).toBeGreaterThanOrEqual(Object.keys(SECRETS).length);
    expect(leaks(buffer)).toEqual({});

    const before = readZip(original);
    const after = readZip(buffer);
    expect(after.map((e) => e.name)).toEqual(before.map((e) => e.name));
    for (const [i, entry] of after.entries()) {
      const content = entryContent(entry);
      expect(crc32(content)).toBe(entry.crc);
      expect(content.length).toBe(entry.size);
      if (/\.(trace|network)$/.test(entry.name)) {
        const lines = content.toString('utf8').split('\n').filter(Boolean);
        expect(lines.length).toBe(
          entryContent(before[i]!).toString('utf8').split('\n').filter(Boolean).length,
        );
        for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      } else {
        expect(content.equals(entryContent(before[i]!))).toBe(true);
      }
    }

    const events = contents(buffer).get('trace.trace')!.toString('utf8');
    const options = JSON.parse(events.split('\n')[0]!);
    expect(options.type).toBe('context-options');
    expect(options.options.storageState.cookies[0]).toMatchObject({ name: 'pre', value: REDACTED });
    expect(events).toContain('"method":"fill"');
    const network = contents(buffer).get('trace.network')!.toString('utf8');
    expect(network).toContain(`{"name":"Authorization","value":"${REDACTED}"}`);
    expect(network).toContain(`{"name":"Set-Cookie","value":"${REDACTED}"}`);
    // Non-credential headers are left alone.
    expect(network).toMatch(
      /"name":"(content-type|Content-Type)","value":"(text\/html|application\/json)"/,
    );
  });

  it('is idempotent', () => {
    const once = redactTraceZip(readFileSync(tracePath)).buffer;
    const twice = redactTraceZip(once);
    expect(twice.changed).toBe(0);
    expect(twice.buffer).toBe(once);
  });
});

describe('redactRunTraces', () => {
  it('redacts runner-output, the HTML report copy and the BASE64 body in messages.ndjson', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sdods-run-'));
    const trace = readFileSync(tracePath);
    const put = (rel: string, data: Buffer | string) => {
      mkdirSync(join(runDir, rel, '..'), { recursive: true });
      writeFileSync(join(runDir, rel), data);
    };
    put('runner-output/login-chromium/trace.zip', trace);
    put('html-report/data/0123abcd.zip', trace);
    // A zip that is not a trace is left byte-for-byte alone.
    const other = writeZip(
      readZip(trace)
        .filter((e) => e.name.startsWith('resources/'))
        .slice(0, 1),
    );
    put('attachments/other.zip', other);
    const attachment = {
      attachment: {
        testCaseStartedId: 't1',
        mediaType: 'application/zip',
        fileName: 'trace',
        contentEncoding: 'BASE64',
        body: trace.toString('base64'),
      },
    };
    put('messages.ndjson', `{"meta":{}}\n${JSON.stringify(attachment)}\n`);

    const result = redactRunTraces(runDir);
    expect(result.errors).toEqual([]);
    expect(result.files.map((f) => f.slice(runDir.length + 1)).sort()).toEqual([
      'html-report/data/0123abcd.zip',
      'messages.ndjson',
      'runner-output/login-chromium/trace.zip',
    ]);
    for (const rel of ['runner-output/login-chromium/trace.zip', 'html-report/data/0123abcd.zip'])
      expect(leaks(readFileSync(join(runDir, rel)))).toEqual({});
    expect(readFileSync(join(runDir, 'attachments/other.zip')).equals(other)).toBe(true);

    const messages = readFileSync(join(runDir, 'messages.ndjson'), 'utf8');
    for (const secret of Object.values(SECRETS)) expect(messages).not.toContain(secret);
    const body = JSON.parse(messages.split('\n')[1]!).attachment.body as string;
    expect(leaks(Buffer.from(body, 'base64'))).toEqual({});
    expect(messages.split('\n')[0]).toBe('{"meta":{}}');

    expect(redactRunTraces(runDir).files).toEqual([]);
  });
});

describe('redactTraceJsonl (runner-mode events)', () => {
  it('redacts a password typed through a test-runner pw:api step, and leaves other fills alone', () => {
    const lines = [
      {
        type: 'before',
        callId: 'pw:api@95',
        class: 'Test',
        method: 'pw:api',
        title: 'Fill "hunter2"',
        subtitle: "locator('#password')",
        params: { locator: "locator('#password')", value: 'hunter2' },
      },
      {
        type: 'before',
        callId: 'pw:api@92',
        class: 'Test',
        method: 'pw:api',
        title: 'Fill "standard_user"',
        subtitle: "locator('#user-name')",
        params: { locator: "locator('#user-name')", value: 'standard_user' },
      },
      {
        type: 'before',
        method: 'fulfill',
        class: 'Route',
        params: { headers: [{ name: 'set-cookie', value: 'sid=abc' }] },
      },
    ];
    const { text, changed } = redactTraceJsonl(lines.map((l) => JSON.stringify(l)).join('\n'));
    expect(changed).toBe(2);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('sid=abc');
    expect(text).toContain('Fill \\"standard_user\\"');
    expect(JSON.parse(text.split('\n')[0]!).title).toBe(`Fill "${REDACTED}"`);
  });

  it('keeps lines it cannot parse', () => {
    expect(redactTraceJsonl('not json\n{"type":"log"}\n')).toEqual({
      text: 'not json\n{"type":"log"}\n',
      changed: 0,
    });
  });
});
