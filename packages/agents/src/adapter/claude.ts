import {
  DEFAULT_MODELS,
  AgentsConfigError,
  type AgentEvent,
  type CompleteRequest,
  type CompleteResult,
  type LlmAdapter,
  type RunAgentOptions,
  type RunAgentResult,
  type TokenUsage,
} from './types.js';

/**
 * Claude adapter: `runAgent` uses the Claude Agent SDK (query + in-process MCP tools + the
 * bundled Playwright MCP); `complete`/`stream` use the Anthropic Messages API.
 * The SDK modules are imported lazily so the package loads without them (FakeAdapter, tests).
 */
export interface ClaudeAdapterOptions {
  apiKey?: string;
  model?: string;
  /** injected for tests */
  sdk?: {
    query: (params: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => AsyncIterable<Record<string, any>>;
    tool: (...a: any[]) => any;
    createSdkMcpServer: (o: any) => any;
  };
  anthropic?: {
    messages: { create: (p: any) => Promise<any>; stream?: (p: any) => AsyncIterable<any> };
  };
  withPlaywrightMcp?: boolean;
}

export class ClaudeAdapter implements LlmAdapter {
  readonly provider = 'claude' as const;
  readonly defaultModel: string;

  constructor(private readonly opts: ClaudeAdapterOptions = {}) {
    this.defaultModel = opts.model ?? process.env.SDODS_CLAUDE_MODEL ?? DEFAULT_MODELS.claude;
  }

  private ensureKey(): string {
    const key = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new AgentsConfigError(
        'ANTHROPIC_API_KEY is not set.',
        'Export ANTHROPIC_API_KEY (your own key, billed by Anthropic) or use --adapter fake / --dry-run.',
      );
    }
    return key;
  }

  private async sdk() {
    if (this.opts.sdk) return this.opts.sdk;
    const mod =
      (await import('@anthropic-ai/claude-agent-sdk')) as unknown as ClaudeAdapterOptions['sdk'];
    return mod!;
  }

  private async anthropic() {
    if (this.opts.anthropic) return this.opts.anthropic;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey: this.ensureKey() }) as unknown as NonNullable<
      ClaudeAdapterOptions['anthropic']
    >;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    this.ensureKey();
    const client = await this.anthropic();
    const res = await client.messages.create({
      model: req.model ?? this.defaultModel,
      max_tokens: req.maxTokens ?? 16_000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      thinking: { type: 'adaptive' },
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    });
    const text = (res.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    return { text, usage: usageOf(res.usage), model: res.model };
  }

  async *stream(req: CompleteRequest): AsyncIterable<string> {
    this.ensureKey();
    const client = await this.anthropic();
    if (!client.messages.stream) {
      const r = await this.complete(req);
      yield r.text;
      return;
    }
    const s = client.messages.stream({
      model: req.model ?? this.defaultModel,
      max_tokens: req.maxTokens ?? 64_000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    });
    for await (const ev of s) {
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta')
        yield ev.delta.text as string;
    }
  }

  async runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
    this.ensureKey();
    const sdk = await this.sdk();
    const tools = o.tools.map((t) =>
      sdk.tool(
        t.name,
        t.description,
        t.inputSchema,
        async (args: Record<string, unknown>) => t.handler(args),
        { annotations: t.annotations },
      ),
    );
    const mcpServers: Record<string, unknown> = {
      sdods: sdk.createSdkMcpServer({ name: 'sdods', version: '0.1.0', tools }),
    };
    if (this.opts.withPlaywrightMcp !== false)
      mcpServers.playwright = {
        type: 'stdio',
        command: 'npx',
        args: ['playwright', 'mcp', '--headless'],
      };
    for (const [name, cfg] of Object.entries(o.mcpServers ?? {})) {
      if (cfg.transport === 'http' && cfg.url)
        mcpServers[name] = { type: 'http', url: cfg.url, headers: cfg.headers };
      else if (cfg.command)
        mcpServers[name] = {
          type: 'stdio',
          command: cfg.command,
          args: cfg.args ?? [],
          env: cfg.env,
        };
    }
    const abort = new AbortController();
    o.signal?.addEventListener('abort', () => abort.abort(), { once: true });
    const q = sdk.query({
      prompt: o.prompt,
      options: {
        systemPrompt: o.system,
        model: o.model ?? this.defaultModel,
        maxTurns: o.maxTurns ?? 40,
        maxBudgetUsd: o.maxBudgetUsd,
        cwd: o.cwd,
        abortController: abort,
        permissionMode: 'default',
        allowedTools: [
          'Read',
          'Glob',
          'Grep',
          'mcp__sdods__*',
          'mcp__playwright__*',
          ...Object.keys(o.mcpServers ?? {}).map((n) => `mcp__${n}__*`),
        ],
        disallowedTools: [
          'Bash',
          'Write',
          'Edit',
          'MultiEdit',
          'NotebookEdit',
          'WebFetch',
          'WebSearch',
        ],
        mcpServers,
        canUseTool: async () => ({
          behavior: 'deny',
          message: 'SDODS agents may only use MCP tools and read-only file tools.',
        }),
      },
    });
    let text = '';
    let turns = 0;
    let toolCalls = 0;
    let result: RunAgentResult | undefined;
    for await (const msg of q) {
      const ev = normalize(msg);
      for (const e of ev) {
        o.onEvent?.(e);
        if (e.type === 'text') text += e.text;
        if (e.type === 'tool_call') toolCalls++;
        if (e.type === 'result') {
          turns = e.turns;
          result = {
            text,
            costUsd: e.costUsd,
            usage: e.usage,
            turns,
            stopReason: e.stopReason,
            isError: e.isError,
            toolCalls,
          };
        }
      }
    }
    return result ?? { text, turns, stopReason: 'end', toolCalls };
  }
}

/** Convert Claude Agent SDK messages into SDODS agent events. */
export function normalize(msg: Record<string, any>): AgentEvent[] {
  const out: AgentEvent[] = [];
  switch (msg?.type) {
    case 'assistant': {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text) out.push({ type: 'text', text: block.text });
        if (block.type === 'tool_use')
          out.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input });
      }
      break;
    }
    case 'user': {
      for (const block of msg.message?.content ?? []) {
        if (block?.type === 'tool_result')
          out.push({
            type: 'tool_result',
            id: block.tool_use_id,
            output: block.content,
            isError: block.is_error,
          });
      }
      break;
    }
    case 'result': {
      const usage = msg.usage ? usageOf(msg.usage) : undefined;
      out.push({
        type: 'result',
        costUsd: msg.total_cost_usd,
        usage,
        turns: msg.num_turns ?? 0,
        stopReason: msg.subtype ?? msg.stop_reason ?? 'end',
        isError: Boolean(msg.is_error),
      });
      if (typeof msg.result === 'string' && msg.result)
        out.push({ type: 'text', text: msg.result });
      break;
    }
    case 'system':
    case 'status':
      if (msg.subtype || msg.message)
        out.push({ type: 'status', message: String(msg.subtype ?? msg.message) });
      break;
    default:
      break;
  }
  return out;
}

export function usageOf(u: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
  };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
