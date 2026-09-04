import { z } from 'zod';
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

export interface OpenAiCompatOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** USD per 1M tokens, for cost estimates */
  prices?: Record<string, { input: number; output: number }>;
}

/** Chat-completions tool loop for OpenAI-compatible endpoints (OpenAI, Azure, Ollama, vLLM …). */
export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly provider = 'openai-compatible' as const;
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAiCompatOptions = {}) {
    this.defaultModel =
      opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODELS['openai-compatible'];
    this.baseUrl = (
      opts.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
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

  private async chat(body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key()}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok)
      throw new Error(
        `${this.baseUrl}/chat/completions → ${res.status} ${await res.text().catch(() => '')}`,
      );
    return res.json();
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
    const tools = o.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: z.toJSONSchema(z.object(t.inputSchema)),
      },
    }));
    const byName = new Map(o.tools.map((t) => [t.name, t]));
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: o.system },
      { role: 'user', content: o.prompt },
    ];
    let turns = 0;
    let toolCalls = 0;
    let text = '';
    let cost = 0;
    const usageTotal: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const maxTurns = o.maxTurns ?? 30;
    while (turns < maxTurns) {
      if (o.signal?.aborted)
        return { text, turns, stopReason: 'aborted', toolCalls, costUsd: cost, usage: usageTotal };
      turns++;
      const json = await this.chat(
        {
          model,
          messages,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
        },
        o.signal,
      );
      const u = usageOf(json.usage);
      usageTotal.inputTokens! += u?.inputTokens ?? 0;
      usageTotal.outputTokens! += u?.outputTokens ?? 0;
      cost += this.cost(model, u) ?? 0;
      if (o.maxBudgetUsd && cost > o.maxBudgetUsd) return finish('error_max_budget_usd', true);
      const choice = json.choices?.[0];
      const msg = choice?.message ?? {};
      if (msg.content) {
        text += msg.content;
        o.onEvent?.({ type: 'text', text: msg.content });
      }
      const calls: Array<{ id: string; function: { name: string; arguments: string } }> =
        msg.tool_calls ?? [];
      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: calls.length ? calls : undefined,
      });
      if (!calls.length) return finish(choice?.finish_reason ?? 'stop', false);
      for (const call of calls) {
        toolCalls++;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* leave empty */
        }
        o.onEvent?.({ type: 'tool_call', id: call.id, name: call.function.name, input: args });
        const tool = byName.get(call.function.name);
        const result = tool
          ? await tool.handler(args)
          : {
              content: [{ type: 'text' as const, text: `Unknown tool ${call.function.name}` }],
              isError: true,
            };
        const output = result.content
          .map((c) => (c.type === 'text' ? c.text : `[image ${c.mimeType}]`))
          .join('\n');
        o.onEvent?.({ type: 'tool_result', id: call.id, output, isError: result.isError });
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }
    return finish('error_max_turns', true);

    function finish(stopReason: string, isError: boolean): RunAgentResult {
      o.onEvent?.({ type: 'result', costUsd: cost, usage: usageTotal, turns, stopReason, isError });
      return { text, costUsd: cost, usage: usageTotal, turns, stopReason, isError, toolCalls };
    }
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

function usageOf(u: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: Number(u.prompt_tokens ?? 0),
    outputTokens: Number(u.completion_tokens ?? 0),
  };
}
