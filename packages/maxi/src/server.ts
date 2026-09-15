import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { runChat, type ChatEvent, type ChatResult } from './chat.js';
import type { MaxiConfig } from './config.js';
import type { Corpus } from './corpus.js';
import { estimateCostUsd, MAX_USER_CHARS, parseChatRequest, utcDay } from './limits.js';
import { systemBlocks } from './prompt.js';
import type { MaxiStore } from './store.js';
import type { StepCatalog } from './tools.js';

export interface MaxiServerDeps {
  config: MaxiConfig;
  client: Pick<Anthropic, 'messages'>;
  corpus: Corpus;
  catalog: StepCatalog;
  store: MaxiStore;
  logger?: boolean | object;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAllowedOrigin(origin: string, config: MaxiConfig): boolean {
  if (config.allowedOrigins.includes(origin)) return true;
  // Firebase Hosting preview channels: https://<site>--<channel>-<hash>.web.app
  const m = /^https:\/\/([a-z0-9-]+?)--[a-z0-9-]+\.web\.app$/.exec(origin);
  return Boolean(m && config.previewSites.includes(m[1]!));
}

export async function buildMaxiServer(deps: MaxiServerDeps): Promise<FastifyInstance> {
  const { config, client, corpus, catalog, store } = deps;
  const app = Fastify({
    logger: deps.logger ?? { level: process.env.MAXI_LOG_LEVEL ?? 'info' },
    // A hop count is supported at runtime (proxy-addr) but missing from this overload's types.
    trustProxy: config.trustProxy as boolean | string | string[],
    bodyLimit: 256 * 1024,
  });
  const log = (msg: string, extra?: Record<string, unknown>) => app.log.info(extra ?? {}, msg);

  // CORS: the two SDODS sites (and their preview channels) only. Requests with no Origin header
  // (curl, health checks) pass; the rate limit and budget still apply to them.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin) return;
    if (!isAllowedOrigin(origin, config)) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      return reply
        .code(204)
        .header('access-control-allow-methods', 'POST, GET, OPTIONS')
        .header('access-control-allow-headers', 'content-type')
        .header('access-control-max-age', '600')
        .send();
    }
  });

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: `You're sending messages faster than Maxi can keep up. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`,
    }),
  });

  app.get('/health', async () => ({
    ok: true,
    corpus: corpus.current ? { hash: corpus.current.hash, source: corpus.current.source } : null,
    steps: catalog.steps.length,
    model: config.model,
  }));

  app.post(
    '/chat',
    { config: { rateLimit: { max: config.chatRateLimit, timeWindow: config.rateLimitWindowMs } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseChatRequest(req.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      const snapshot = corpus.current;
      if (!snapshot) {
        return reply
          .code(503)
          .send({ error: 'Maxi is still reading the docs. Try again in a minute.' });
      }
      const day = utcDay();
      let spent: number;
      try {
        spent = await store.spentToday(day);
      } catch (e) {
        // A store outage must not silently lift the budget: fail closed.
        req.log.error({ err: e }, 'budget check failed');
        return reply.code(503).send({ error: 'Maxi is unavailable right now. Try again later.' });
      }
      if (spent >= config.dailyBudgetUsd) {
        return reply.code(503).send({
          error:
            'Maxi has answered all the questions it can for today. Try again tomorrow, or ask on the community Q&A.',
          askUrl: config.askUrl,
        });
      }

      const id = randomUUID();
      const { messages, page } = parsed.value;
      const abort = new AbortController();
      // The request stream closes as soon as its body is read; the response closing before it
      // finished is what means the visitor went away. Stop generating (and paying) then.
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
      });

      const lastUser = messages[messages.length - 1]!.content as string;
      const onComplete = (r: ChatResult) => {
        if (!r.completed) return;
        const costUsd = estimateCostUsd(config.model, r.usage);
        req.log.info(
          { id, usage: r.usage, costUsd, tools: r.toolCalls, stop: r.stopReason },
          'chat',
        );
        void store
          .addSpend(day, costUsd)
          .catch((e) => req.log.error({ err: e }, 'addSpend failed'));
        void store
          .saveChat({
            id,
            question: lastUser.slice(0, MAX_USER_CHARS),
            answer: r.answer,
            turns: messages.length + 1,
            model: config.model,
            corpusHash: snapshot.hash,
            page,
            toolCalls: r.toolCalls,
            stopReason: r.stopReason,
            usage: r.usage,
            costUsd,
          })
          .catch((e) => req.log.error({ err: e }, 'saveChat failed'));
      };

      const events = runChat(
        {
          client,
          model: config.model,
          maxTokens: config.maxTokens,
          system: systemBlocks(config, snapshot.text),
          catalog,
          log,
        },
        id,
        messages,
        { page, signal: abort.signal, onComplete },
      );
      writeSse(reply, events);
      return reply;
    },
  );

  app.post(
    '/feedback',
    { config: { rateLimit: { max: 60, timeWindow: config.rateLimitWindowMs } } },
    async (req, reply) => {
      const { id, vote } = (req.body ?? {}) as { id?: unknown; vote?: unknown };
      if (typeof id !== 'string' || !ID.test(id) || (vote !== 'up' && vote !== 'down')) {
        return reply.code(400).send({ error: 'Expected { id, vote: "up" | "down" }' });
      }
      try {
        const found = await store.vote(id, vote);
        return found ? { ok: true } : reply.code(404).send({ error: 'Unknown conversation' });
      } catch (e) {
        req.log.error({ err: e }, 'vote failed');
        return reply.code(503).send({ error: 'Could not save that right now' });
      }
    },
  );

  return app;
}

/** Writes events as text/event-stream. Cloud Run streams the body as it is written. */
function writeSse(reply: FastifyReply, events: AsyncGenerator<ChatEvent>): void {
  const raw = reply.raw;
  const headers: Record<string, string | number | string[]> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  };
  for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v;
  reply.hijack();
  raw.writeHead(200, headers);
  raw.write(':ok\n\n');
  const heartbeat = setInterval(() => {
    if (!raw.writableEnded) raw.write(':hb\n\n');
  }, 15_000);
  heartbeat.unref();
  void (async () => {
    try {
      for await (const e of events) {
        if (raw.writableEnded) break;
        raw.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      if (!raw.writableEnded) raw.end();
    }
  })();
}
