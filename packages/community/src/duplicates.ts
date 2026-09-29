/**
 * "Has this been asked before?" from the site's own search index.
 *
 * The index is the file the questions page already fetches (`/questions/search-index.json`), so
 * suggestions come from exactly what a visitor could have found by searching. Matching is word
 * overlap on titles and excerpts: cheap, deterministic, and good enough to point at the thread an
 * error message has already been answered in. It is never a reason to reject a post.
 */

export interface IndexedThread {
  slug: string;
  title: string;
}

interface IndexFile {
  items?: Array<{ s?: unknown; t?: unknown; x?: unknown }>;
}

const STOP = new Set(
  'a an and are as at be but by can do does for from get how i if in is it its my no not of on or so that the this to up was what when where which why with you your sdods'.split(
    ' ',
  ),
);

export function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9@.-]+/g, ' ')
      .split(' ')
      .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  // Dice coefficient: symmetric, and kinder to a short title than Jaccard.
  return (2 * shared) / (a.size + b.size);
}

export class ThreadIndex {
  private threads: Array<IndexedThread & { words: Set<string> }> = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly opts: {
      url: string;
      refreshMs: number;
      fetch?: typeof fetch;
      log?: (msg: string, extra?: Record<string, unknown>) => void;
    },
  ) {}

  /** Replaces the index. Exposed for tests and for a local file in development. */
  set(items: Array<{ slug: string; title: string; excerpt?: string }>): void {
    this.threads = items.map((i) => ({
      slug: i.slug,
      title: i.title,
      words: words(`${i.title} ${i.title} ${i.excerpt ?? ''}`),
    }));
  }

  get size(): number {
    return this.threads.length;
  }

  title(slug: string): string | null {
    return this.threads.find((t) => t.slug === slug)?.title ?? null;
  }

  async load(): Promise<void> {
    try {
      const res = await (this.opts.fetch ?? fetch)(this.opts.url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as IndexFile;
      const items = (body.items ?? []).flatMap((r) =>
        typeof r.s === 'string' && typeof r.t === 'string'
          ? [{ slug: r.s, title: r.t, excerpt: typeof r.x === 'string' ? r.x : '' }]
          : [],
      );
      if (items.length) this.set(items);
      this.opts.log?.('search index loaded', { threads: items.length });
    } catch (e) {
      // Keep the last good copy: suggestions are a nicety, never a reason to fail a post.
      this.opts.log?.('search index load failed', { error: String(e) });
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.load(), this.opts.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Up to `limit` threads that look like the same question, best first. */
  similar(title: string, body: string, limit = 3, min = 0.34): IndexedThread[] {
    const q = words(`${title} ${title} ${body.slice(0, 500)}`);
    return this.threads
      .map((t) => ({ t, score: overlap(q, t.words) }))
      .filter((x) => x.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ t }) => ({ slug: t.slug, title: t.title }));
  }
}
