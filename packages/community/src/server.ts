import type Anthropic from '@anthropic-ai/sdk';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { canModerate, type Verifier, type Viewer } from './auth.js';
import type { CommunityConfig } from './config.js';
import type { ThreadIndex } from './duplicates.js';
import { redact } from './redact.js';
import { parseAnswer, parseQuestion, parseResolve, parseRole } from './requests.js';
import { review, type Decision, type ReviewResult } from './review.js';
import {
  POST_PATH,
  type CommunityStore,
  type PostStatus,
  type ReviewSummary,
  type Target,
  type UsageTotals,
} from './store.js';

export interface CommunityServerDeps {
  config: CommunityConfig;
  client: Pick<Anthropic, 'messages'>;
  verify: Verifier;
  store: CommunityStore;
  index: ThreadIndex;
  logger?: boolean | object;
  now?: () => Date;
}

export function isAllowedOrigin(origin: string, config: CommunityConfig): boolean {
  if (config.allowedOrigins.includes(origin)) return true;
  // Firebase Hosting preview channels: https://<site>--<channel>-<hash>.web.app
  const m = /^https:\/\/([a-z0-9-]+?)--[a-z0-9-]+\.web\.app$/.exec(origin);
  return Boolean(m && config.previewSites.includes(m[1]!));
}

/** USD per million tokens; unknown models are priced like Opus so the budget errs on the safe side. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
};

export function costUsd(model: string, u: UsageTotals): number {
  const p = PRICES[model] ?? { input: 5, output: 25 };
  const m = 1_000_000;
  return (
    (u.input_tokens * p.input +
      u.cache_creation_input_tokens * p.input * 1.25 +
      u.cache_read_input_tokens * p.input * 0.1 +
      u.output_tokens * p.output) /
    m
  );
}

function totals(u: Anthropic.Usage | undefined): UsageTotals | undefined {
  if (!u) return undefined;
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

const STATUS: Record<Decision, PostStatus> = {
  publish: 'published',
  reject: 'rejected',
  queue: 'pending',
};

/** What the author is told, per outcome, when the reviewer gave no reason of its own. */
const FALLBACK_REASON: Record<Decision, string> = {
  publish: '',
  reject: 'This does not look like a question about SDODS.',
  queue: 'An editor will look at this shortly.',
};

export async function buildCommunityServer(deps: CommunityServerDeps): Promise<FastifyInstance> {
  const { config, client, verify, store, index } = deps;
  const now = deps.now ?? (() => new Date());
  const app = Fastify({
    logger: deps.logger ?? { level: process.env.COMMUNITY_LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy as boolean | string | string[],
    bodyLimit: 64 * 1024,
  });

  // CORS: sdods.com and its preview channels only. The Authorization header carries the Firebase
  // ID token, so it has to be allowed on the preflight.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin) return;
    if (!isAllowedOrigin(origin, config))
      return reply.code(403).send({ error: 'Origin not allowed' });
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      return reply
        .code(204)
        .header('access-control-allow-methods', 'GET, POST, OPTIONS')
        .header('access-control-allow-headers', 'content-type, authorization')
        .header('access-control-max-age', '600')
        .send();
    }
  });

  await app.register(rateLimit, {
    max: config.ipRateLimit,
    timeWindow: config.rateLimitWindowMs,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`,
    }),
  });

  // Per-account post limit, on top of the per-IP one: one account cannot flood the queue from
  // many addresses. In memory per instance; the service runs a handful of instances at most.
  const recent = new Map<string, number[]>();
  const overPostLimit = (uid: string): boolean => {
    const cutoff = now().getTime() - config.rateLimitWindowMs;
    const hits = (recent.get(uid) ?? []).filter((t) => t > cutoff);
    if (hits.length >= config.postsPerWindow) {
      recent.set(uid, hits);
      return true;
    }
    hits.push(now().getTime());
    recent.set(uid, hits);
    return false;
  };

  const viewerOf = async (req: FastifyRequest, reply: FastifyReply): Promise<Viewer | null> => {
    const v = await verify(req.headers.authorization);
    if (!v) {
      await reply.code(401).send({ error: 'Sign in to post.' });
      return null;
    }
    return v;
  };

  app.get('/health', async () => ({
    ok: true,
    models: [config.reviewModel, config.escalationModel],
    threads: index.size,
  }));

  app.get('/me', async (req, reply) => {
    const v = await viewerOf(req, reply);
    if (!v) return reply;
    return { uid: v.uid, name: v.name, role: v.role, provider: v.provider };
  });

  /** The shared path for questions and answers: redact, review, store, log, respond. */
  async function submit(
    req: FastifyRequest,
    viewer: Viewer,
    target: Target,
    post: { title: string; body: string; category?: string; question?: string },
  ) {
    const user = await store.ensureUser({
      uid: viewer.uid,
      name: viewer.name,
      picture: viewer.picture,
      provider: viewer.provider,
    });
    const title = redact(post.title);
    const body = redact(post.body);
    const redacted = [...title.found, ...body.found];
    const kind = target.kind === 'question' ? 'question' : 'answer';

    const day = utcDay(now());
    let result: ReviewResult;
    let spent = Infinity;
    try {
      spent = await store.spentToday(day);
    } catch (e) {
      // A store outage must not lift the budget: fail closed, to a human.
      req.log.error({ err: e }, 'budget check failed');
    }
    if (spent >= config.dailyBudgetUsd) {
      result = { decision: 'queue', signals: null, calls: [] };
    } else {
      result = await review(
        { client, reviewModel: config.reviewModel, escalationModel: config.escalationModel },
        { kind, title: title.text, body: body.text, question: post.question },
      );
    }

    let decision = result.decision;
    const ageHours = (now().getTime() - user.firstSeen.getTime()) / 3_600_000;
    if (decision === 'publish' && ageHours < config.newAccountQueueHours) decision = 'queue';

    const s = result.signals;
    const summary: ReviewSummary = {
      decision,
      by: result.calls.at(-1)?.model ?? 'budget',
      relevance: s?.relevance ?? null,
      confidence: s?.confidence ?? null,
      reason: decision === 'publish' ? '' : s?.reason_for_author || FALLBACK_REASON[decision],
      notes: s?.quality_notes ?? [],
    };
    const path = await store.createPost(target, {
      uid: viewer.uid,
      name: viewer.name,
      title: kind === 'question' ? title.text : undefined,
      category: post.category,
      body: body.text,
      status: STATUS[decision],
      review: summary,
      redacted,
    });

    const calls = result.calls.map(({ usage, ...c }) => ({ ...c, usage: totals(usage) }));
    const cost = calls.reduce((sum, c) => sum + (c.usage ? costUsd(c.model, c.usage) : 0), 0);
    req.log.info(
      { path, decision, calls: calls.map((c) => [c.model, c.decision]), cost },
      'review',
    );
    void store
      .saveReview({ path, uid: viewer.uid, kind, decision, calls, costUsd: cost, redacted })
      .catch((e) => req.log.error({ err: e }, 'saveReview failed'));
    if (cost > 0)
      void store.addSpend(day, cost).catch((e) => req.log.error({ err: e }, 'addSpend failed'));

    return {
      status: STATUS[decision],
      path,
      id: path.split('/').at(-1),
      reason: summary.reason || undefined,
      notes: summary.notes,
      redacted: redacted.length > 0,
      similar: kind === 'question' ? index.similar(title.text, body.text) : [],
    };
  }

  app.post('/questions', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    const parsed = parseQuestion(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    if (overPostLimit(viewer.uid))
      return reply
        .code(429)
        .send({ error: 'You are posting quickly. Try again in a little while.' });
    const q = parsed.value;
    return submit(req, viewer, { kind: 'question' }, q);
  });

  app.post('/answers', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    const parsed = parseAnswer(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { target, parentId, body } = parsed.value;

    // The question gives the reviewer context, and must exist: no answers to nothing.
    let question: { title: string; body: string } | null;
    let dest: Target;
    if ('questionId' in target) {
      question = await store.publishedQuestion(target.questionId);
      dest = { kind: 'answer', questionId: target.questionId, parentId };
    } else {
      const title = index.title(target.slug);
      question = title ? { title, body: '' } : null;
      dest = { kind: 'threadAnswer', slug: target.slug, parentId };
    }
    if (!question) return reply.code(404).send({ error: 'That question is not available.' });
    if (overPostLimit(viewer.uid))
      return reply
        .code(429)
        .send({ error: 'You are posting quickly. Try again in a little while.' });
    return submit(req, viewer, dest, {
      title: question.title,
      body,
      question: `${question.title}\n\n${question.body}`.trim(),
    });
  });

  app.get('/review/queue', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    if (!canModerate(viewer)) return reply.code(403).send({ error: 'Editors only.' });
    return { items: await store.queue() };
  });

  app.post('/review/resolve', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    if (!canModerate(viewer)) return reply.code(403).send({ error: 'Editors only.' });
    const parsed = parseResolve(req.body, POST_PATH);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { path, action, reason } = parsed.value;
    const decision: Decision = action === 'approve' ? 'publish' : 'reject';
    const done = await store.resolve(path, action === 'approve' ? 'published' : 'rejected', {
      decision,
      by: viewer.uid,
      relevance: null,
      confidence: null,
      reason,
      notes: [],
    });
    if (!done) return reply.code(409).send({ error: 'That post is no longer waiting for review.' });
    req.log.info({ path, action, editor: viewer.uid }, 'resolved');
    return { ok: true };
  });

  app.post('/admin/role', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    if (viewer.role !== 'admin') return reply.code(403).send({ error: 'Admins only.' });
    const parsed = parseRole(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    await store.setRole(parsed.value.uid, parsed.value.role);
    req.log.info({ ...parsed.value, by: viewer.uid }, 'role set');
    return {
      ok: true,
      note: 'Takes effect when that user next signs in or their session refreshes (within an hour).',
    };
  });

  return app;
}
