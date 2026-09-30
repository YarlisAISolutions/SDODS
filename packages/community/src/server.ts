import type Anthropic from '@anthropic-ai/sdk';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { canModerate, type RoleClaims, type Verifier, type Viewer } from './auth.js';
import type { CommunityConfig } from './config.js';
import type { ThreadIndex } from './duplicates.js';
import { editPost, resolveEdit } from './edits.js';
import { acceptAnswer, castVote } from './engagement.js';
import { canVote, type VoteValue } from './reputation.js';
import { redact } from './redact.js';
import { parseAnswer, parseQuestion, parseResolve, parseRole } from './requests.js';
import { review, type Decision, type ReviewResult } from './review.js';
import {
  newId,
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
  /** Grants roles in the identity provider; without it, roles live only on the profile. */
  roleClaims?: RoleClaims;
  store: CommunityStore;
  index: ThreadIndex;
  logger?: boolean | object;
  now?: () => Date;
}

export function isAllowedOrigin(origin: string, config: CommunityConfig): boolean {
  if (config.allowedOrigins.includes(origin)) return true;
  return config.allowedOriginPatterns.some((p) => originPattern(p).test(origin));
}

/**
 * `https://site--*.example.app` → a RegExp in which `*` stands for letters, digits and hyphens but
 * never a dot, so a pattern for preview hosts cannot match someone else's domain.
 */
export function originPattern(glob: string): RegExp {
  const escaped = glob.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('[a-z0-9-]+')}$`);
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
  const { config, client, verify, roleClaims, store, index } = deps;
  const now = deps.now ?? (() => new Date());
  const app = Fastify({
    logger: deps.logger ?? { level: process.env.COMMUNITY_LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy as boolean | string | string[],
    bodyLimit: 64 * 1024,
  });

  // CORS: the configured sites and preview hosts only. The Authorization header carries the
  // sign-in ID token, so it has to be allowed on the preflight.
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

  /** The AI review with the daily budget in front of it: past the budget, a human decides. */
  async function reviewWithBudget(
    req: FastifyRequest,
    post: { kind: 'question' | 'answer'; title: string; body: string; question?: string },
  ): Promise<{ result: ReviewResult; day: string }> {
    const day = utcDay(now());
    let spent = Infinity;
    try {
      spent = await store.spentToday(day);
    } catch (e) {
      // A store outage must not lift the budget: fail closed, to a human.
      req.log.error({ err: e }, 'budget check failed');
    }
    if (spent >= config.dailyBudgetUsd)
      return { result: { decision: 'queue', signals: null, calls: [] }, day };
    const result = await review(
      { client, reviewModel: config.reviewModel, escalationModel: config.escalationModel },
      post,
    );
    return { result, day };
  }

  /** The audit row and the spend counter for one review, off the request's critical path. */
  function logReview(
    req: FastifyRequest,
    r: {
      path: string;
      uid: string;
      kind: 'question' | 'answer';
      decision: Decision;
      result: ReviewResult;
      redacted: string[];
      day: string;
    },
  ) {
    const calls = r.result.calls.map(({ usage, ...c }) => ({ ...c, usage: totals(usage) }));
    const cost = calls.reduce((sum, c) => sum + (c.usage ? costUsd(c.model, c.usage) : 0), 0);
    req.log.info(
      { path: r.path, decision: r.decision, calls: calls.map((c) => [c.model, c.decision]), cost },
      'review',
    );
    void store
      .saveReview({
        path: r.path,
        uid: r.uid,
        kind: r.kind,
        decision: r.decision,
        calls,
        costUsd: cost,
        redacted: r.redacted,
      })
      .catch((e) => req.log.error({ err: e }, 'saveReview failed'));
    if (cost > 0)
      void store.addSpend(r.day, cost).catch((e) => req.log.error({ err: e }, 'addSpend failed'));
  }

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

    const { result, day } = await reviewWithBudget(req, {
      kind,
      title: title.text,
      body: body.text,
      question: post.question,
    });

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

    logReview(req, { path, uid: viewer.uid, kind, decision, result, redacted, day });

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

  // Votes per user per day, in memory per instance, like the post limit.
  const votesToday = new Map<string, number>();
  const overVoteLimit = (uid: string): boolean => {
    const key = `${utcDay(now())}:${uid}`;
    const n = votesToday.get(key) ?? 0;
    if (n >= config.votesPerDay) return true;
    votesToday.set(key, n + 1);
    if (votesToday.size > 10_000) votesToday.clear();
    return false;
  };

  const VOTE_ERRORS = {
    not_found: [404, 'That post is not available.'],
    own_post: [403, 'You cannot vote on your own post.'],
    not_votable: [400, 'Replies are not voted on; vote on the answer instead.'],
  } as const;

  app.post('/votes', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    const { path, value } = (req.body ?? {}) as { path?: unknown; value?: unknown };
    if (
      typeof path !== 'string' ||
      !POST_PATH.test(path) ||
      (value !== 1 && value !== -1 && value !== 0)
    )
      return reply.code(400).send({ error: 'Expected { path, value: 1 | -1 | 0 }' });
    const rep = await store.userRep(viewer.uid);
    const allowed = canVote(value as VoteValue, rep, viewer.role, {
      upvote: config.upvoteRep,
      downvote: config.downvoteRep,
    });
    if (!allowed.ok)
      return reply.code(403).send({
        error: `You need ${allowed.need} reputation to vote ${value === 1 ? 'up' : 'down'}; you have ${rep}. Answers that get accepted earn 15.`,
        need: allowed.need,
        rep,
      });
    if (value !== 0 && overVoteLimit(viewer.uid))
      return reply
        .code(429)
        .send({ error: `That is ${config.votesPerDay} votes today. More tomorrow.` });
    const out = await castVote(store.transact, newId, {
      uid: viewer.uid,
      path,
      value: value as VoteValue,
    });
    if (!out.ok) {
      const [code, error] = VOTE_ERRORS[out.error];
      return reply.code(code).send({ error });
    }
    return out;
  });

  app.get('/votes/mine', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    const raw = String((req.query as { paths?: unknown }).paths ?? '');
    const paths = raw.split(',').filter((p) => POST_PATH.test(p));
    if (paths.length > 100) return reply.code(400).send({ error: 'At most 100 paths' });
    return { votes: await store.myVotes(viewer.uid, paths), rep: await store.userRep(viewer.uid) };
  });

  app.post('/accept', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    const { questionId, answerId } = (req.body ?? {}) as {
      questionId?: unknown;
      answerId?: unknown;
    };
    const id = /^[A-Za-z0-9]{1,40}$/;
    if (
      typeof questionId !== 'string' ||
      !id.test(questionId) ||
      !(answerId === null || (typeof answerId === 'string' && id.test(answerId)))
    )
      return reply.code(400).send({ error: 'Expected { questionId, answerId | null }' });
    const out = await acceptAnswer(store.transact, newId, {
      uid: viewer.uid,
      questionId,
      answerId: answerId as string | null,
    });
    if (!out.ok) {
      const [code, error] = {
        not_found: [404, 'That question is not available.'],
        not_owner: [403, 'Only the person who asked can accept an answer.'],
        not_answer: [400, 'That is not a published answer to this question.'],
      }[out.error] as [number, string];
      return reply.code(code).send({ error });
    }
    return out;
  });

  /**
   * Edit a post, or suggest an edit. The new text is redacted and reviewed like a new post: a
   * rejection is refused with the reason, an unsure verdict turns even the author's edit into a
   * suggestion for an editor.
   */
  app.post('/edits', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const path = b.path;
    const baseRevision = b.baseRevision;
    const comment = typeof b.comment === 'string' ? b.comment.trim() : '';
    const bodyText = typeof b.body === 'string' ? b.body.replace(/\r\n/g, '\n').trim() : '';
    const titleText = typeof b.title === 'string' ? b.title.trim() : undefined;
    if (typeof path !== 'string' || !POST_PATH.test(path))
      return reply.code(400).send({ error: 'Bad post path' });
    if (!Number.isInteger(baseRevision) || (baseRevision as number) < 0)
      return reply.code(400).send({ error: 'baseRevision must be the revision you edited' });
    if (bodyText.length < 10 || bodyText.length > 10_000)
      return reply.code(400).send({ error: 'The text must be 10–10,000 characters.' });
    if (titleText !== undefined && (titleText.length < 10 || titleText.length > 200))
      return reply.code(400).send({ error: 'The title must be 10–200 characters.' });
    if (!comment || comment.length > 300)
      return reply
        .code(400)
        .send({ error: 'Say briefly what you changed (up to 300 characters).' });
    if (overPostLimit(viewer.uid))
      return reply
        .code(429)
        .send({ error: 'You are editing quickly. Try again in a little while.' });

    const current = await store.transact(async (get) => ({ writes: [], result: await get(path) }));
    if (!current || current.status !== 'published')
      return reply.code(404).send({ error: 'That post is not available.' });
    const isQuestion = /^questions\/[^/]+$/.test(path);
    const title = redact(
      isQuestion ? (titleText ?? String(current.title ?? '')) : String(current.title ?? ''),
    );
    const body = redact(bodyText);
    const kind = isQuestion ? 'question' : 'answer';
    const { result, day } = await reviewWithBudget(req, {
      kind,
      title: title.text,
      body: body.text,
    });
    logReview(req, {
      path,
      uid: viewer.uid,
      kind,
      decision: result.decision,
      result,
      redacted: [...title.found, ...body.found],
      day,
    });
    if (result.decision === 'reject')
      return reply.code(422).send({
        status: 'rejected',
        reason: result.signals?.reason_for_author || 'This edit does not look like SDODS content.',
        notes: result.signals?.quality_notes ?? [],
      });

    await store.ensureUser({
      uid: viewer.uid,
      name: viewer.name,
      picture: viewer.picture,
      provider: viewer.provider,
    });
    const rep = await store.userRep(viewer.uid);
    const out = await editPost(store.transact, newId, {
      by: { uid: viewer.uid, name: viewer.name },
      direct: viewer.role !== 'member' || rep >= config.editRep,
      needsReview: result.decision === 'queue',
      path,
      baseRevision: baseRevision as number,
      change: { ...(isQuestion ? { title: title.text } : {}), body: body.text, comment },
    });
    if (!out.ok) {
      const [code, error] = {
        not_found: [404, 'That post is not available.'],
        conflict: [
          409,
          'Someone edited this while you were working. Reload to see their change, then edit again.',
        ],
        not_editable: [403, 'Replies can only be edited by the person who wrote them.'],
      }[out.error] as [number, string];
      return reply.code(code).send({ error });
    }
    return out.applied
      ? { status: 'applied', revision: out.revision }
      : {
          status: 'pending',
          id: out.suggestionId,
          reason:
            result.decision === 'queue'
              ? 'An editor will look at this edit before it appears.'
              : `Your edit is a suggestion until an editor approves it (direct editing needs ${config.editRep} reputation). Approved suggestions earn +2.`,
        };
  });

  app.get('/review/edits', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    if (!canModerate(viewer)) return reply.code(403).send({ error: 'Editors only.' });
    return { items: await store.pendingEdits() };
  });

  app.post('/review/edits/resolve', async (req, reply) => {
    const viewer = await viewerOf(req, reply);
    if (!viewer) return reply;
    if (!canModerate(viewer)) return reply.code(403).send({ error: 'Editors only.' });
    const { id, action, reason } = (req.body ?? {}) as Record<string, unknown>;
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (typeof id !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(id))
      return reply.code(400).send({ error: 'Bad suggestion id' });
    if (action !== 'approve' && action !== 'reject')
      return reply.code(400).send({ error: 'action must be approve or reject' });
    if (action === 'reject' && !why)
      return reply.code(400).send({ error: 'Say why, so the suggester knows what to change' });
    const out = await resolveEdit(store.transact, newId, {
      id,
      editor: viewer.uid,
      action,
      reason: why.slice(0, 500),
    });
    if (!out.ok)
      return reply.code(409).send({
        error:
          out.error === 'conflict'
            ? 'The post was edited after this suggestion was made; reject it and ask for a fresh one.'
            : 'That suggestion is no longer waiting for review.',
      });
    return out;
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
    await roleClaims?.(parsed.value.uid, parsed.value.role);
    await store.setRole(parsed.value.uid, parsed.value.role);
    req.log.info({ ...parsed.value, by: viewer.uid }, 'role set');
    return {
      ok: true,
      note: 'Takes effect when that user next signs in or their session refreshes (within an hour).',
    };
  });

  return app;
}
