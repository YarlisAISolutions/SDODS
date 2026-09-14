import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { Corpus } from '../src/corpus.js';
import { utcDay } from '../src/limits.js';
import { buildMaxiServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { StepCatalog } from '../src/tools.js';
import { fakeClient, type Turn } from './fake-client.js';

const DOCS =
  '# Installation\n\nURL: https://docs.sdods.com/docs/getting-started/installation\n\nRun the installer.';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(
  turns: Turn[],
  opts: { corpus?: boolean; budget?: number; spent?: number } = {},
) {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), dailyBudgetUsd: opts.budget ?? 5 };
  const { client, requests } = fakeClient(turns);
  const corpus = new Corpus({
    url: 'https://docs.example/llms-full.txt',
    refreshMs: 60_000,
    fetch: (async () => new Response(DOCS)) as unknown as typeof fetch,
  });
  if (opts.corpus !== false) await corpus.load();
  const store = new MemoryStore();
  if (opts.spent) await store.addSpend(utcDay(), opts.spent);
  const catalog = new StepCatalog([
    { keyword: 'Given', pattern: 'I am on the login page', source: 'project' },
    { keyword: 'Then', pattern: 'the page URL should contain {string}', source: 'project' },
  ]);
  app = await buildMaxiServer({ config, client, corpus, catalog, store, logger: false });
  return { app, requests, store };
}

function events(body: string) {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('event:'))
    .map((chunk) => {
      const [eventLine, dataLine] = chunk.split('\n');
      return {
        event: eventLine!.slice('event: '.length),
        data: JSON.parse(dataLine!.slice('data: '.length)),
      };
    });
}

const ask = (app: FastifyInstance, payload: unknown, origin = 'https://docs.sdods.com') =>
  app.inject({ method: 'POST', url: '/chat', headers: { origin }, payload: payload as object });

describe('POST /chat', () => {
  it('streams the answer, caches the docs prefix, and logs the conversation anonymously', async () => {
    const { app, requests, store } = await setup([
      { text: 'Run the installer, then `sdods doctor`.' },
    ]);
    const res = await ask(app, {
      messages: [{ role: 'user', content: 'How do I install SDODS?' }],
      page: 'https://docs.sdods.com/docs/getting-started/installation/',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['access-control-allow-origin']).toBe('https://docs.sdods.com');

    const evs = events(res.body);
    expect(
      evs
        .filter((e) => e.event === 'text')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Run the installer, then `sdods doctor`.');
    const done = evs.at(-1)!;
    expect(done).toMatchObject({ event: 'done', data: { stopReason: 'end_turn' } });

    const req = requests[0]!;
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.thinking).toEqual({ type: 'adaptive' });
    expect(req.output_config).toEqual({ effort: 'low' });
    const system = req.system as Anthropic.TextBlockParam[];
    expect(system).toHaveLength(2);
    expect(system[0]!.text).toMatch(/You are Maxi/);
    expect(system[0]!.cache_control).toBeUndefined();
    expect(system[1]!.text).toContain(DOCS);
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    // The page goes with the visitor's message, never into the cached system prompt.
    expect(req.messages.at(-1)!.content).toEqual([
      { type: 'text', text: 'How do I install SDODS?' },
      {
        type: 'text',
        text: '<page>https://docs.sdods.com/docs/getting-started/installation/</page>',
      },
    ]);

    // Logging and the spend counter run after the stream closes.
    await new Promise((r) => setTimeout(r, 10));
    const log = store.chats.get(done.data.id)!;
    expect(log).toMatchObject({
      question: 'How do I install SDODS?',
      turns: 2,
      stopReason: 'end_turn',
    });
    expect(Object.keys(log)).not.toContain('ip');
    expect(store.spend.get(utcDay())).toBeGreaterThan(0);
  });

  it('keeps the system prompt byte-identical across visitors so the cache hits', async () => {
    const { app, requests } = await setup([{ text: 'one' }, { text: 'two' }]);
    await ask(app, {
      messages: [{ role: 'user', content: 'first visitor' }],
      page: 'https://sdods.com/',
    });
    await ask(app, { messages: [{ role: 'user', content: 'second visitor' }] });
    expect(JSON.stringify(requests[0]!.system)).toBe(JSON.stringify(requests[1]!.system));
    expect(JSON.stringify(requests[0]!.tools)).toBe(JSON.stringify(requests[1]!.tools));
  });

  it('runs validate_feature and hands the report back before the final answer', async () => {
    const feature = '@smoke\nFeature: Login\n  Scenario: ok\n    Given I am on the login page\n';
    const { app, requests } = await setup([
      { text: 'Let me check that.', tool: { name: 'validate_feature', input: { feature } } },
      { text: 'Fixed: added @ui.' },
    ]);
    const res = await ask(app, { messages: [{ role: 'user', content: 'Write a login feature' }] });
    const evs = events(res.body);
    expect(evs.some((e) => e.event === 'tool' && e.data.name === 'validate_feature')).toBe(true);
    expect(
      evs
        .filter((e) => e.event === 'text')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Let me check that.\n\nFixed: added @ui.');
    const second = requests[1]!.messages;
    const toolResult = (second.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResult.type).toBe('tool_result');
    expect(JSON.parse(toolResult.content as string)).toMatchObject({ valid: false });
    expect(String(toolResult.content)).toMatch(/exactly one layer tag/);
  });

  it('stops offering tools after the round limit so the loop always ends', async () => {
    const loop: Turn = { tool: { name: 'find_steps', input: { query: 'login' } } };
    const { app, requests } = await setup([...Array(6).fill(loop), { text: 'Here is my answer.' }]);
    const res = await ask(app, { messages: [{ role: 'user', content: 'find steps forever' }] });
    expect(events(res.body).at(-1)).toMatchObject({ event: 'done' });
    expect(requests).toHaveLength(7);
    expect(requests[5]!.tool_choice).toBeUndefined();
    expect(requests[6]!.tool_choice).toEqual({ type: 'none' });
  });

  it('turns a rate limit from the API into a friendly, retryable error event', async () => {
    const error = new Anthropic.RateLimitError(
      429,
      { type: 'error' },
      'rate limited',
      new Headers(),
    );
    const { app, store } = await setup([{ error }]);
    const res = await ask(app, { messages: [{ role: 'user', content: 'hi' }] });
    expect(events(res.body).at(-1)).toMatchObject({ event: 'error', data: { retryable: true } });
    expect(store.chats.size).toBe(0);
  });

  it('refuses bad input, a cold start and an exhausted daily budget', async () => {
    let s = await setup([]);
    expect(
      (await ask(s.app, { messages: [{ role: 'assistant', content: 'hi' }] })).statusCode,
    ).toBe(400);
    await s.app.close();

    s = await setup([], { corpus: false });
    expect((await ask(s.app, { messages: [{ role: 'user', content: 'hi' }] })).statusCode).toBe(
      503,
    );
    await s.app.close();

    s = await setup([{ text: 'never sent' }], { budget: 1, spent: 1.5 });
    const res = await ask(s.app, { messages: [{ role: 'user', content: 'hi' }] });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/tomorrow/);
    expect(s.requests).toHaveLength(0);
  });
});

describe('CORS', () => {
  it('allows the SDODS sites and their preview channels, and nothing else', async () => {
    const { app } = await setup([{ text: 'ok' }]);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/chat',
      headers: {
        origin: 'https://sdods-automax--pr-42-abc123.web.app',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://sdods-automax--pr-42-abc123.web.app',
    );

    const foreign = await ask(
      app,
      { messages: [{ role: 'user', content: 'hi' }] },
      'https://evil.example',
    );
    expect(foreign.statusCode).toBe(403);
    const lookalike = await ask(
      app,
      { messages: [{ role: 'user', content: 'hi' }] },
      'https://someone-else--pr-1-x.web.app',
    );
    expect(lookalike.statusCode).toBe(403);
  });
});

describe('POST /feedback and GET /health', () => {
  it('records a vote on a logged conversation', async () => {
    const { app, store } = await setup([{ text: 'answer' }]);
    const res = await ask(app, { messages: [{ role: 'user', content: 'q' }] });
    const id = events(res.body).at(-1)!.data.id as string;
    await new Promise((r) => setTimeout(r, 10));

    const vote = (payload: object) => app.inject({ method: 'POST', url: '/feedback', payload });
    expect((await vote({ id, vote: 'down' })).statusCode).toBe(200);
    expect(store.chats.get(id)!.vote).toBe('down');
    expect(
      (await vote({ id: '00000000-0000-4000-8000-000000000000', vote: 'up' })).statusCode,
    ).toBe(404);
    expect((await vote({ id, vote: 'meh' })).statusCode).toBe(400);
  });

  it('reports the loaded docs and step catalog', async () => {
    const { app } = await setup([]);
    const health = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(health).toMatchObject({
      ok: true,
      steps: 2,
      model: 'claude-sonnet-5',
      corpus: { source: 'url' },
    });
  });
});
