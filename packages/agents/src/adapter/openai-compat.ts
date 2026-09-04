import type { AgentSdkToolDef } from '@sdods/mcp';
import {
  DEFAULT_MODELS,
  AgentsConfigError,
  type CompleteRequest,
  type CompleteResult,
  type LlmAdapter,
  type RunAgentOptions,
  type RunAgentResult,
  type TokenUsage,
} from './types.js';
import { toolParameters } from './json-schema.js';
import {
  readToolArgs,
  runToolLoop,
  type NormalizedCall,
  type ToolLoopTransport,
} from './tool-loop.js';

/** One entry of a chat-completions conversation, in the provider's own shape. */
type ChatMessage = Record<string, unknown>;

export interface OpenAiCompatOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** USD per 1M tokens, for cost estimates */
  prices?: Record<string, { input: number; output: number }>;
  /** Per-request ceiling. Local models are minutes, not seconds, so this is generous. */
  timeoutMs?: number;
  /** 0 by default: test generation should be reproducible, not creative. */
  temperature?: number;
}

/** A hosted endpoint answers in seconds; a local one can take minutes on a first load. */
const DEFAULT_TIMEOUT_MS = 300_000;

/** Chat-completions tool loop for OpenAI-compatible endpoints (OpenAI, Azure, Ollama, vLLM …). */
export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly provider = 'openai-compatible' as const;
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly temperature: number;

  constructor(private readonly opts: OpenAiCompatOptions = {}) {
    this.defaultModel =
      opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODELS['openai-compatible'];
    this.baseUrl = (
      opts.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.temperature = opts.temperature ?? 0;
  }

  private key(): string {
    const k = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!k && !/localhost|127\.0\.0\.1/.test(this.baseUrl))
      throw new AgentsConfigError(
        'OPENAI_API_KEY is not set.',
        'Export OPENAI_API_KEY (and OPENAI_BASE_URL for compatible servers) or use --adapter fake.',
      );
    return k ?? 'local';
  }

  /**
   * One chat-completions call, with a deadline and a single retry.
   *
   * The deadline matters most for local servers, which can sit silent for minutes while a model
   * loads; without it a hung server hangs the job forever. The retry covers the transient half of
   * the failures (connection reset, 429, 5xx) and nothing else — a 400 or a missing model is the
   * caller's problem and is reported as such.
   */
  private async chat(body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const url = `${this.baseUrl}/chat/completions`;
    const send = async () => {
      const deadline = AbortSignal.timeout(this.timeoutMs);
      const composed = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key()}` },
          body: JSON.stringify({ temperature: this.temperature, ...body }),
          signal: composed,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (deadline.aborted)
          throw new Error(
            `${url} did not answer within ${Math.round(this.timeoutMs / 1000)}s. Raise agents.requestTimeoutMs, or check that the server is running and the model is loaded.`,
          );
        throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const error = new Error(`${url} → ${res.status} ${text}`) as Error & {
          status: number;
          retryable: boolean;
        };
        error.status = res.status;
        error.retryable = res.status === 429 || res.status >= 500;
        throw error;
      }
      return res.json();
    };
    try {
      return await send();
    } catch (err) {
      const retryable =
        (err as { retryable?: boolean }).retryable ??
        /ECONNRESET|ECONNREFUSED|EPIPE|fetch failed/i.test(String(err));
      if (!retryable || signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, 1000));
      return send();
    }
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const model = req.model ?? this.defaultModel;
    const json = await this.chat(
      {
        model,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: req.prompt },
        ],
        max_tokens: req.maxTokens,
      },
      req.signal,
    );
    const usage = usageOf(json.usage);
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      usage,
      costUsd: this.cost(model, usage),
      model,
    };
  }

  async *stream(req: CompleteRequest): AsyncIterable<string> {
    const r = await this.complete(req);
    yield r.text;
  }

  async runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
    if (o.mcpServers && Object.keys(o.mcpServers).length) {
      o.onEvent?.({
        type: 'status',
        message:
          'OpenAI-compatible adapter ignores external MCP servers (v1); only SDODS tools are available.',
      });
    }
    const model = o.model ?? this.defaultModel;
    return runToolLoop(this.transport(model, o), o);
  }

  /** Chat-completions shapes: tool calls carry an id, results are `{role:'tool', tool_call_id}`. */
  private transport(model: string, o: RunAgentOptions): ToolLoopTransport<ChatMessage> {
    return {
      model,
      start: (system, prompt) => [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      send: async (history, tools, signal) => {
        const json = await this.chat(
          {
            model,
            messages: history,
            tools: tools.length ? toolFunctions(tools) : undefined,
            tool_choice: tools.length ? 'auto' : undefined,
            max_tokens: o.maxTokens,
          },
          signal,
        );
        const choice = json.choices?.[0];
        const msg = choice?.message ?? {};
        const calls: NormalizedCall[] = (msg.tool_calls ?? []).map(
          (call: { id?: string; function: { name: string; arguments: unknown } }, i: number) => {
            const { args, error } = readToolArgs(call.function?.arguments);
            return { id: call.id ?? `call_${i}`, name: call.function?.name ?? '', args, error };
          },
        );
        return {
          text: msg.content ?? '',
          calls,
          usage: usageOf(json.usage),
          finishReason: choice?.finish_reason ?? 'stop',
        };
      },
      pushAssistant: (history, turn) => {
        history.push({
          role: 'assistant',
          content: turn.text || null,
          tool_calls: turn.calls.length
            ? turn.calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              }))
            : undefined,
        });
      },
      pushToolResult: (history, call, output) => {
        history.push({ role: 'tool', tool_call_id: call.id, content: output });
      },
      cost: (usage) => this.cost(model, usage),
    };
  }

  private cost(model: string, usage?: TokenUsage): number | undefined {
    const price = this.opts.prices?.[model];
    if (!price || !usage) return undefined;
    return (
      ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output) /
      1_000_000
    );
  }
}

/** Function definitions for the `tools` field of a chat-completions request. */
function toolFunctions(tools: AgentSdkToolDef[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: toolParameters(t.inputSchema),
    },
  }));
}

function usageOf(u: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: Number(u.prompt_tokens ?? 0),
    outputTokens: Number(u.completion_tokens ?? 0),
  };
}
