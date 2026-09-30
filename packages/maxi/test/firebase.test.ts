import { describe, expect, it } from 'vitest';
import { FirestoreStore } from '../src/firebase/store.js';

// The Firebase adapter: these tests move to the private deployment package with ./src/firebase.

function recorder(responses: Response[]) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return responses.shift() ?? new Response('{}');
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const base = 'https://firestore.googleapis.com/v1/projects/p1/databases/(default)/documents';

describe('FirestoreStore', () => {
  it('increments the day counter atomically, creating the document on first use', async () => {
    const { impl, calls } = recorder([new Response('{}')]);
    const store = new FirestoreStore({ project: 'p1', fetch: impl, token: async () => 't' });
    await store.addSpend('2026-09-14', 0.25);
    expect(calls[0]!.url).toBe(`${base}:commit`);
    expect(calls[0]!.body).toEqual({
      writes: [
        {
          update: {
            name: 'projects/p1/databases/(default)/documents/maxiUsage/2026-09-14',
            fields: { day: { stringValue: '2026-09-14' } },
          },
          updateMask: { fieldPaths: ['day'] },
          updateTransforms: [
            { fieldPath: 'usd', increment: { doubleValue: 0.25 } },
            { fieldPath: 'requests', increment: { integerValue: '1' } },
          ],
        },
      ],
    });
  });

  it('reads spend, treating a missing day as zero', async () => {
    const { impl } = recorder([
      new Response('{}', { status: 404 }),
      new Response(JSON.stringify({ fields: { usd: { doubleValue: 3.5 } } })),
    ]);
    const store = new FirestoreStore({ project: 'p1', fetch: impl, token: async () => 't' });
    expect(await store.spentToday('2026-09-14')).toBe(0);
    expect(await store.spentToday('2026-09-14')).toBe(3.5);
  });

  it('saves an anonymous chat log and records a vote only on an existing conversation', async () => {
    const { impl, calls } = recorder([
      new Response('{}'),
      new Response('{}'),
      new Response('{}', { status: 404 }),
    ]);
    const store = new FirestoreStore({ project: 'p1', fetch: impl, token: async () => 't' });
    await store.saveChat({
      id: 'abc',
      question: 'How do I install?',
      answer: 'Run the installer.',
      turns: 2,
      model: 'claude-sonnet-5',
      corpusHash: 'h',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 3,
      },
      costUsd: 0.01,
    });
    expect(calls[0]!.url).toBe(`${base}/maxiChats?documentId=abc`);
    const fields = (calls[0]!.body as { fields: Record<string, unknown> }).fields;
    expect(Object.keys(fields).sort()).toEqual(
      [
        'answer',
        'corpusHash',
        'costUsd',
        'createdAt',
        'model',
        'question',
        'stopReason',
        'toolCalls',
        'turns',
        'usage',
      ].sort(),
    );
    expect(await store.vote('abc', 'up')).toBe(true);
    expect(calls[1]!.url).toContain('currentDocument.exists=true');
    expect(await store.vote('missing', 'down')).toBe(false);
  });
});
