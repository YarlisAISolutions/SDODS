import {
  DEFAULT_MODELS,
  type CompleteRequest,
  type CompleteResult,
  type LlmAdapter,
  type RunAgentOptions,
  type RunAgentResult,
} from './types.js';

export type FakeStep =
  | { text: string }
  | { toolCall: { name: string; input: Record<string, unknown> } }
  | {
      fn: (ctx: {
        prompt: string;
        system: string;
        lastToolOutput?: unknown;
      }) => FakeStep | FakeStep[] | undefined;
    };

export interface FakeAdapterOptions {
  /** scripted sequence; tool calls execute the REAL registry handlers */
  script?: FakeStep[];
  completion?: string | ((req: CompleteRequest) => string);
  costPerTurnUsd?: number;
}

/** Deterministic adapter for tests and `--dry-run`: no network, real tool handlers. */
export class FakeAdapter implements LlmAdapter {
  readonly provider = 'fake' as const;
  readonly defaultModel = DEFAULT_MODELS.fake;
  readonly calls: Array<{ name: string; input: unknown; output: unknown }> = [];

  constructor(private readonly opts: FakeAdapterOptions = {}) {}

  async complete(req: CompreteOrCompleteRequest): Promise<CompleteResult> {
    const c = this.opts.completion;
    const text =
      typeof c === 'function' ? c(req) : (c ?? `[fake completion for: ${req.prompt.slice(0, 80)}]`);
    return {
      text,
      usage: { inputTokens: req.prompt.length, outputTokens: text.length },
      costUsd: 0,
      model: this.defaultModel,
    };
  }

  async *stream(req: CompleteRequest): AsyncIterable<string> {
    yield (await this.complete(req)).text;
  }

  async runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
    const byName = new Map(o.tools.map((t) => [t.name, t]));
    const queue: FakeStep[] = [
      ...(this.opts.script ?? [
        { text: `[fake agent] tools available: ${o.tools.map((t) => t.name).join(', ')}` },
      ]),
    ];
    let text = '';
    let turns = 0;
    let toolCalls = 0;
    let lastToolOutput: unknown;
    const cost = () => turns * (this.opts.costPerTurnUsd ?? 0);
    while (queue.length) {
      if (o.maxTurns && turns >= o.maxTurns) return finish('error_max_turns', true);
      if (o.maxBudgetUsd !== undefined && cost() > o.maxBudgetUsd)
        return finish('error_max_budget_usd', true);
      const step = queue.shift()!;
      turns++;
      if ('fn' in step) {
        const next = step.fn({ prompt: o.prompt, system: o.system, lastToolOutput });
        if (next) queue.unshift(...(Array.isArray(next) ? next : [next]));
        continue;
      }
      if ('text' in step) {
        text += step.text;
        o.onEvent?.({ type: 'text', text: step.text });
        continue;
      }
      const id = `call_${toolCalls + 1}`;
      toolCalls++;
      o.onEvent?.({ type: 'tool_call', id, name: step.toolCall.name, input: step.toolCall.input });
      const tool = byName.get(step.toolCall.name);
      const result = tool
        ? await tool.handler(step.toolCall.input)
        : {
            content: [{ type: 'text' as const, text: `Unknown tool ${step.toolCall.name}` }],
            isError: true,
          };
      lastToolOutput = result;
      this.calls.push({ name: step.toolCall.name, input: step.toolCall.input, output: result });
      o.onEvent?.({ type: 'tool_result', id, output: result.content, isError: result.isError });
    }
    return finish('end_turn', false);

    function finish(stopReason: string, isError: boolean): RunAgentResult {
      const r: RunAgentResult = {
        text,
        costUsd: cost(),
        usage: { inputTokens: 0, outputTokens: text.length },
        turns,
        stopReason,
        isError,
        toolCalls,
      };
      o.onEvent?.({
        type: 'result',
        costUsd: r.costUsd,
        usage: r.usage,
        turns,
        stopReason,
        isError,
      });
      return r;
    }
  }
}

type CompreteOrCompleteRequest = CompleteRequest;
