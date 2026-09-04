import {
  sdodsMcpServerSpec,
  playwrightMcpSpec,
  requireCli,
  runJsonl,
  runQuiet,
  type CliAdapterContext,
} from './cli-common.js';
import { cliFailure } from './claude-code.js';
import {
  AgentsConfigError,
  DEFAULT_MODELS,
  type AgentEvent,
  type CompleteRequest,
  type CompleteResult,
  type LlmAdapter,
  type RunAgentOptions,
  type RunAgentResult,
  type TokenUsage,
} from './types.js';

const INSTALL_HINT =
  'Install Codex (`npm i -g @openai/codex`) and run `codex login`, or use --adapter claude-code, --adapter claude with ANTHROPIC_API_KEY, or --dry-run.';

/** Codex `exec --json` event stream → SDODS events. */
export function normalizeCodexEvent(ev: Record<string, any>): AgentEvent[] {
  const out: AgentEvent[] = [];
  const item = ev.item as Record<string, any> | undefined;
  switch (ev.type) {
    case 'item.started':
      if (item && isToolItem(item.type))
        out.push({ type: 'tool_call', id: item.id, name: toolName(item), input: toolInput(item) });
      break;
    case 'item.completed':
      if (!item) break;
      if (item.type === 'agent_message' && typeof item.text === 'string')
        out.push({ type: 'text', text: item.text });
      else if (item.type === 'error')
        out.push({ type: 'status', message: String(item.message ?? 'error') });
      else if (item.type === 'reasoning') {
        /* keep reasoning out of the transcript */
      } else if (isToolItem(item.type)) {
        // Codex does not always emit item.started for tools; emit the call if we have not seen it.
        out.push({
          type: 'tool_result',
          id: item.id,
          output: item.output ?? item.result ?? item.aggregated_output ?? item.changes ?? null,
          isError: item.status === 'failed' || item.status === 'error',
        });
      }
      break;
    case 'turn.failed':
    case 'error':
      out.push({
        type: 'status',
        message: String(ev.error?.message ?? ev.message ?? 'turn failed'),
      });
      break;
    default:
      break;
  }
  return out;
}

function isToolItem(type: string | undefined): boolean {
  return (
    type === 'mcp_tool_call' ||
    type === 'command_execution' ||
    type === 'file_change' ||
    type === 'web_search' ||
    type === 'tool_call'
  );
}

function toolName(item: Record<string, any>): string {
  if (item.type === 'mcp_tool_call')
    return `mcp__${item.server ?? 'mcp'}__${item.tool ?? item.name ?? 'tool'}`;
  if (item.type === 'command_execution') return 'shell';
  if (item.type === 'file_change') return 'file_change';
  if (item.type === 'web_search') return 'web_search';
  return String(item.name ?? item.type);
}

function toolInput(item: Record<string, any>): unknown {
  return item.arguments ?? item.input ?? item.command ?? item.query ?? null;
}

export function codexUsage(u: Record<string, any> | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
    outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
    cacheReadTokens: typeof u.cached_input_tokens === 'number' ? u.cached_input_tokens : undefined,
    cacheWriteTokens:
      typeof u.cache_write_input_tokens === 'number' ? u.cache_write_input_tokens : undefined,
  };
}

/**
 * Runs SDODS agent roles through the user's logged-in OpenAI Codex CLI (`codex exec --json`).
 * No OPENAI_API_KEY is needed when Codex is logged in with a ChatGPT account. The sdods MCP
 * server and the bundled Playwright MCP are injected with `-c mcp_servers.*` overrides; the run
 * is ephemeral, read-only sandboxed, and the system prompt is prepended to the task.
 */
export class CodexCliAdapter implements LlmAdapter {
  readonly provider = 'codex' as const;
  readonly defaultModel: string;

  constructor(private readonly ctx: CliAdapterContext & { model?: string } = {}) {
    this.defaultModel = ctx.model ?? process.env.SDODS_CODEX_MODEL ?? DEFAULT_MODELS.codex;
  }

  bin(): string {
    const bin = requireCli(this.ctx.bin ?? 'codex', INSTALL_HINT);
    if (process.env.SDODS_SKIP_CLI_AUTH_CHECK !== '1') {
      const r = runQuiet(bin, ['login', 'status']);
      if (r.ok && /not logged in/i.test(r.stdout)) {
        throw new AgentsConfigError(
          'Codex is installed but not logged in.',
          'Run `codex login` (ChatGPT account) or set OPENAI_API_KEY.',
        );
      }
    }
    return bin;
  }

  static loginStatus(bin = 'codex'): {
    installed: boolean;
    loggedIn: boolean | null;
    detail: string;
  } {
    const found = (() => {
      try {
        return requireCli(bin, '');
      } catch {
        return null;
      }
    })();
    if (!found) return { installed: false, loggedIn: null, detail: 'not installed' };
    const v = runQuiet(found, ['--version']);
    const s = runQuiet(found, ['login', 'status']);
    const loggedIn = s.ok ? !/not logged in/i.test(s.stdout) : null;
    return {
      installed: true,
      loggedIn,
      detail: `${v.stdout.trim().split('\n')[0] || 'installed'}${loggedIn ? ` · ${s.stdout.trim().split('\n')[0]}` : loggedIn === false ? ' · NOT logged in' : ''}`,
    };
  }

  private baseArgs(cwd: string | undefined, model?: string): string[] {
    const m = model ?? this.defaultModel;
    return [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '-s',
      'read-only',
      ...(cwd ? ['-C', cwd] : []),
      ...(m && m !== 'default' ? ['-m', m] : []),
    ];
  }

  private mcpArgs(o: { cwd?: string; mcpServers?: RunAgentOptions['mcpServers'] }): string[] {
    const sdods = sdodsMcpServerSpec({ ...this.ctx, rootDir: this.ctx.rootDir ?? o.cwd });
    const args = [
      '-c',
      `mcp_servers.sdods.command=${tomlString(sdods.command)}`,
      '-c',
      `mcp_servers.sdods.args=${tomlArray(sdods.args)}`,
    ];
    if (this.ctx.withPlaywrightMcp !== false) {
      const pw = playwrightMcpSpec();
      args.push(
        '-c',
        `mcp_servers.playwright.command=${tomlString(pw.command)}`,
        '-c',
        `mcp_servers.playwright.args=${tomlArray(pw.args)}`,
      );
    }
    for (const [name, cfg] of Object.entries(o.mcpServers ?? {})) {
      if (cfg.transport === 'http' && cfg.url) {
        args.push('-c', `mcp_servers.${name}.url=${tomlString(cfg.url)}`);
      } else if (cfg.command) {
        args.push(
          '-c',
          `mcp_servers.${name}.command=${tomlString(cfg.command)}`,
          '-c',
          `mcp_servers.${name}.args=${tomlArray(cfg.args ?? [])}`,
        );
      }
    }
    return args;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const bin = this.bin();
    let text = '';
    let usage: TokenUsage | undefined;
    const prompt = req.system ? `${req.system}\n\n---\n\n${req.prompt}` : req.prompt;
    const r = await runJsonl(bin, [...this.baseArgs(undefined, req.model), prompt], {
      signal: req.signal,
      onLine: (line) => {
        if (typeof line !== 'object' || !line) return;
        const ev = line as Record<string, any>;
        for (const e of normalizeCodexEvent(ev)) if (e.type === 'text') text += e.text;
        if (ev.type === 'turn.completed') usage = codexUsage(ev.usage);
      },
    });
    if (r.exitCode !== 0 && !text) throw cliFailure('codex', r.exitCode, r.stderr);
    return { text: text.trim(), usage };
  }

  async *stream(req: CompleteRequest): AsyncIterable<string> {
    const r = await this.complete(req);
    yield r.text;
  }

  async runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
    const bin = this.bin();
    const prompt = `${o.system}\n\n---\n\n${o.prompt}`;
    const args = [...this.baseArgs(o.cwd, o.model), ...this.mcpArgs(o), prompt];
    let text = '';
    let turns = 0;
    let toolCalls = 0;
    let usage: TokenUsage | undefined;
    let failed = false;
    const seenCalls = new Set<string>();
    const r = await runJsonl(bin, args, {
      cwd: o.cwd,
      signal: o.signal,
      onLine: (line) => {
        if (typeof line !== 'object' || !line) return;
        const ev = line as Record<string, any>;
        if (ev.type === 'turn.completed') {
          turns++;
          usage = codexUsage(ev.usage) ?? usage;
        }
        if (ev.type === 'turn.failed') failed = true;
        for (const e of normalizeCodexEvent(ev)) {
          if (e.type === 'tool_call') {
            seenCalls.add(e.id);
            toolCalls++;
          }
          if (e.type === 'tool_result' && !seenCalls.has(e.id)) {
            // no item.started was emitted for this tool: count the call now
            seenCalls.add(e.id);
            toolCalls++;
            o.onEvent?.({ type: 'tool_call', id: e.id, name: 'tool', input: null });
          }
          o.onEvent?.(e);
          if (e.type === 'text') text += e.text;
        }
        if (o.maxTurns && turns >= o.maxTurns) {
          o.onEvent?.({ type: 'status', message: `max turns (${o.maxTurns}) reached` });
        }
      },
    });
    const isError = failed || (r.exitCode !== 0 && !text);
    if (isError && !text) throw cliFailure('codex', r.exitCode, r.stderr);
    const result: RunAgentResult = {
      text,
      usage,
      turns: Math.max(turns, 1),
      stopReason: isError ? 'error' : 'end',
      isError,
      toolCalls,
    };
    o.onEvent?.({
      type: 'result',
      usage,
      turns: result.turns,
      stopReason: result.stopReason,
      isError,
    });
    return result;
  }
}

function tomlString(s: string): string {
  return JSON.stringify(s);
}

function tomlArray(items: string[]): string {
  return `[${items.map(tomlString).join(',')}]`;
}
