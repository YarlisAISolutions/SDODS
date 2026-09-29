import type Anthropic from '@anthropic-ai/sdk';
import type { Signals } from '../src/review.js';

export function signals(over: Partial<Signals> = {}): Signals {
  return {
    relevance: 'sdods',
    confidence: 0.95,
    spam: false,
    abuse: false,
    answers_the_question: true,
    quality_notes: [],
    reason_for_author: '',
    ...over,
  };
}

type Scripted = Signals | Error | { stop_reason: string };

/**
 * A stand-in for `client.messages` that answers `parse()` calls from a script, in order, and
 * records every request it was sent.
 */
export function fakeClient(script: Scripted[]) {
  const calls: Array<Record<string, unknown>> = [];
  const queue = [...script];
  const usage = {
    input_tokens: 900,
    output_tokens: 60,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 800,
  };
  const messages = {
    parse: async (params: Record<string, unknown>) => {
      calls.push(params);
      const next = queue.shift();
      if (!next) throw new Error('fakeClient: script exhausted');
      if (next instanceof Error) throw next;
      if ('stop_reason' in next && !('relevance' in next))
        return { stop_reason: next.stop_reason, parsed_output: null, usage, content: [] };
      return { stop_reason: 'end_turn', parsed_output: next, usage, content: [] };
    },
  };
  return {
    messages: messages as unknown as Anthropic['messages'],
    calls,
    get remaining() {
      return queue.length;
    },
  };
}
