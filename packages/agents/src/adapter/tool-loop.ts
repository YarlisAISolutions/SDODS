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

export interface TurnOptions {
  /** 'required' makes a model act on the first turn instead of narrating what it would do. */
  toolChoice?: 'auto' | 'required';
}

export interface ToolLoopTransport<Message> {
  readonly model: string;
  /** The opening history: whatever this provider expects for a system + user turn. */
  start(system: string, prompt: string): Message[];
  send(
    history: Message[],
    tools: AgentSdkToolDef[],
    signal?: AbortSignal,
    turnOpts?: TurnOptions,
  ): Promise<NormalizedTurn>;
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
  /** Recovered calls are deduplicated: a model describing what it already did must not repeat it. */
  const executed = new Set<string>();
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
    const turn = await transport.send(history, o.tools, o.signal, {
      toolChoice: turns === 1 ? (o.firstTurnToolChoice ?? 'auto') : 'auto',
    });
    // One decision per turn: a small model given two calls at once usually gets the second wrong,
    // and the dropped call is cheaper to explain than to undo.
    if (o.maxToolCallsPerTurn && turn.calls.length > o.maxToolCallsPerTurn) {
      const dropped = turn.calls.slice(o.maxToolCallsPerTurn);
      turn.calls = turn.calls.slice(0, o.maxToolCallsPerTurn);
      o.onEvent?.({
        type: 'status',
        message: `dropped ${dropped.length} extra tool call(s) this turn: ${dropped.map((c) => c.name).join(', ')}`,
      });
    }
    usageTotal.inputTokens! += turn.usage?.inputTokens ?? 0;
    usageTotal.outputTokens! += turn.usage?.outputTokens ?? 0;
    cost += transport.cost(turn.usage) ?? 0;
    if (o.maxBudgetUsd && cost > o.maxBudgetUsd) return finish('error_max_budget_usd', true);
    if (turn.text) {
      text += turn.text;
      o.onEvent?.({ type: 'text', text: turn.text });
    }
    if (!turn.calls.length && o.recoverTextToolCalls && turn.text) {
      const recovered = recoverTextToolCall(turn.text, new Set(byName.keys()));
      const signature = recovered && `${recovered.name}:${JSON.stringify(recovered.args)}`;
      if (recovered && signature && !executed.has(signature)) {
        turn.calls = [{ id: `text_${turns}`, name: recovered.name, args: recovered.args }];
        o.onEvent?.({
          type: 'status',
          message: `recovered a ${recovered.name} call the model wrote as text`,
        });
      }
    }
    transport.pushAssistant(history, turn);
    if (!turn.calls.length) return finish(turn.finishReason, false);

    for (const call of turn.calls) {
      toolCalls++;
      executed.add(`${call.name}:${JSON.stringify(call.args)}`);
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
 * Recovers a tool call a model wrote out instead of making.
 *
 * Small models often produce exactly the right call in exactly the right shape — as prose:
 * `step_find({"project":"shop"})`, or a fenced JSON object with `name` and `arguments`. The
 * structured field stays empty and the job ends having done nothing. Since the arguments are
 * validated against the tool's schema either way, reading the call out of the text costs nothing
 * and turns a wasted run into a working one. It only ever runs when the turn made no real call.
 */
export function recoverTextToolCall(
  text: string,
  known: Set<string>,
): { name: string; args: Record<string, unknown> } | undefined {
  if (!text) return undefined;
  // `tool_name({ ... })`
  const callSyntax = /\b([a-z][a-z0-9_]{2,})\s*\(\s*(\{[\s\S]*?\})\s*\)/gi;
  for (const m of text.matchAll(callSyntax)) {
    const name = m[1]!;
    if (!known.has(name)) continue;
    const args = parseObject(m[2]!);
    if (args) return { name, args };
  }
  // `{"name": "tool_name", "arguments"|"parameters": { ... }}`, fenced or not. The object is
  // found by matching braces rather than by regex: the payload contains nested objects, and a
  // non-greedy pattern stops at the first inner brace.
  for (const candidate of balancedObjects(text)) {
    const obj = parseObject(candidate);
    if (!obj) continue;
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name || !known.has(name)) continue;
    const args = obj.arguments ?? obj.parameters ?? obj.input;
    if (args && typeof args === 'object') return { name, args: args as Record<string, unknown> };
  }
  return undefined;
}

/** Every balanced `{...}` substring, outermost first, so nested payloads survive. */
function balancedObjects(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') {
        depth--;
        if (depth === 0) {
          found.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return found;
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
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
