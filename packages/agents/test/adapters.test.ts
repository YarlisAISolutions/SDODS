import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentSdkToolDef } from '@sdods/mcp';
import { ClaudeAdapter, normalize } from '../src/adapter/claude.js';
import { FakeAdapter } from '../src/adapter/fake.js';
import { OpenAiCompatibleAdapter } from '../src/adapter/openai-compat.js';
import { createAdapter, resolveProvider } from '../src/adapter/factory.js';
import type { AgentEvent } from '../src/adapter/types.js';

const echoTool: AgentSdkToolDef = {
  name: 'echo_test',
  description: 'echo',
  inputSchema: { text: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: async (args) => ({ content: [{ type: 'text', text: `echo:${String(args.text)}` }] }),
};

describe('ClaudeAdapter', () => {
  it('requires ANTHROPIC_API_KEY', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const a = new ClaudeAdapter();
    await expect(a.complete({ prompt: 'x' })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });

  it('wires the Agent SDK with in-process tools, budget and denies non-MCP tools', async () => {
    const seen: Record<string, unknown> = {};
    const sdk = {
      tool: vi.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
        name,
        description,
        schema,
        handler,
      })),
      createSdkMcpServer: vi.fn((o: { name: string; tools: unknown[] }) => ({
        type: 'sdk',
        name: o.name,
        instance: { tools: o.tools },
      })),
      query: vi.fn(({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
        Object.assign(seen, { prompt, options });
        async function* gen() {
          yield { type: 'system', subtype: 'init' };
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Looking. ' },
                {
                  type: 'tool_use',
                  id: 't1',
                  name: 'mcp__sdods__echo_test',
                  input: { text: 'hi' },
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'echo:hi' }] },
          };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } };
          yield {
            type: 'result',
            subtype: 'success',
            num_turns: 2,
            total_cost_usd: 0.0123,
            usage: { input_tokens: 10, output_tokens: 5 },
            is_error: false,
            result: '',
          };
        }
        return gen();
      }),
    };
    const adapter = new ClaudeAdapter({
      apiKey: 'test',
      sdk: sdk as never,
      withPlaywrightMcp: true,
    });
    const events: AgentEvent[] = [];
    const r = await adapter.runAgent({
      system: 'sys',
      prompt: 'go',
      tools: [echoTool],
      maxBudgetUsd: 1.5,
      maxTurns: 7,
      model: 'claude-opus-5',
      onEvent: (e) => events.push(e),
      mcpServers: { github: { command: 'npx', args: ['gh-mcp'] } },
    });
    expect(r.text).toBe('Looking. Done.');
    expect(r.turns).toBe(2);
    expect(r.costUsd).toBeCloseTo(0.0123);
    expect(r.toolCalls).toBe(1);
    expect(events.map((e) => e.type)).toEqual([
      'status',
      'text',
      'tool_call',
      'tool_result',
      'text',
      'result',
    ]);
    const opts = seen.options as Record<string, any>;
    expect(opts.maxBudgetUsd).toBe(1.5);
    expect(opts.maxTurns).toBe(7);
    expect(opts.systemPrompt).toBe('sys');
    expect(opts.disallowedTools).toContain('Bash');
    expect(opts.allowedTools).toEqual(
      expect.arrayContaining(['mcp__sdods__*', 'mcp__playwright__*', 'mcp__github__*']),
    );
    expect(Object.keys(opts.mcpServers)).toEqual(['sdods', 'playwright', 'github']);
    expect(opts.mcpServers.playwright.args).toEqual(['playwright', 'mcp', '--headless']);
    expect(sdk.tool).toHaveBeenCalledWith(
      'echo_test',
      'echo',
      echoTool.inputSchema,
      expect.any(Function),
      expect.anything(),
    );
    expect(await opts.canUseTool()).toMatchObject({ behavior: 'deny' });
  });

  it('normalizes result errors', () => {
    const ev = normalize({
      type: 'result',
      subtype: 'error_max_budget_usd',
      num_turns: 3,
      total_cost_usd: 2,
      is_error: true,
    });
    expect(ev[0]).toMatchObject({
      type: 'result',
      stopReason: 'error_max_budget_usd',
      isError: true,
      turns: 3,
    });
  });
});

describe('OpenAiCompatibleAdapter', () => {
  it('runs a tool loop over chat completions and estimates cost', async () => {
    const calls: unknown[] = [];
    const responses = [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', function: { name: 'echo_test', arguments: '{"text":"yo"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      },
      {
        choices: [{ message: { content: 'final answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 5 },
      },
    ];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    const adapter = new OpenAiCompatibleAdapter({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as never,
      prices: { m: { input: 1, output: 2 } },
    });
    const events: AgentEvent[] = [];
    const r = await adapter.runAgent({
      system: 's',
      prompt: 'p',
      tools: [echoTool],
      onEvent: (e) => events.push(e),
    });
    expect(r.text).toBe('final answer');
    expect(r.toolCalls).toBe(1);
    expect(r.turns).toBe(2);
    expect(r.costUsd).toBeCloseTo((220 * 1 + 15 * 2) / 1e6);
    const second = calls[1] as { messages: Array<{ role: string; content?: string }> };
    expect(second.messages.find((m) => m.role === 'tool')?.content).toBe('echo:yo');
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1);
  });

  it('stops on budget', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'x',
                  tool_calls: [{ id: 'c', function: { name: 'echo_test', arguments: '{}' } }],
                },
              },
            ],
            usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
          }),
        ),
    );
    const adapter = new OpenAiCompatibleAdapter({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as never,
      prices: { m: { input: 10, output: 0 } },
    });
    const r = await adapter.runAgent({
      system: 's',
      prompt: 'p',
      tools: [echoTool],
      maxBudgetUsd: 5,
    });
    expect(r.stopReason).toBe('error_max_budget_usd');
    expect(r.isError).toBe(true);
  });

  it('describes tool parameters the way local servers expect', async () => {
    const calls: Array<Record<string, any>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
      );
    });
    const withDefault: AgentSdkToolDef = {
      ...echoTool,
      name: 'echo_default',
      inputSchema: { text: z.string(), mode: z.string().default('loud') },
    };
    const adapter = new OpenAiCompatibleAdapter({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as never,
    });
    await adapter.runAgent({ system: 's', prompt: 'p', tools: [withDefault] });
    const params = calls[0]!.tools[0].function.parameters;
    // A field with a default is optional to the caller; io:'output' would have made it required.
    expect(params.required).toEqual(['text']);
    // Some grammar-constrained servers reject an embedded $schema.
    expect(params.$schema).toBeUndefined();
  });

  it('answers a malformed tool call with a correction instead of calling the tool empty', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'never' }] }));
    const responses = [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c1', function: { name: 'echo_test', arguments: '{"text": ' } }],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }] },
    ];
    const bodies: Array<Record<string, any>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responses.shift()));
    });
    const adapter = new OpenAiCompatibleAdapter({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as never,
    });
    const r = await adapter.runAgent({
      system: 's',
      prompt: 'p',
      tools: [{ ...echoTool, handler }],
    });
    expect(handler).not.toHaveBeenCalled();
    expect(r.text).toBe('recovered');
    const correction = (bodies[1]!.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === 'tool',
    );
    expect(correction?.content).toMatch(/not valid JSON/);
  });

  it('accepts tool arguments sent as an object', async () => {
    const responses = [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', function: { name: 'echo_test', arguments: { text: 'obj' } } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] },
    ];
    const bodies: Array<Record<string, any>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responses.shift()));
    });
    const adapter = new OpenAiCompatibleAdapter({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as never,
    });
    const r = await adapter.runAgent({ system: 's', prompt: 'p', tools: [echoTool] });
    expect(r.toolCalls).toBe(1);
    const toolMessage = (bodies[1]!.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === 'tool',
    );
    expect(toolMessage?.content).toBe('echo:obj');
  });

  it('retries once on a transient failure and gives up on a bad request', async () => {
    let attempts = 0;
    const flaky = vi.fn(async () => {
      attempts++;
      return attempts === 1
        ? new Response('busy', { status: 503 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
          );
    });
    const ok = new OpenAiCompatibleAdapter({ apiKey: 'k', fetchImpl: flaky as never });
    expect((await ok.complete({ prompt: 'p' })).text).toBe('ok');
    expect(attempts).toBe(2);

    const notFound = vi.fn(async () => new Response('model not found', { status: 404 }));
    const bad = new OpenAiCompatibleAdapter({ apiKey: 'k', fetchImpl: notFound as never });
    await expect(bad.complete({ prompt: 'p' })).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('does not require a key for a local endpoint', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'local' }, finish_reason: 'stop' }] }),
        ),
    );
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: 'http://localhost:11434/v1',
      fetchImpl: fetchImpl as never,
    });
    expect((await adapter.complete({ prompt: 'p' })).text).toBe('local');
    if (saved) process.env.OPENAI_API_KEY = saved;
  });
});

describe('FakeAdapter and factory', () => {
  it('executes real tool handlers from a script', async () => {
    const fake = new FakeAdapter({
      script: [
        { text: 'thinking ' },
        { toolCall: { name: 'echo_test', input: { text: 'a' } } },
        {
          fn: ({ lastToolOutput }) => ({
            text: `saw ${JSON.stringify((lastToolOutput as any).content[0].text)}`,
          }),
        },
      ],
    });
    const r = await fake.runAgent({ system: '', prompt: '', tools: [echoTool] });
    expect(r.text).toBe('thinking saw "echo:a"');
    expect(fake.calls[0]).toMatchObject({ name: 'echo_test' });
    expect((await fake.complete({ prompt: 'hello' })).text).toContain('fake completion');
  });

  it('resolves providers from flags/env', () => {
    expect(resolveProvider('openai')).toBe('openai-compatible');
    expect(resolveProvider(undefined, 'fake')).toBe('fake');
    expect(() => resolveProvider('gemini')).toThrow(/Unknown LLM provider/);
    expect(createAdapter({ provider: 'fake' }).provider).toBe('fake');
  });
});
