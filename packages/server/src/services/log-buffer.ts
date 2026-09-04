import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';

export interface LogLine {
  seq: number;
  t: number;
  stream: 'out' | 'err' | 'sys';
  line: string;
}

/** Ring buffer with sequence numbers and live fan-out; optional append-only file mirror. */
export class LogBuffer {
  private readonly lines: LogLine[] = [];
  private seq = 0;
  readonly emitter = new EventEmitter();
  closed = false;

  constructor(
    private readonly capacity = 5000,
    private readonly filePath?: string,
  ) {
    this.emitter.setMaxListeners(100);
  }

  push(stream: LogLine['stream'], line: string): LogLine {
    const entry: LogLine = { seq: ++this.seq, t: Date.now(), stream, line };
    this.lines.push(entry);
    if (this.lines.length > this.capacity) this.lines.shift();
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${new Date(entry.t).toISOString()} [${stream}] ${line}\n`);
      } catch {
        /* ignore */
      }
    }
    this.emitter.emit('line', entry);
    return entry;
  }

  since(seq: number): LogLine[] {
    return this.lines.filter((l) => l.seq > seq);
  }

  close() {
    this.closed = true;
    this.emitter.emit('close');
  }

  /** Replay from `since` then stream live lines until closed. */
  async *stream(since = 0): AsyncGenerator<LogLine> {
    for (const l of this.since(since)) yield l;
    if (this.closed) return;
    const queue: LogLine[] = [];
    let resolveNext: (() => void) | null = null;
    let done = false;
    const onLine = (l: LogLine) => {
      queue.push(l);
      resolveNext?.();
    };
    const onClose = () => {
      done = true;
      resolveNext?.();
    };
    this.emitter.on('line', onLine);
    this.emitter.on('close', onClose);
    try {
      for (;;) {
        while (queue.length) yield queue.shift()!;
        if (done) return;
        await new Promise<void>((r) => (resolveNext = r));
        resolveNext = null;
      }
    } finally {
      this.emitter.off('line', onLine);
      this.emitter.off('close', onClose);
    }
  }
}
