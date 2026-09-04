import {
  AgentsConfigError,
  DEFAULT_MODELS,
  type CompleteRequest,
  type CompleteResult,
  type LlmAdapter,
  type RunAgentOptions,
  type RunAgentResult,
  type TokenUsage,
} from './types.js';
import {
  readToolArgs,
  runToolLoop,
  type NormalizedCall,
  type ToolLoopTransport,
} from './tool-loop.js';
import type { AgentSdkToolDef } from '@sdods/mcp';
import { toolParameters } from './json-schema.js';

/**
 * Models running on this machine, through Ollama's native API.
 *
 * Ollama also speaks the OpenAI protocol, and `openai-compatible` will talk to it — but that path
 * cannot set `num_ctx`. Ollama loads a model at 4096 tokens by default even when the weights
 * advertise 128k, and it truncates a longer prompt **silently**: the model answers confidently
 * from half a question and nothing anywhere reports a problem. An agent prompt carrying tool
 * schemas passes 4096 on the first turn, so the native endpoint is the only honest transport.
 *
 * The same endpoint buys two more things worth having: `format` accepts a JSON schema, which is
 * what makes a 7B model reliable at structured output, and `/api/tags`, `/api/show` and `/api/ps`
 * report what is installed, what it can do, and how much context it was actually loaded with.
 */

const DEFAULT_HOST = 'http://127.0.0.1:11434';
/** Local generation is minutes, not seconds: a first load pulls weights into memory. */
const DEFAULT_TIMEOUT_MS = 300_000;
/** Rough characters-per-token for the budget guard; deliberately pessimistic. */
const CHARS_PER_TOKEN = 3.5;

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  /** Sets `options.num_ctx`, and the ceiling the prompt is measured against. */
  contextTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** How long the server keeps the model in memory between turns. */
  keepAlive?: string;
  fetchImpl?: typeof fetch;
}

export interface OllamaModel {
  name: string;
  sizeBytes: number;
  parameterSize?: string;
  family?: string;
  capabilities?: string[];
  contextLength?: number;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

export class OllamaAdapter implements LlmAdapter {
  readonly provider = 'ollama' as const;
  readonly defaultModel: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly temperature: number;
  private readonly contextTokens?: number;
  private readonly keepAlive: string;

  constructor(private readonly opts: OllamaOptions = {}) {
    this.defaultModel = opts.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODELS.ollama;
    this.baseUrl = normalizeHost(opts.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_HOST);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.temperature = opts.temperature ?? 0;
    this.contextTokens = opts.contextTokens;
    this.keepAlive = opts.keepAlive ?? '10m';
  }

  /* ── discovery ──────────────────────────────────────────────────────────── */

  /** Installed models. Throws a readable error when nothing is listening. */
  async models(): Promise<OllamaModel[]> {
    const json = (await this.get('/api/tags')) as {
      models?: Array<{
        name: string;
        size: number;
        details?: { family?: string; parameter_size?: string };
      }>;
    };
    return (json.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
    }));
  }

  /** What a model can do, and the context its weights allow. */
  async show(model: string): Promise<{ capabilities: string[]; contextLength?: number }> {
    const json = (await this.post('/api/show', { model })) as {
      capabilities?: string[];
      model_info?: Record<string, unknown>;
    };
    const ctxKey = Object.keys(json.model_info ?? {}).find((k) => k.endsWith('.context_length'));
    return {
      capabilities: json.capabilities ?? [],
      contextLength: ctxKey ? Number(json.model_info![ctxKey]) : undefined,
    };
  }

  /** The context a loaded model is actually running with — usually far below its maximum. */
  async loadedContext(model: string): Promise<number | undefined> {
    const json = (await this.get('/api/ps')) as {
      models?: Array<{ name: string; model?: string; context_length?: number }>;
    };
    const hit = (json.models ?? []).find((m) => m.name === model || m.model === model);
    return hit?.context_length;
  }

  async version(): Promise<string> {
    const json = (await this.get('/api/version')) as { version?: string };
    return json.version ?? 'unknown';
  }

  /** True when a server answers at all — used by detection and `doctor`, so it is quick. */
  static async reachable(baseUrl?: string, timeoutMs = 400): Promise<boolean> {
    const url = `${normalizeHost(baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_HOST)}/api/tags`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ── generation ─────────────────────────────────────────────────────────── */

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const model = req.model ?? this.defaultModel;
    const json = (await this.chat(
      {
        model,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: req.prompt },
        ],
        ...(req.responseSchema ? { format: req.responseSchema } : {}),
        options: this.options(req.maxTokens),
      },
      req.signal,
    )) as OllamaChatResponse;
    return {
      text: json.message?.content ?? '',
      usage: usageOf(json),
      costUsd: 0,
      model,
    };
  }

  async *stream(req: CompleteRequest): AsyncIterable<string> {
    yield (await this.complete(req)).text;
  }

  async runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
    const model = o.model ?? this.defaultModel;
    if (o.mcpServers && Object.keys(o.mcpServers).length)
      o.onEvent?.({
        type: 'status',
        message:
          'The ollama adapter does not start external MCP servers; only SDODS tools are available.',
      });
    await this.assertFits(model, o, o.onEvent);
    return runToolLoop(this.transport(model, o), o);
  }

  /** Native shapes: tool calls carry no id and arguments arrive already parsed. */
  private transport(model: string, o: RunAgentOptions): ToolLoopTransport<OllamaMessage> {
    return {
      model,
      start: (system, prompt) => [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      send: async (history, tools, signal) => {
        const json = (await this.chat(
          {
            model,
            messages: history,
            tools: tools.length ? nativeTools(tools) : undefined,
            options: this.options(o.maxTokens),
          },
          signal,
        )) as OllamaChatResponse;
        const calls: NormalizedCall[] = (json.message?.tool_calls ?? []).map((call, i) => {
          const { args, error } = readToolArgs(call.function?.arguments);
          return { id: `call_${i}`, name: call.function?.name ?? '', args, error };
        });
        return {
          text: json.message?.content ?? '',
          calls,
          usage: usageOf(json),
          finishReason: json.done_reason ?? 'stop',
        };
      },
      pushAssistant: (history, turn) => {
        history.push({
          role: 'assistant',
          content: turn.text,
          tool_calls: turn.calls.length
            ? turn.calls.map((c) => ({ function: { name: c.name, arguments: c.args } }))
            : undefined,
        });
      },
      pushToolResult: (history, call, output) => {
        history.push({ role: 'tool', tool_name: call.name, content: output });
      },
      // Electricity is not billed per token: local runs are free, and budget gates never fire.
      cost: () => 0,
    };
  }

  /**
   * Refuses to start a job whose prompt cannot fit, instead of letting Ollama truncate it.
   *
   * This is the failure nobody reports, because the answer still looks plausible — so it is a
   * hard error with the two commands that fix it, not a warning.
   */
  private async assertFits(
    model: string,
    o: RunAgentOptions,
    onEvent?: RunAgentOptions['onEvent'],
  ): Promise<void> {
    const chars =
      o.system.length + o.prompt.length + JSON.stringify(nativeTools(o.tools) ?? []).length;
    const estimate = Math.ceil(chars / CHARS_PER_TOKEN);
    const want = this.contextTokens;
    if (want && estimate < want * 0.9) return;
    const loaded = await this.loadedContext(model).catch(() => undefined);
    const ceiling = want ?? loaded;
    if (!ceiling) return;
    if (estimate < ceiling * 0.9) return;
    const max = (await this.show(model).catch(() => undefined))?.contextLength;
    const target = Math.min(max ?? 32_768, Math.max(8192, 2 ** Math.ceil(Math.log2(estimate * 2))));
    throw new AgentsConfigError(
      `The prompt for this job is about ${estimate.toLocaleString()} tokens, but ${model} is running with a ${ceiling.toLocaleString()}-token context. Ollama would truncate it without saying so.`,
      `Set agents.contextTokens: ${target} in the project yaml, or start the server with OLLAMA_CONTEXT_LENGTH=${target}${max ? ` (this model supports up to ${max.toLocaleString()})` : ''}. A smaller tool set (agents.profile: small) also shortens the prompt.`,
    );
    onEvent?.({ type: 'status', message: 'context checked' });
  }

  private options(maxTokens?: number): Record<string, unknown> {
    return {
      temperature: this.temperature,
      // Changing num_ctx reloads the model, so it is fixed once per adapter, from configuration.
      ...(this.contextTokens ? { num_ctx: this.contextTokens } : {}),
      ...(maxTokens ? { num_predict: maxTokens } : {}),
    };
  }

  /* ── transport ──────────────────────────────────────────────────────────── */

  private async chat(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    // stream defaults to true, which would return NDJSON; keep_alive stops the model being
    // unloaded and reloaded between turns; think spends the output budget on reasoning tokens
    // that this loop has no use for.
    return this.post(
      '/api/chat',
      { stream: false, keep_alive: this.keepAlive, think: false, ...body },
      signal,
    );
  }

  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(path, undefined, signal);
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.request(path, body, signal);
  }

  private async request(
    path: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const composed = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: composed,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (deadline.aborted)
        throw new AgentsConfigError(
          `${url} did not answer within ${Math.round(this.timeoutMs / 1000)}s.`,
          'Raise agents.requestTimeoutMs, or check that the model is not still loading (`ollama ps`).',
        );
      throw new AgentsConfigError(
        `Cannot reach Ollama at ${this.baseUrl} (${(err as Error).message}).`,
        'Start it with `ollama serve`, or point agents.baseUrl / OLLAMA_HOST at the machine running it.',
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 404 && /not found/i.test(text)) {
        const model = String(body?.model ?? this.defaultModel);
        throw new AgentsConfigError(
          `Ollama has no model named "${model}".`,
          `Pull it with \`ollama pull ${model}\`, or pick one of the installed models with --model.`,
        );
      }
      throw new Error(`${url} → ${res.status} ${text}`);
    }
    return res.json();
  }
}

interface OllamaChatResponse {
  message?: {
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function usageOf(json: OllamaChatResponse): TokenUsage {
  return { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 };
}

function nativeTools(tools: AgentSdkToolDef[]) {
  if (!tools.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: toolParameters(t.inputSchema),
    },
  }));
}

/** Accepts `host:port`, a full URL, or one with the OpenAI `/v1` suffix already attached. */
function normalizeHost(raw: string): string {
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '').replace(/\/v1$/, '');
}
