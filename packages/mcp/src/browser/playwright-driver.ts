import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserDriver, DriverResult } from './types.js';
import { redactHeaders } from './policy.js';

/**
 * Drives the Playwright MCP server that ships inside the pinned `playwright`.
 *
 * Not `npx playwright mcp`: npx resolves at run time, which is how this repo ended up with
 * `.mcp.json` pointing at a server nobody had pinned. The binary is resolved from node_modules so
 * the tools the wrapper declares and the tools the child offers come from the same install — the
 * drift test asserts exactly that.
 */
export function resolvePlaywrightBin(repoRoot: string): string | null {
  const candidates = [
    join(repoRoot, 'node_modules', '.bin', 'playwright'),
    join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export interface PlaywrightDriverOptions {
  repoRoot: string;
  argv: string[];
  /** Merged into the child's args map before each call; see UPSTREAM_DEFAULTS. */
  defaultsFor?: (tool: string) => Record<string, unknown> | undefined;
}

export async function createPlaywrightDriver(
  opts: PlaywrightDriverOptions,
): Promise<BrowserDriver> {
  const bin = resolvePlaywrightBin(opts.repoRoot);
  if (!bin) {
    throw Object.assign(new Error('Playwright is not installed in this workspace.'), {
      error: { code: 'BROWSER_UNAVAILABLE', hint: 'Run `bun install`.' },
    });
  }

  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');

  const client = new Client({ name: 'sdods-browser', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: bin.endsWith('.js') ? process.execPath : bin,
    args: bin.endsWith('.js') ? [bin, ...opts.argv] : opts.argv,
    env: { ...(process.env as Record<string, string>) },
    // The child restricts file access to its workspace roots, so the repo root is what makes
    // browser_file_upload of a repo path and the .sdods output directory reachable.
    cwd: opts.repoRoot,
    stderr: 'ignore',
  });
  await client.connect(transport);
  const server = client.getServerVersion() ?? { name: 'unknown', version: 'unknown' };

  return {
    info: () => ({ server: String(server.name), version: String(server.version) }),
    async listTools() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    async call(tool, args) {
      // Upstream schemas are additionalProperties:false, so SDODS-only arguments must not be
      // forwarded, and the properties upstream marks required-with-default must be filled back in.
      const { sessionId: _drop, ...rest } = args as Record<string, unknown>;
      const merged = { ...(opts.defaultsFor?.(tool) ?? {}), ...rest };
      const result = (await client.callTool({ name: tool, arguments: merged })) as {
        content?: Array<Record<string, unknown>>;
        isError?: boolean;
      };
      const out: DriverResult = { text: '', images: [], isError: Boolean(result.isError) };
      const parts: string[] = [];
      for (const c of result.content ?? []) {
        if (c.type === 'text') parts.push(String(c.text ?? ''));
        else if (c.type === 'image')
          out.images.push({ data: String(c.data), mimeType: String(c.mimeType ?? 'image/png') });
        else parts.push(`[${String(c.type)}]`);
      }
      out.text = redactHeaders(parts.join('\n'));
      return out;
    },
    async close() {
      await client.close().catch(() => undefined);
    },
  };
}
