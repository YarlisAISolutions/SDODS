import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BROWSER_TOOLS, UNSAFE_TOOLS } from '../src/browser/manifest.js';
import { UPSTREAM_DEFAULTS, UPSTREAM_SHAPES } from '../src/browser/shapes.js';
import { browserTools } from '../src/tools/browser.js';

/**
 * The wrapper republishes someone else's API. These assert the republished copy still matches the
 * server it was generated from, without needing that server: the fixture is the record of what it
 * offered, and `browser-upstream.test.ts` proves the fixture still matches a live one.
 */
interface Dump {
  serverInfo: { version: string };
  tools: Array<{ name: string; inputSchema: any }>;
}
const dump = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/playwright-mcp-tools.json'), 'utf8'),
) as Dump;
const upstream = new Map(dump.tools.map((t) => [t.name, t.inputSchema]));

/** JSON Schema for a wrapper's shape, minus the argument SDODS adds. */
function wrapperSchema(name: string) {
  const tool = browserTools.find((t) => t.name === name)!;
  const { sessionId: _drop, ...rest } = tool.shape as Record<string, z.ZodTypeAny>;
  return z.toJSONSchema(z.object(rest)) as any;
}

describe('browser tool schemas match the pinned Playwright MCP', () => {
  it('wraps every upstream tool and invents none', () => {
    expect(Object.keys(UPSTREAM_SHAPES).sort()).toEqual([...upstream.keys()].sort());
    expect(Object.keys(BROWSER_TOOLS).sort()).toEqual([...upstream.keys()].sort());
  });

  it.each([...upstream.keys()])('%s has the same properties as upstream', (name) => {
    const got = wrapperSchema(name);
    const want = upstream.get(name)!;
    expect(Object.keys(got.properties ?? {}).sort()).toEqual(
      Object.keys(want.properties ?? {}).sort(),
    );
  });

  it.each([...upstream.keys()])('%s keeps upstream enums exactly', (name) => {
    const got = wrapperSchema(name);
    const want = upstream.get(name)!;
    for (const [key, spec] of Object.entries<any>(want.properties ?? {})) {
      const mine = (got.properties ?? {})[key];
      if (spec.enum)
        expect([...(mine.enum ?? [])].sort(), `${name}.${key}`).toEqual([...spec.enum].sort());
      if (spec.items?.enum)
        expect([...(mine.items?.enum ?? [])].sort(), `${name}.${key}[]`).toEqual(
          [...spec.items.enum].sort(),
        );
    }
  });

  it.each([...upstream.keys()])('%s requires what upstream requires, defaults aside', (name) => {
    const want = upstream.get(name)!;
    const defaults = Object.keys(UPSTREAM_DEFAULTS[name as keyof typeof UPSTREAM_DEFAULTS] ?? {});
    // A property upstream marks required while giving it a default is optional here; the driver
    // fills it back in, so the call on the wire is unchanged.
    const expected = (want.required ?? []).filter((r: string) => !defaults.includes(r)).sort();
    expect((wrapperSchema(name).required ?? []).sort()).toEqual(expected);
  });

  it('every default it relaxes is genuinely required-with-default upstream', () => {
    for (const [tool, defs] of Object.entries(UPSTREAM_DEFAULTS)) {
      const schema = upstream.get(tool)!;
      for (const [key, value] of Object.entries(defs!)) {
        expect(schema.required, `${tool}.${key}`).toContain(key);
        expect(schema.properties[key].default, `${tool}.${key}`).toEqual(value);
      }
    }
  });

  it('every wrapper takes a sessionId', () => {
    for (const tool of browserTools) {
      if (tool.name === 'browser_session_list') continue;
      expect(Object.keys(tool.shape), tool.name).toContain('sessionId');
    }
  });

  it('only the two code-execution tools are admin-scoped', () => {
    expect(UNSAFE_TOOLS.sort()).toEqual(['browser_evaluate', 'browser_run_code_unsafe']);
    for (const name of UNSAFE_TOOLS)
      expect(browserTools.find((t) => t.name === name)!.scope).toBe('browser:admin');
  });

  it('observe tools are read and acting tools are write', () => {
    // `run` would derive runs:write through scopeForToolAccess, handing browser control to
    // anything allowed to start a test.
    for (const tool of browserTools) {
      expect(['read', 'write'], tool.name).toContain(tool.access);
      expect(tool.domain, tool.name).toBe('browser');
      expect(tool.capability, tool.name).toBe('browser');
    }
    expect(browserTools.find((t) => t.name === 'browser_snapshot')!.access).toBe('read');
    expect(browserTools.find((t) => t.name === 'browser_click')!.access).toBe('write');
    expect(browserTools.find((t) => t.name === 'browser_navigate')!.access).toBe('write');
  });
});
