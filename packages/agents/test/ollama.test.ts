import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaAdapter } from '../src/adapter/ollama.js';
import { normalizeProvider, createAdapter, detectProvider } from '../src/adapter/factory.js';
import type { AgentsConfigError } from '../src/adapter/types.js';
import type { AgentSdkToolDef } from '@sdods/mcp';

const echoTool: AgentSdkToolDef = {
  name: 'echo_test',
  description: 'echo',
  inputSchema: { text: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: async (args) => ({ content: [{ type: 'text', text: `echo:${String(args.text)}` }] }),
};

/** Answers the native endpoints with fixtures shaped like a real Ollama 0.33. */
function server(chat: unknown[], extra: Record<string, unknown> = {}) {
  const bodies: Array<{ url: string; body?: Record<string, any> }> = [];
  const queue = [...chat];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    bodies.push({ url: String(url), body });
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/chat') return new Response(JSON.stringify(queue.shift()));
    if (path in extra) return new Response(JSON.stringify(extra[path]));
    return new Response('not found', { status: 404 });
  });
  return { fetchImpl, bodies };
}

describe('OllamaAdapter', () => {
  it('asks the native endpoint for a non-streamed answer with a fixed context', async () => {
    const { fetchImpl, bodies } = server([
      { message: { content: 'hello' }, prompt_eval_count: 11, eval_count: 3 },
    ]);
    const adapter = new OllamaAdapter({
      model: 'qwen2.5-coder:7b',
      contextTokens: 16384,
      fetchImpl: fetchImpl as never,
    });
    const r = await adapter.complete({ prompt: 'hi' });
    expect(r.text).toBe('hello');
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    expect(r.costUsd).toBe(0);
    const body = bodies[0]!.body!;
    expect(body.stream).toBe(false);
    expect(body.options.num_ctx).toBe(16384);
    expect(body.keep_alive).toBe('10m');
    expect(body.think).toBe(false);
  });

  it('runs a tool loop over object-shaped tool calls', async () => {
    const { fetchImpl, bodies } = server([
      {
        message: {
          content: '',
          tool_calls: [{ function: { name: 'echo_test', arguments: { text: 'yo' } } }],
        },
      },
      { message: { content: 'done' }, done_reason: 'stop' },
    ]);
    const adapter = new OllamaAdapter({
      model: 'm',
      contextTokens: 16384,
      fetchImpl: fetchImpl as never,
    });
    const r = await adapter.runAgent({ system: 's', prompt: 'p', tools: [echoTool] });
    expect(r.text).toBe('done');
    expect(r.toolCalls).toBe(1);
    // Native tool results carry the tool name, not an id the server never sent.
    const second = bodies[1]!.body!.messages as Array<Record<string, string>>;
    expect(second.at(-1)).toMatchObject({
      role: 'tool',
      tool_name: 'echo_test',
      content: 'echo:yo',
    });
  });

  it('refuses to run a job that would be silently truncated', async () => {
    const { fetchImpl } = server([], {
      '/api/ps': { models: [{ name: 'm', context_length: 4096 }] },
      '/api/show': { capabilities: ['tools'], model_info: { 'llama.context_length': 131072 } },
    });
    const adapter = new OllamaAdapter({ model: 'm', fetchImpl: fetchImpl as never });
    await expect(
      adapter.runAgent({ system: 'x'.repeat(20_000), prompt: 'p', tools: [echoTool] }),
    ).rejects.toThrow(/would truncate it|token context/i);
  });

  it('explains a model that is not pulled', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "model 'nope' not found" }), { status: 404 }),
    );
    const adapter = new OllamaAdapter({ model: 'nope', fetchImpl: fetchImpl as never });
    const err = await adapter.complete({ prompt: 'p' }).catch((e) => e as AgentsConfigError);
    expect(String(err)).toMatch(/no model named "nope"/);
    expect(err.hint).toMatch(/ollama pull nope/);
  });

  it('says what to do when nothing is listening', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as never });
    const err = await adapter.complete({ prompt: 'p' }).catch((e) => e as AgentsConfigError);
    expect(String(err)).toMatch(/Cannot reach Ollama/);
    expect(err.hint).toMatch(/ollama serve/);
  });

  it('reads what is installed and how it is loaded', async () => {
    const { fetchImpl } = server([], {
      '/api/tags': {
        models: [{ name: 'llama3.1:8b', size: 4_900_000_000, details: { parameter_size: '8.0B' } }],
      },
      '/api/show': {
        capabilities: ['completion', 'tools'],
        model_info: { 'llama.context_length': 131072 },
      },
      '/api/ps': { models: [{ name: 'llama3.1:8b', context_length: 4096 }] },
    });
    const adapter = new OllamaAdapter({ fetchImpl: fetchImpl as never });
    expect((await adapter.models())[0]).toMatchObject({
      name: 'llama3.1:8b',
      parameterSize: '8.0B',
    });
    expect(await adapter.show('llama3.1:8b')).toEqual({
      capabilities: ['completion', 'tools'],
      contextLength: 131072,
    });
    expect(await adapter.loadedContext('llama3.1:8b')).toBe(4096);
  });

  it('accepts a host written any of the usual ways', () => {
    const of = (baseUrl?: string) => new OllamaAdapter({ baseUrl }).baseUrl;
    expect(of('127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(of('http://box.local:11434/')).toBe('http://box.local:11434');
    expect(of('http://box.local:11434/v1')).toBe('http://box.local:11434');
  });
});

describe('provider selection for local models', () => {
  it('makes ollama its own provider rather than an OpenAI alias', () => {
    expect(normalizeProvider('ollama')).toBe('ollama');
    expect(normalizeProvider('local')).toBe('ollama');
    expect(normalizeProvider('vllm')).toBe('openai-compatible');
    expect(normalizeProvider('lmstudio')).toBe('openai-compatible');
    expect(createAdapter({ provider: 'ollama' }).provider).toBe('ollama');
    expect(createAdapter({ provider: 'ollama' }).defaultModel).toMatch(/qwen/);
  });

  it('prefers a deliberate credential over a local server, and a local server over nothing', () => {
    expect(detectProvider({ ANTHROPIC_API_KEY: 'k', OLLAMA_HOST: 'x' }).provider).toBe('claude');
    // The real order also consults the CLI logins, which are present on a developer machine, so
    // this asserts the part that is ours: OLLAMA_HOST alone never outranks an API key.
    const withKey = detectProvider({ OPENAI_API_KEY: 'k', OLLAMA_HOST: 'x' }).provider;
    expect(withKey).not.toBe('ollama');
    expect(detectProvider({ OLLAMA_HOST: 'http://127.0.0.1:11434' }).provider).not.toBe('fake');
  });
});
