import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAiCompatibleAdapter } from '../src/adapter/openai-compat.js';
import type { AgentSdkToolDef } from '@sdods/mcp';

const echoTool: AgentSdkToolDef = {
  name: 'echo_test',
  description: 'echo',
  inputSchema: { text: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: async (args) => ({ content: [{ type: 'text', text: `echo:${String(args.text)}` }] }),
};

/** The loop behaviours the small profile turns on. */
describe('small-profile turn handling', () => {
  it('makes the first turn act, and only the first', async () => {
    const bodies: Array<Record<string, any>> = [];
    const responses = [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', function: { name: 'echo_test', arguments: '{"text":"a"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] },
    ];
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responses.shift()));
    });
    const adapter = new OpenAiCompatibleAdapter({ apiKey: 'k', fetchImpl: fetchImpl as never });
    await adapter.runAgent({
      system: 's',
      prompt: 'p',
      tools: [echoTool],
      firstTurnToolChoice: 'required',
      maxToolCallsPerTurn: 1,
    });
    expect(bodies[0]!.tool_choice).toBe('required');
    expect(bodies[0]!.parallel_tool_calls).toBe(false);
    expect(bodies[1]!.tool_choice).toBe('auto');
  });

  it('runs one call per turn and says what it dropped', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const responses = [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', function: { name: 'echo_test', arguments: '{"text":"a"}' } },
                { id: 'c2', function: { name: 'echo_test', arguments: '{"text":"b"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(responses.shift())));
    const adapter = new OpenAiCompatibleAdapter({ apiKey: 'k', fetchImpl: fetchImpl as never });
    const messages: string[] = [];
    const r = await adapter.runAgent({
      system: 's',
      prompt: 'p',
      tools: [{ ...echoTool, handler }],
      maxToolCallsPerTurn: 1,
      onEvent: (e) => e.type === 'status' && messages.push(e.message),
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r.toolCalls).toBe(1);
    expect(messages.join(' ')).toMatch(/dropped 1 extra tool call/);
  });

  it('executes a call the model wrote as text, once', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const responses = [
      { choices: [{ message: { content: 'echo_test({"text":"a"})' } }] },
      // The model describes the same call again; it must not run twice.
      { choices: [{ message: { content: 'I called echo_test({"text":"a"})' } }] },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(responses.shift())));
    const adapter = new OpenAiCompatibleAdapter({ apiKey: 'k', fetchImpl: fetchImpl as never });
    const r = await adapter.runAgent({
      system: 's',
      prompt: 'p',
      tools: [{ ...echoTool, handler }],
      recoverTextToolCalls: true,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r.toolCalls).toBe(1);
  });

  it('leaves prose alone when recovery is off', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'echo_test({"text":"a"})' }, finish_reason: 'stop' }],
          }),
        ),
    );
    const adapter = new OpenAiCompatibleAdapter({ apiKey: 'k', fetchImpl: fetchImpl as never });
    const r = await adapter.runAgent({
      system: 's',
      prompt: 'p',
      tools: [{ ...echoTool, handler }],
    });
    expect(handler).not.toHaveBeenCalled();
    expect(r.toolCalls).toBe(0);
  });
});
