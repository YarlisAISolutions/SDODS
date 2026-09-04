import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, defineTool, type ToolContext } from '../src/registry/registry.js';
import { toAgentSdkTools, toOpenAiFunctions, toolJsonSchema } from '../src/registry/adapters.js';
import { createRegistry } from '../src/tools/index.js';
import { buildToolContext, parseCaps } from '../src/server.js';

const echo = defineTool({
  name: 'echo_test',
  title: 'Echo',
  description: 'echo',
  shape: { text: z.string(), n: z.number().int().optional() },
  access: 'read',
  domain: 'projects',
  capability: 'core',
  handler: async (args) => ({
    text: `echo:${args.text}`,
    data: { text: args.text, n: args.n ?? 0 },
  }),
});

const writer = defineTool({
  name: 'write_test',
  title: 'Write',
  description: 'write',
  shape: {},
  access: 'write',
  domain: 'features',
  capability: 'agents',
  handler: async () => ({ text: 'wrote' }),
});

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return { ...buildToolContext({ rootDir: process.cwd(), caps: 'all' }), ...over };
}

describe('ToolRegistry', () => {
  it('registers, validates args and returns structured results with docs meta', async () => {
    const reg = new ToolRegistry().register(echo);
    const r = await reg.call('echo_test', { text: 'hi', n: 2 }, ctx());
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toEqual({ type: 'text', text: 'echo:hi' });
    expect(r.structuredContent).toEqual({ text: 'hi', n: 2 });
    expect(String(r._meta?.docsUrl)).toContain('#echo-test');
    const bad = await reg.call('echo_test', { text: 5 }, ctx());
    expect(bad.isError).toBe(true);
    expect((bad.structuredContent as any).error.code).toBe('INVALID_ARGS');
    const unknown = await reg.call('nope', {}, ctx());
    expect((unknown.structuredContent as any).error.code).toBe('UNKNOWN_TOOL');
  });

  it('gates by capability and scope', async () => {
    const reg = new ToolRegistry().registerAll([echo, writer]);
    const viewer = ctx({
      principal: { scopes: ['projects:read'], via: 'http' },
      caps: new Set(['core', 'agents']),
    });
    expect(reg.list(viewer).map((t) => t.name)).toEqual(['echo_test']);
    const denied = await reg.call('write_test', {}, viewer);
    expect((denied.structuredContent as any).error.code).toBe('INSUFFICIENT_SCOPE');
    const noCap = await reg.call('write_test', {}, ctx({ caps: new Set(['core']) }));
    expect((noCap.structuredContent as any).error.code).toBe('CAPABILITY_DISABLED');
    const editor = ctx({ principal: { scopes: ['projects:read', 'features:write'], via: 'http' } });
    expect((await reg.call('write_test', {}, editor)).content[0]).toEqual({
      type: 'text',
      text: 'wrote',
    });
  });

  it('adapters expose the same names and schemas', () => {
    const reg = new ToolRegistry().registerAll([echo, writer]);
    const c = ctx();
    const sdk = toAgentSdkTools(reg, c);
    const oa = toOpenAiFunctions(reg, c);
    expect(sdk.map((t) => t.name)).toEqual(['echo_test', 'write_test']);
    expect(oa.map((t) => t.function.name)).toEqual(['echo_test', 'write_test']);
    expect(oa[0]!.function.parameters).toEqual(toolJsonSchema(echo));
    expect((oa[0]!.function.parameters as any).required).toEqual(['text']);
    expect(sdk[0]!.annotations.readOnlyHint).toBe(true);
  });

  it('the default registry has every tool family and unique names', () => {
    const reg = createRegistry();
    const names = reg.all().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const prefix of [
      'project_',
      'workspace_',
      'process_',
      'feature_',
      'step_',
      'run_',
      'heal_',
      'data_',
      'analyze_',
      'issue_',
      'schedule_',
      'proposal_',
    ]) {
      expect(
        names.some((n) => n.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
    expect(
      reg.list(buildToolContext({ rootDir: process.cwd() })).some((t) => t.name === 'issue_create'),
    ).toBe(false);
    expect(
      reg
        .list(buildToolContext({ rootDir: process.cwd(), caps: 'all' }))
        .some((t) => t.name === 'issue_create'),
    ).toBe(true);
  });

  it('parses capability lists', () => {
    expect([...parseCaps(undefined)]).toEqual(['core', 'analyze', 'run', 'data', 'schedules']);
    expect([...parseCaps('core,agents')]).toEqual(['core', 'agents']);
    expect(parseCaps('all').size).toBe(7);
    expect(() => parseCaps('bogus')).toThrow(/Unknown capability/);
  });
});
