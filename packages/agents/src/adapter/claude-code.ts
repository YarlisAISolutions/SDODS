import { normalize } from './claude.js';
import {
  mcpServerMap,
  requireCli,
  runJsonl,
  runQuiet,
  writeTempJson,
  type CliAdapterContext,
} from './cli-common.js';
import {
  AgentsConfigError,
  DEFAULT_MODELS,
  type CompleteRequest,
  type CompleteResult,
  type LlmAdapter,
  type RunAgentOptions,
  type RunAgentResult,
} from './types.js';

const INSTALL_HINT =
  'Install Claude Code (`npm i -g @anthropic-ai/claude-code`) and run `claude login`, or use --adapter claude with ANTHROPIC_API_KEY, --adapter codex, or --dry-run.';

/**
 * Runs AutoMax agent roles through the user's logged-in Claude Code CLI (`claude -p`).
 * No ANTHROPIC_API_KEY is needed: the CLI's own login (claude.ai subscription or key) is used.
 * Tools reach the CLI through the automax MCP server (stdio) plus the bundled Playwright MCP;
 * file tools are restricted to Read/Glob/Grep and Bash/Write/Edit are disallowed.
 */
export class ClaudeCodeCliAdapter implements LlmAdapter {
  readonly provider = 'claude-code' as const;
  readonly defaultModel: string;

  constructor(private readonly ctx: CliAdapterContext & { model?: string } = {}) {
    this.defaultModel =
      ctx.model ?? process.env.AUTOMAX_CLAUDE_CODE_MODEL ?? DEFAULT_MODELS['claude-code'];
  }

  /** Path to the binary, or a clear error. Also verifies the login unless AUTOMAX_SKIP_CLI_AUTH_CHECK=1. */
  bin(): string {
    const bin = requireCli(this.ctx.bin ?? 'claude', INSTALL_HINT);
    if (process.env.AUTOMAX_SKIP_CLI_AUTH_CHECK !== '1') {
      const r = runQuiet(bin, ['auth', 'status']);
      if (r.ok && /"loggedIn"\s*:\s*false/.test(r.stdout)) {
        throw new AgentsConfigError(
          'Claude Code is installed but not logged in.',
          'Run `claude login` (or `claude setup-token`).',
        );
      }
    }
    return bin;
  }

  static loginStatus(bin = 'claude'): {
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
    const s = runQuiet(found, ['auth', 'status']);
    const loggedIn = s.ok ? !/"loggedIn"\s*:\s*false/.test(s.stdout) : null;
    const method = /"authMethod"\s*:\s*"([^"]+)"/.exec(s.stdout)?.[1];
    return {
      installed: true,
      loggedIn,
      detail: `${v.stdout.trim().split('\n')[0] || 'installed'}${loggedIn ? ` · logged in${method ? ` (${method})` : ''}` : loggedIn === false ? ' · NOT logged in' : ''}`,
    };
  }

  private modelArgs(model?: string): string[] {
    const m = model ?? this.defaultModel;
    return m && m !== 'default' ? ['--model', m] : [];
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const bin = this.bin();
    let text = '';
    let finalText: string | undefined;
    let usage: CompleteResult['usage'];
    let costUsd: number | undefined;
    let model: string | undefined;
    const r = await runJsonl(
      bin,
      [
        '-p',
        req.prompt,
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        '1',
        '--tools',
        '',
        '--strict-mcp-config',
        ...this.modelArgs(req.model),
        ...(req.system ? ['--append-system-prompt', req.system] : []),
      ],
      {
        signal: req.signal,
        onLine: (line) => {
          if (typeof line !== 'object' || !line) return;
          const msg = line as Record<string, any>;
          if (msg.type === 'assistant') model = msg.message?.model ?? model;
          if (msg.type === 'result' && typeof msg.result === 'string') finalText = msg.result;
          for (const e of normalize(msg)) {
            // the result message repeats the final assistant text; keep one copy
            if (e.type === 'text' && msg.type !== 'result') text += e.text;
            if (e.type === 'result') {
              usage = e.usage;
              costUsd = e.costUsd;
            }
          }
        },
      },
    );
    if (r.exitCode !== 0 && !text && !finalText) throw cliFailure('claude', r.exitCode, r.stderr);
    return { text: (finalText ?? text).trim(), usage, costUsd, model };
  }

  async *stream(req: CompleteRequest): AsyncIterable<string> {
    const r = await this.complete(req);
    yield r.text;
  }

  async runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
    const bin = this.bin();
    const servers = mcpServerMap({ ...this.ctx, rootDir: this.ctx.rootDir ?? o.cwd }, o.mcpServers);
    const mcpFile = writeTempJson('automax-claude-code-', { mcpServers: servers });
    const allowed = ['Read', 'Glob', 'Grep', ...Object.keys(servers).map((n) => `mcp__${n}__*`)];
    const args = [
      '-p',
      o.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      mcpFile,
      '--strict-mcp-config',
      '--permission-mode',
      'default',
      '--allowedTools',
      ...allowed,
      '--disallowedTools',
      'Bash',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'WebFetch',
      'WebSearch',
      '--max-turns',
      String(o.maxTurns ?? 40),
      ...this.modelArgs(o.model),
      '--append-system-prompt',
      o.system,
    ];
    let text = '';
    let toolCalls = 0;
    let result: RunAgentResult | undefined;
    const r = await runJsonl(bin, args, {
      cwd: o.cwd,
      signal: o.signal,
      onLine: (line) => {
        if (typeof line !== 'object' || !line) return;
        const msg = line as Record<string, any>;
        for (const e of normalize(msg)) {
          // the result message repeats the final assistant text; do not emit it twice
          if (e.type === 'text' && msg.type === 'result') continue;
          o.onEvent?.(e);
          if (e.type === 'text') text += e.text;
          if (e.type === 'tool_call') toolCalls++;
          if (e.type === 'result') {
            // Running out of turns is a budget stop, not a failure: keep what was produced.
            const maxTurns = e.stopReason === 'error_max_turns';
            result = {
              text,
              costUsd: e.costUsd,
              usage: e.usage,
              turns: e.turns,
              stopReason: maxTurns ? 'max_turns' : e.stopReason,
              isError: maxTurns ? false : e.isError,
              toolCalls,
            };
            if (maxTurns)
              o.onEvent?.({ type: 'status', message: `max turns (${e.turns}) reached` });
          }
        }
      },
    });
    if (result) {
      if (o.maxBudgetUsd && result.costUsd && result.costUsd > o.maxBudgetUsd) {
        o.onEvent?.({
          type: 'status',
          message: `budget exceeded: $${result.costUsd.toFixed(3)} > $${o.maxBudgetUsd}`,
        });
      }
      return { ...result, text };
    }
    if (r.exitCode !== 0) throw cliFailure('claude', r.exitCode, r.stderr);
    return { text, turns: 0, stopReason: 'end', toolCalls };
  }
}

export function cliFailure(bin: string, exitCode: number, stderr: string): AgentsConfigError {
  const tail = stderr.trim().split('\n').slice(-5).join('\n');
  const notLoggedIn = /not logged in|login|authenticate|unauthorized/i.test(tail);
  return new AgentsConfigError(
    `${bin} exited with code ${exitCode}${tail ? `: ${tail}` : ''}`,
    notLoggedIn
      ? `Run \`${bin} login\`.`
      : `Run the command manually to inspect the error, or pick another adapter (--adapter fake for a dry run).`,
  );
}
