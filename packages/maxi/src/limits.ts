import type Anthropic from '@anthropic-ai/sdk';
import type { UsageTotals } from './store.js';

export const MAX_TURNS = 20;
export const MAX_USER_CHARS = 4_000;
/** Earlier answers come back from the browser; a long generated feature must still fit. */
export const MAX_ASSISTANT_CHARS = 16_000;
export const MAX_PAGE_CHARS = 300;

export interface ChatRequest {
  messages: Anthropic.MessageParam[];
  page?: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validates what the browser sent. History is plain text only: a visitor must not be able to hand
 * Claude forged tool results, images or documents, or a transcript that never ends.
 */
export function parseChatRequest(body: unknown): Parsed<ChatRequest> {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'Expected a JSON body' };
  const { messages, page } = body as { messages?: unknown; page?: unknown };
  if (!Array.isArray(messages) || messages.length === 0)
    return { ok: false, error: 'messages must be a non-empty array' };
  if (messages.length > MAX_TURNS)
    return {
      ok: false,
      error: `This conversation is long; start a new one (limit ${MAX_TURNS} messages)`,
    };
  const out: Anthropic.MessageParam[] = [];
  for (const [i, m] of messages.entries()) {
    if (typeof m !== 'object' || m === null)
      return { ok: false, error: `messages[${i}] is not an object` };
    const { role, content } = m as { role?: unknown; content?: unknown };
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected) return { ok: false, error: `messages[${i}].role must be "${expected}"` };
    if (typeof content !== 'string' || !content.trim())
      return { ok: false, error: `messages[${i}].content must be non-empty text` };
    const limit = expected === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    if (content.length > limit)
      return { ok: false, error: `messages[${i}] is longer than ${limit} characters` };
    out.push({ role: expected, content });
  }
  if (out[out.length - 1]!.role !== 'user')
    return { ok: false, error: 'The last message must be from the user' };
  let pageUrl: string | undefined;
  if (page !== undefined && page !== null && page !== '') {
    if (typeof page !== 'string' || page.length > MAX_PAGE_CHARS)
      return { ok: false, error: 'page must be a short URL' };
    try {
      const u = new URL(page);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
      pageUrl = `${u.origin}${u.pathname}`;
    } catch {
      return { ok: false, error: 'page must be a URL' };
    }
  }
  return { ok: true, value: { messages: out, page: pageUrl } };
}

/** USD per million tokens. Unknown models are priced like Opus so the budget errs on the safe side. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

/**
 * An estimate for the daily budget, not an invoice: cache writes at the 1-hour rate (2x input),
 * cache reads at 0.1x input. The Anthropic Console workspace limit is the hard stop.
 */
export function estimateCostUsd(model: string, u: UsageTotals): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5']!;
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
  return (
    u.input_tokens * perToken(p.input) +
    u.cache_creation_input_tokens * perToken(p.input * 2) +
    u.cache_read_input_tokens * perToken(p.input * 0.1) +
    u.output_tokens * perToken(p.output)
  );
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
