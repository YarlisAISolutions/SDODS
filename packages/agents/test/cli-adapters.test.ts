import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeCodeCliAdapter } from '../src/adapter/claude-code.js';
import { CodexCliAdapter, normalizeCodexEvent } from '../src/adapter/codex.js';
import { findOnPath } from '../src/adapter/cli-common.js';
import { detectProvider, normalizeProvider, resolveProvider } from '../src/adapter/factory.js';
import { AgentsConfigError, type AgentEvent } from '../src/adapter/types.js';

/**
 * Fake `claude` and `codex` binaries that replay real output shapes captured from
 * Claude Code 2.1.260 (`claude -p … --output-format stream-json --verbose`) and
 * Codex 0.150.1 (`codex exec --json`), so the adapters are tested without a login.
 */
const CLAUDE_STREAM = [
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"s1","tools":["Read"],"mcp_servers":[{"name":"sdods","status":"connected"}]}',
  '{"type":"assistant","message":{"model":"claude-fable-5-1","id":"m1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"t1","name":"mcp__sdods__project_list","input":{}}],"usage":{"input_tokens":2,"output_tokens":1}},"session_id":"s1"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"[{\\"slug\\":\\"demo-shop\\"}]"}]}]},"session_id":"s1"}',
  '{"type":"assistant","message":{"model":"claude-fable-5-1","id":"m2","type":"message","role":"assistant","content":[{"type":"text","text":"pong"}],"usage":{"input_tokens":2,"output_tokens":1}},"session_id":"s1"}',
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"s1"}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":2500,"duration_api_ms":2329,"num_turns":2,"result":"pong","stop_reason":"end_turn","session_id":"s1","total_cost_usd":0.3357,"usage":{"input_tokens":2,"cache_creation_input_tokens":16641,"cache_read_input_tokens":10608,"output_tokens":4}}',
];

const CODEX_STREAM = [
  '{"type":"thread.started","thread_id":"01a06a42-4a84-7333-863f-5b509a89fe99"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"clamping SessionEnd hook timeout to 3s"}}',
  '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"sdods","tool":"project_list","arguments":{},"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"sdods","tool":"project_list","arguments":{},"status":"completed","result":{"content":[{"type":"text","text":"demo-shop"}]}}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"reasoning","text":"thinking"}}',
  '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"pong"}}',
  '{"type":"turn.completed","usage":{"input_tokens":18755,"cached_input_tokens":9984,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
];

function fakeBins(): { dir: string; claudeArgs: string; codexArgs: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-fake-cli-'));
  const claudeArgs = join(dir, 'claude.args');
  const codexArgs = join(dir, 'codex.args');
  const claude = join(dir, 'claude');
  writeFileSync(
    claude,
    `#!/bin/sh
printf '%s\\0' "$@" > "${claudeArgs}"
if [ "$1" = "--version" ]; then echo "2.1.260 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ]; then echo '{"loggedIn": true, "authMethod": "claude.ai"}'; exit 0; fi
cat <<'EOF'
${CLAUDE_STREAM.join('\n')}
EOF
`,
  );
  chmodSync(claude, 0o755);
  const codex = join(dir, 'codex');
  writeFileSync(
    codex,
    `#!/bin/sh
printf '%s\\0' "$@" > "${codexArgs}"
if [ "$1" = "--version" ]; then echo "codex-cli 0.150.1"; exit 0; fi
if [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi
cat <<'EOF'
${CODEX_STREAM.join('\n')}
EOF
`,
  );
  chmodSync(codex, 0o755);
  return { dir, claudeArgs, codexArgs };
}

describe('CLI adapters (claude-code, codex) against fake binaries', () => {
  const originalPath = process.env.PATH;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalOpenAi = process.env.OPENAI_API_KEY;
  let bins: ReturnType<typeof fakeBins>;

  beforeEach(() => {
    bins = fakeBins();
    process.env.PATH = `${bins.dir}${delimiter}${originalPath ?? ''}`;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SDODS_LLM_PROVIDER;
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalOpenAi) process.env.OPENAI_API_KEY = originalOpenAi;
  });

  it('finds the fake binaries on PATH and reports login status', () => {
    expect(findOnPath('claude')).toBe(join(bins.dir, 'claude'));
    expect(ClaudeCodeCliAdapter.loginStatus()).toMatchObject({ installed: true, loggedIn: true });
    expect(CodexCliAdapter.loginStatus()).toMatchObject({ installed: true, loggedIn: true });
    expect(ClaudeCodeCliAdapter.loginStatus('definitely-missing-bin')).toMatchObject({
      installed: false,
    });
  });

  it('claude-code: runs `claude -p` with MCP config, allowed tools and system prompt; normalises events', async () => {
    const adapter = new ClaudeCodeCliAdapter({
      rootDir: process.cwd(),
      project: 'demo-shop',
      env: 'staging',
    });
    const events: AgentEvent[] = [];
    const r = await adapter.runAgent({
      system: 'SYSTEM RULES',
      prompt: 'say pong',
      tools: [],
      maxTurns: 7,
      model: 'claude-opus-5',
      onEvent: (e) => events.push(e),
    });
    expect(r.text).toContain('pong');
    expect(r.costUsd).toBeCloseTo(0.3357, 3);
    expect(r.turns).toBe(2);
    expect(r.toolCalls).toBe(1);
    expect(r.isError).toBe(false);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['tool_call', 'tool_result', 'text', 'result']),
    );
    const args = (await import('node:fs'))
      .readFileSync(bins.claudeArgs, 'utf8')
      .split('\0')
      .slice(0, -1);
    expect(args).toContain('-p');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('mcp__sdods__*');
    expect(args).toContain('--disallowedTools');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('7');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('SYSTEM RULES');
    const mcpFile = args[args.indexOf('--mcp-config') + 1]!;
    const mcp = JSON.parse((await import('node:fs')).readFileSync(mcpFile, 'utf8'));
    expect(mcp.mcpServers.sdods.args).toEqual(
      expect.arrayContaining(['mcp', '--project', 'demo-shop', '--env', 'staging']),
    );
    expect(mcp.mcpServers.playwright.args).toEqual(['playwright', 'mcp', '--headless']);
    // complete() reuses the same binary
    expect((await adapter.complete({ prompt: 'ping' })).text).toBe('pong');
  });

  it('codex: runs `codex exec --json` with MCP overrides, counts turns/tools, maps usage', async () => {
    const adapter = new CodexCliAdapter({ rootDir: process.cwd(), project: 'demo-shop' });
    const events: AgentEvent[] = [];
    const r = await adapter.runAgent({
      system: 'SYSTEM RULES',
      prompt: 'say pong',
      tools: [],
      cwd: process.cwd(),
      onEvent: (e) => events.push(e),
    });
    expect(r.text).toBe('pong');
    expect(r.turns).toBe(1);
    expect(r.toolCalls).toBe(1);
    expect(r.usage).toMatchObject({ inputTokens: 18755, cacheReadTokens: 9984, outputTokens: 5 });
    expect(r.costUsd).toBeUndefined();
    expect(
      events.some((e) => e.type === 'tool_call' && e.name === 'mcp__sdods__project_list'),
    ).toBe(true);
    expect(events.some((e) => e.type === 'status')).toBe(true); // the hook warning
    const args = (await import('node:fs'))
      .readFileSync(bins.codexArgs, 'utf8')
      .split('\0')
      .slice(0, -1);
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check']);
    expect(args).toContain('--ephemeral');
    expect(args[args.indexOf('-s') + 1]).toBe('read-only');
    expect(args.some((a) => a.startsWith('mcp_servers.sdods.command='))).toBe(true);
    expect(
      args.some(
        (a) => a.startsWith('mcp_servers.sdods.args=[') && a.includes('"--project","demo-shop"'),
      ),
    ).toBe(true);
    expect(args[args.length - 1]).toContain('SYSTEM RULES');
    expect(args[args.length - 1]).toContain('say pong');
  });

  it('normalises Codex tool items without item.started', () => {
    const ev = normalizeCodexEvent({
      type: 'item.completed',
      item: {
        id: 'x',
        type: 'command_execution',
        command: 'ls',
        status: 'completed',
        aggregated_output: 'a',
      },
    });
    expect(ev).toEqual([{ type: 'tool_result', id: 'x', output: 'a', isError: false }]);
    expect(normalizeCodexEvent({ type: 'turn.failed', error: { message: 'boom' } })).toEqual([
      { type: 'status', message: 'boom' },
    ]);
  });

  it('auto-detects the provider: key → claude CLI → codex CLI → OPENAI key → fake', () => {
    expect(detectProvider({}).provider).toBe('claude-code'); // fake claude on PATH
    process.env.PATH = `${bins.dir}-none${delimiter}`;
    expect(detectProvider({}).provider).toBe('fake');
    expect(detectProvider({ OPENAI_API_KEY: 'k' }).provider).toBe('openai-compatible');
    expect(detectProvider({ ANTHROPIC_API_KEY: 'k' }).provider).toBe('claude');
    expect(normalizeProvider('claude-code')).toBe('claude-code');
    expect(normalizeProvider('codex')).toBe('codex');
    expect(() => normalizeProvider('gemini')).toThrow(AgentsConfigError);
    let picked = '';
    expect(resolveProvider(undefined, undefined, (p) => (picked = p))).toBe('fake');
    expect(picked).toBe('fake');
    expect(resolveProvider('codex')).toBe('codex');
  });

  it('fails clearly when the CLI is missing', () => {
    process.env.PATH = '/nonexistent';
    expect(() => new ClaudeCodeCliAdapter({ bin: 'claude' }).bin()).toThrow(/not installed/);
    expect(() => new CodexCliAdapter({ bin: 'codex' }).bin()).toThrow(/not installed/);
  });
});
