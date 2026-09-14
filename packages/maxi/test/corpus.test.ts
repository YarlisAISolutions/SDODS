import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Corpus } from '../src/corpus.js';

function fakeFetch(responses: Array<Response | Error>) {
  const calls: RequestInit[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    const next = responses.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no more responses');
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Corpus', () => {
  it('loads from the URL and revalidates with the ETag', async () => {
    const { impl, calls } = fakeFetch([
      new Response('# Docs v1', { headers: { etag: '"v1"' } }),
      new Response(null, { status: 304 }),
      new Response('# Docs v2', { headers: { etag: '"v2"' } }),
    ]);
    const corpus = new Corpus({
      url: 'https://docs.example/llms-full.txt',
      refreshMs: 1000,
      fetch: impl,
    });
    await corpus.load();
    const first = corpus.current!;
    expect(first).toMatchObject({ text: '# Docs v1', source: 'url' });

    expect(await corpus.refresh()).toBe(true);
    expect((calls[1]!.headers as Record<string, string>)['if-none-match']).toBe('"v1"');
    expect(corpus.current).toBe(first);

    await corpus.refresh();
    expect(corpus.current!.text).toBe('# Docs v2');
    expect(corpus.current!.hash).not.toBe(first.hash);
  });

  it('keeps the last good copy when a refresh fails', async () => {
    const { impl } = fakeFetch([
      new Response('# Docs'),
      new Error('ECONNRESET'),
      new Response('', { status: 500 }),
    ]);
    const corpus = new Corpus({
      url: 'https://docs.example/llms-full.txt',
      refreshMs: 1000,
      fetch: impl,
    });
    await corpus.load();
    expect(await corpus.refresh()).toBe(false);
    expect(await corpus.refresh()).toBe(false);
    expect(corpus.current!.text).toBe('# Docs');
  });

  it('falls back to the local file when the URL is unreachable at start-up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maxi-corpus-'));
    const file = join(dir, 'llms-full.txt');
    writeFileSync(file, '# Baked docs');
    const { impl } = fakeFetch([new Error('offline')]);
    const corpus = new Corpus({
      url: 'https://docs.example/llms-full.txt',
      file,
      refreshMs: 1000,
      fetch: impl,
    });
    await corpus.load();
    expect(corpus.current).toMatchObject({ text: '# Baked docs', source: 'file' });
  });
});
