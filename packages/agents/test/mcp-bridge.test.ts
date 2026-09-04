import { describe, expect, it } from 'vitest';
import { bridgeMcpServers } from '../src/adapter/mcp-bridge.js';

/**
 * The bridge is what lets a chat-completions adapter use MCP at all. These tests use a real
 * stdio server — the sdods MCP server itself — because the interesting failures (a server that
 * will not start, a tool list that arrives late) only happen over a real transport.
 */
describe('bridgeMcpServers', () => {
  it('returns nothing when no server is configured', async () => {
    const bridged = await bridgeMcpServers({});
    expect(bridged.tools).toEqual([]);
    await bridged.close();
  });

  it('exposes another server’s tools as namespaced functions', async () => {
    const bridged = await bridgeMcpServers({
      servers: {
        sdods: {
          transport: 'stdio',
          command: process.execPath,
          args: ['--import', 'tsx', 'packages/cli/src/bin.ts', 'mcp', '--caps', 'core'],
          env: { SDODS_MCP_QUIET: '1' },
        },
      },
      cwd: process.cwd(),
    });
    try {
      expect(bridged.tools.length).toBeGreaterThan(0);
      for (const tool of bridged.tools) expect(tool.name).toMatch(/^mcp__sdods__/);
      const list = bridged.tools.find((t) => t.name === 'mcp__sdods__project_list');
      expect(list).toBeDefined();
      // The schema comes over the wire as JSON Schema and is passed through, not re-derived.
      expect(list!.parametersJsonSchema).toMatchObject({ type: 'object' });
      const result = await list!.handler({});
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain('demo-shop');
    } finally {
      await bridged.close();
    }
  }, 60_000);

  it('keeps going when a server cannot start', async () => {
    const events: string[] = [];
    const bridged = await bridgeMcpServers({
      servers: { broken: { transport: 'stdio', command: 'definitely-not-a-command' } },
      onEvent: (e) => events.push(e.type === 'status' ? e.message : e.type),
    });
    expect(bridged.tools).toEqual([]);
    expect(events.join(' ')).toMatch(/broken unavailable/);
    await bridged.close();
  }, 30_000);
});
