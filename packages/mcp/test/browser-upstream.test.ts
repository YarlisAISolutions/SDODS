import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePlaywrightBin } from '../src/browser/playwright-driver.js';

/**
 * Playwright ships its MCP server INSIDE playwright-core, so a routine `@playwright/test` bump
 * changes the tool surface with nothing in the changelog about it. This is what turns that from a
 * silent break into a failure with a diff.
 *
 * It spawns the server but never a browser, so it runs in ordinary CI.
 */
const repoRoot = join(import.meta.dirname, '..', '..', '..');
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/playwright-mcp-tools.json'), 'utf8'),
) as {
  serverInfo: { version: string };
  caps: string;
  tools: Array<{ name: string; inputSchema: unknown }>;
};

async function liveTools(): Promise<{ version: string; tools: Map<string, unknown> } | null> {
  const bin = resolvePlaywrightBin(repoRoot);
  if (!bin || !existsSync(bin)) return null;
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const client = new Client({ name: 'sdods-drift', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: bin.endsWith('.js') ? process.execPath : bin,
      args: [...(bin.endsWith('.js') ? [bin] : []), 'mcp', '--headless', '--caps', fixture.caps],
      cwd: repoRoot,
      stderr: 'ignore',
    }),
  );
  const info = client.getServerVersion();
  const listed = await client.listTools();
  await client.close();
  return {
    version: String(info?.version ?? 'unknown'),
    tools: new Map(listed.tools.map((t) => [t.name, t.inputSchema])),
  };
}

describe('pinned Playwright MCP', () => {
  it('offers exactly the tools the fixture records', { timeout: 120_000 }, async () => {
    const live = await liveTools();
    if (!live) {
      // A fresh clone without `bun install` should not fail here; the unit tests still guard the
      // wrapper against the fixture.
      console.warn('playwright binary not resolvable — skipping the live drift check');
      return;
    }
    expect(
      live.version,
      'regenerate: bun run mcp:browser-fixture && bun run mcp:browser-shapes',
    ).toBe(fixture.serverInfo.version);
    expect([...live.tools.keys()].sort()).toEqual(fixture.tools.map((t) => t.name).sort());
    for (const t of fixture.tools) {
      expect(live.tools.get(t.name), `${t.name} schema changed upstream`).toEqual(t.inputSchema);
    }
  });
});
