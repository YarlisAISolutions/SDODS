import { describe, expect, it } from 'vitest';
import { hasScope } from '@sdods/contracts';
import { redactHeaders, unsafeToolsEnabled } from '../src/browser/policy.js';
import { ToolRegistry, requiredScope, type Principal } from '../src/registry/registry.js';
import { browserTools } from '../src/tools/browser.js';

const registry = new ToolRegistry().registerAll(browserTools);
const caps = new Set(['browser' as const]);
const principal = (scopes: string[]): Principal => ({ scopes, via: 'http' });
const tool = (name: string) => registry.get(name)!;

describe('browser redaction', () => {
  it('masks credential headers in network output', () => {
    // Network results come back as TEXT, so the keyed-object redactor used elsewhere cannot apply.
    const raw = [
      '  authorization: Bearer eyJhbGciOi.SECRET.value',
      '  Cookie: session=abc123; other=def',
      '  set-cookie: sid=zzz; HttpOnly',
      '  x-api-key: sk-live-1234',
      '  content-type: application/json',
    ].join('\n');
    const out = redactHeaders(raw);
    expect(out).not.toContain('eyJhbGciOi');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('sk-live-1234');
    expect(out).not.toContain('sid=zzz');
    // Non-secret headers survive, or the output stops being useful.
    expect(out).toContain('content-type: application/json');
  });

  it('leaves ordinary page text alone', () => {
    const text = 'The authorization page loaded. Cookie policy accepted.';
    expect(redactHeaders(text)).toBe(text);
  });
});

describe('unsafe tools', () => {
  it('are off unless explicitly enabled', () => {
    expect(unsafeToolsEnabled({})).toBe(false);
    expect(unsafeToolsEnabled({ SDODS_BROWSER_ALLOW_UNSAFE: '0' })).toBe(false);
    expect(unsafeToolsEnabled({ SDODS_BROWSER_ALLOW_UNSAFE: '1' })).toBe(true);
  });

  it('refuse at call time even for an admin principal', async () => {
    // The env switch is what an operator can rely on: stdio's LOCAL_ADMIN holds every scope, so a
    // scope alone would never keep these off a developer machine.
    const prev = process.env.SDODS_BROWSER_ALLOW_UNSAFE;
    delete process.env.SDODS_BROWSER_ALLOW_UNSAFE;
    try {
      const res = await registry.call(
        'browser_run_code_unsafe',
        { code: '1' },
        {
          rootDir: '/repo',
          cwd: '/repo',
          principal: principal(['browser:admin']),
          caps,
          logger: { info() {}, warn() {}, debug() {} },
        },
      );
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.structuredContent)).toContain('BROWSER_UNSAFE_DISABLED');
    } finally {
      if (prev !== undefined) process.env.SDODS_BROWSER_ALLOW_UNSAFE = prev;
    }
  });
});

describe('browser scopes', () => {
  it('derives read and write from access, and admin from the override', () => {
    expect(requiredScope(tool('browser_snapshot'))).toBe('browser:read');
    expect(requiredScope(tool('browser_click'))).toBe('browser:write');
    expect(requiredScope(tool('browser_run_code_unsafe'))).toBe('browser:admin');
  });

  it('lets a viewer look but not act', () => {
    // browser:read lands in every viewer's scopes via the READ_SCOPES filter, so the acting tools
    // must be the ones that need browser:write — and starting a browser is an act.
    const viewer = principal(['projects:read', 'runs:read', 'browser:read']);
    expect(registry.isAllowed(tool('browser_snapshot'), { principal: viewer, caps })).toBe(true);
    expect(registry.isAllowed(tool('browser_click'), { principal: viewer, caps })).toBe(false);
    expect(registry.isAllowed(tool('browser_session_open'), { principal: viewer, caps })).toBe(
      false,
    );
    expect(registry.isAllowed(tool('browser_run_code_unsafe'), { principal: viewer, caps })).toBe(
      false,
    );
  });

  it('withholds the unsafe pair from an editor', () => {
    const editor = principal(['browser:read', 'browser:write']);
    expect(registry.isAllowed(tool('browser_click'), { principal: editor, caps })).toBe(true);
    expect(registry.isAllowed(tool('browser_evaluate'), { principal: editor, caps })).toBe(false);
    expect(hasScope(editor.scopes, 'browser:admin')).toBe(false);
  });

  it('hides the whole family when the capability is off', () => {
    const admin = principal(['*']);
    const noBrowser = new Set(['core' as const]);
    expect(registry.list({ principal: admin, caps: noBrowser })).toEqual([]);
  });
});
