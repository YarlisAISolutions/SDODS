import type { AgentSdkToolDef } from '@sdods/mcp';
import type { RunAgentOptions, RunAgentResult, TokenUsage } from './types.js';

/**
 * The agent turn loop, shared by every adapter that drives a chat endpoint itself.
 *
 * Claude and the CLI adapters bring their own loop (the SDK or the CLI owns it). The
 * chat-completions adapters do not, and they used to each own a copy — which is how the two
 * drifted on argument validation and budget accounting. The loop lives here now; a transport
 * supplies only the three things that genuinely differ between providers: how a request is sent,
 * and how an assistant turn and a tool result are written back into the history.
 */

/** One tool call, after the provider's own encoding has been normalised away. */
export interface NormalizedCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Set when the model's arguments could not be read; the call must not be executed. */
  error?: string;
}

export interface NormalizedTurn {
  text: string;
  calls: NormalizedCall[];
  usage?: TokenUsage;
  finishReason: string;
}

export interface ToolLoopTransport<Message> {
  readonly model: string;
  /** The opening history: whatever this provider expects for a system + user turn. */
  start(system: string, prompt: string): Message[];
  send(history: Message[], tools: AgentSdkToolDef[], signal?: AbortSignal): Promise<NormalizedTurn>;
  pushAssistant(history: Message[], turn: NormalizedTurn): void;
  pushToolResult(history: Message[], call: NormalizedCall, output: string, isError: boolean): void;
  /** USD for one turn, or undefined when the provider does not price (local models: 0). */
  cost(usage: TokenUsage | undefined): number | undefined;
}

/**
 * How many malformed tool calls to answer with a correction before giving up. One repair turn is
 * enough for a model that can recover; a model that cannot will not on the tenth either.
 */
const MAX_BAD_TOOL_CALLS = 2;

export async function runToolLoop<Message>(
  transport: ToolLoopTransport<Message>,
  o: RunAgentOptions,
): Promise<RunAgentResult> {
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const history = transport.start(o.system, o.prompt);
  const usageTotal: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const maxTurns = o.maxTurns ?? 30;
  let turns = 0;
  let toolCalls = 0;
  let badToolCalls = 0;
  let text = '';
  let cost = 0;

  const finish = (stopReason: string, isError: boolean): RunAgentResult => {
    o.onEvent?.({ type: 'result', costUsd: cost, usage: usageTotal, turns, stopReason, isError });
    return { text, costUsd: cost, usage: usageTotal, turns, stopReason, isError, toolCalls };
  };

  while (turns < maxTurns) {
    if (o.signal?.aborted)
      return { text, turns, stopReason: 'aborted', toolCalls, costUsd: cost, usage: usageTotal };
    turns++;
    const turn = await transport.send(history, o.tools, o.signal);
    usageTotal.inputTokens! += turn.usage?.inputTokens ?? 0;
    usageTotal.outputTokens! += turn.usage?.outputTokens ?? 0;
    cost += transport.cost(turn.usage) ?? 0;
    if (o.maxBudgetUsd && cost > o.maxBudgetUsd) return finish('error_max_budget_usd', true);
    if (turn.text) {
      text += turn.text;
      o.onEvent?.({ type: 'text', text: turn.text });
    }
    transport.pushAssistant(history, turn);
    if (!turn.calls.length) return finish(turn.finishReason, false);

    for (const call of turn.calls) {
      toolCalls++;
      o.onEvent?.({ type: 'tool_call', id: call.id, name: call.name, input: call.args });
      const tool = byName.get(call.name);
      const result = call.error
        ? {
            content: [
              {
                type: 'text' as const,
                text: `${call.error}. Call ${call.name} again with a single JSON object matching its parameters.`,
              },
            ],
            isError: true,
          }
        : tool
          ? await tool.handler(call.args)
          : {
              content: [
                {
                  type: 'text' as const,
                  text: `Unknown tool ${call.name}. Available: ${[...byName.keys()].join(', ')}`,
                },
              ],
              isError: true,
            };
      const output = result.content
        .map((c) => (c.type === 'text' ? c.text : `[image ${c.mimeType}]`))
        .join('\n');
      o.onEvent?.({ type: 'tool_result', id: call.id, output, isError: result.isError });
      transport.pushToolResult(history, call, output, Boolean(result.isError));
      if (call.error) {
        badToolCalls++;
        if (badToolCalls > MAX_BAD_TOOL_CALLS) return finish('error_tool_arguments', true);
      }
    }
  }
  return finish('error_max_turns', true);
}

/**
 * Reads the `arguments` a model sent for a tool call. OpenAI encodes them as a JSON string; some
 * local servers send an object. Anything else is reported rather than silently turned into `{}` —
 * calling a write tool with no arguments is how an empty feature file gets written and nobody
 * finds out why.
 */
export function readToolArgs(raw: unknown): { args: Record<string, unknown>; error?: string } {
  if (raw && typeof raw === 'object') return { args: raw as Record<string, unknown> };
  if (typeof raw !== 'string' || !raw.trim()) return { args: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return { args: parsed as Record<string, unknown> };
    return { args: {}, error: `arguments must be a JSON object, got ${typeof parsed}` };
  } catch (err) {
    return { args: {}, error: `arguments were not valid JSON (${(err as Error).message})` };
  }
}
