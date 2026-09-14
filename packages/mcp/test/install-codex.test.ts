import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cliCommands,
  codexConfigPath,
  codexTomlEntries,
  installClientConfig,
  installCodexConfig,
  snippets,
} from '../src/install/index.js';

describe('MCP install for Codex', () => {
  const originalHome = process.env.CODEX_HOME;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sdods-codex-home-'));
    process.env.CODEX_HOME = home;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalHome;
  });

  it('merges [mcp_servers.sdods] into an existing config.toml without touching other tables', () => {
    const file = codexConfigPath();
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      `model = "gpt-5"
approval_policy = "on-request"

[mcp_servers.node_repl]
command = "node"
args = ["repl.js"]

[mcp_servers.node_repl.env]
NODE_ENV = "test"

[mcp_servers.perplexity]
url = "https://mcp.perplexity.ai"
`,
    );
    const r = installCodexConfig({ project: 'demo-shop', env: 'staging' });
    expect(r.file).toBe(file);
    expect(r.created).toBe(false);
    const parsed = parseToml(readFileSync(file, 'utf8')) as any;
    expect(parsed.model).toBe('gpt-5');
    expect(parsed.approval_policy).toBe('on-request');
    expect(parsed.mcp_servers.node_repl).toEqual({
      command: 'node',
      args: ['repl.js'],
      env: { NODE_ENV: 'test' },
    });
    expect(parsed.mcp_servers.perplexity).toEqual({ url: 'https://mcp.perplexity.ai' });
    expect(parsed.mcp_servers.sdods).toEqual({
      command: 'npx',
      args: ['-y', '@sdods/cli', 'mcp', '--project', 'demo-shop', '--env', 'staging'],
    });
    // The raw upstream browser server is no longer registered alongside: the sdods server wraps
    // every one of its tools as browser_*, and a second ungoverned path to the same browser would
    // defeat that. `withPlaywright: true` still adds it for anyone who wants it.
    expect(parsed.mcp_servers.playwright).toBeUndefined();

    // second install is idempotent and can switch to HTTP
    installCodexConfig({ httpUrl: 'https://sdods.example.com/mcp', withPlaywright: false });
    const again = parseToml(readFileSync(file, 'utf8')) as any;
    expect(again.mcp_servers.sdods).toEqual({
      url: 'https://sdods.example.com/mcp',
      bearer_token_env_var: 'SDODS_TOKEN',
    });
    expect(again.mcp_servers.node_repl.args).toEqual(['repl.js']);
  });

  it('creates the file when CODEX_HOME is empty and routes through installClientConfig', () => {
    const r = installClientConfig('/unused-root', 'codex', { project: 'shop' });
    expect(r.created).toBe(true);
    const parsed = parseToml(readFileSync(r.file, 'utf8')) as any;
    expect(parsed.mcp_servers.sdods.args).toEqual(['-y', '@sdods/cli', 'mcp', '--project', 'shop']);
  });

  it('exposes snippets and CLI commands for codex', () => {
    const s = snippets({ project: 'shop' });
    expect(s.codex.toml).toContain('[mcp_servers.sdods]');
    expect(s.codex.cli).toBe('codex mcp add sdods -- npx -y @sdods/cli mcp --project shop');
    expect(cliCommands({ httpUrl: 'https://x/mcp' }).codex).toContain('--url https://x/mcp');
    expect(cliCommands({ project: 'shop' }).claude).toBe(
      'claude mcp add sdods -- npx -y @sdods/cli mcp --project shop',
    );
    expect(Object.keys(codexTomlEntries({ withPlaywright: false }))).toEqual(['sdods']);
  });
});
