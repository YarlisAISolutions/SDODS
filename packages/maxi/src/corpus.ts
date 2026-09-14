import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface CorpusSnapshot {
  text: string;
  /** Short content hash, logged with each conversation so an answer can be traced to its docs. */
  hash: string;
  source: 'url' | 'file';
  loadedAt: Date;
}

export interface CorpusOptions {
  url: string;
  file?: string;
  refreshMs: number;
  fetch?: typeof fetch;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

/**
 * The published docs bundle (docs.sdods.com/llms-full.txt), kept fresh without a redeploy.
 *
 * A docs deploy changes the file; the next refresh sees a new ETag and swaps the text in. A failed
 * refresh keeps the last good copy, so an outage on the docs site never takes Maxi down with it.
 */
export class Corpus {
  private snapshot: CorpusSnapshot | undefined;
  private etag: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: CorpusOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  get current(): CorpusSnapshot | undefined {
    return this.snapshot;
  }

  /** Loads from the URL, falling back to the local file. Resolves either way. */
  async load(): Promise<void> {
    if (await this.refresh()) return;
    if (this.snapshot || !this.opts.file) return;
    try {
      const text = await readFile(this.opts.file, 'utf8');
      this.snapshot = { text, hash: hashOf(text), source: 'file', loadedAt: new Date() };
      this.opts.log?.('corpus loaded from file', {
        file: this.opts.file,
        hash: this.snapshot.hash,
      });
    } catch (e) {
      this.opts.log?.('corpus file unreadable', { error: (e as Error).message });
    }
  }

  /** Returns true when the URL answered with a usable body (200 or 304). */
  async refresh(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.opts.url, {
        headers: this.etag ? { 'if-none-match': this.etag } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 304 && this.snapshot) return true;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('empty body');
      this.etag = res.headers.get('etag') ?? undefined;
      const hash = hashOf(text);
      if (hash !== this.snapshot?.hash) {
        this.snapshot = { text, hash, source: 'url', loadedAt: new Date() };
        this.opts.log?.('corpus updated', { hash, bytes: text.length });
      }
      return true;
    } catch (e) {
      this.opts.log?.('corpus refresh failed', { url: this.opts.url, error: (e as Error).message });
      return false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
