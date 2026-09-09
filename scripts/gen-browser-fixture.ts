/**
 * Dumps `tools/list` from the PINNED Playwright MCP server into a fixture.
 *
 * Pinned matters: `npx playwright mcp` resolves at runtime, and the standalone `@playwright/mcp`
 * package is a different server with a different tool set (44 vs 42 at the time of writing, and it
 * depends on a pre-release Playwright). This spawns the binary the repo actually depends on, and
 * records the version it reported, so the wrapper and its drift test can never be measured against
 * a server nobody installed.
 *
 * `bun run mcp:browser-fixture`, then `bun run mcp:browser-shapes`.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, 'packages/mcp/test/fixtures/playwright-mcp-tools.json');
const CAPS = 'vision,pdf,devtools';

const child = spawn(
  join(repoRoot, 'node_modules/.bin/playwright'),
  ['mcp', '--headless', '--caps', CAPS],
  {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
  },
);

let serverInfo: unknown;
let buf = '';
const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`);

child.stdout.on('data', (chunk: Buffer) => {
  buf += chunk.toString();
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 1) {
      serverInfo = msg.result.serverInfo;
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    }
    if (msg.id === 2) {
      const tools = [...msg.result.tools]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations ?? null,
        }));
      writeFileSync(OUT, `${JSON.stringify({ serverInfo, caps: CAPS, tools }, null, 2)}\n`);
      console.log(
        `gen-browser-fixture — ${tools.length} tool(s) from ${JSON.stringify(serverInfo)}`,
      );
      child.kill();
      process.exit(0);
    }
  }
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'sdods-fixture', version: '1' },
  },
});
setTimeout(() => {
  console.error('gen-browser-fixture — timed out waiting for the server');
  child.kill();
  process.exit(1);
}, 90_000);
