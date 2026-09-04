export interface PollOptions {
  timeoutMs: number;
  intervalMs?: number;
  description?: string;
}

/** Repeat `fn` until `predicate` passes or the timeout elapses; returns the last value. */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  opts: PollOptions,
): Promise<T> {
  const started = Date.now();
  const interval = opts.intervalMs ?? 1000;
  let last: T | undefined;
  let attempts = 0;
  while (Date.now() - started < opts.timeoutMs) {
    attempts++;
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `Polling ${opts.description ?? 'condition'} did not succeed within ${opts.timeoutMs} ms (${attempts} attempts). Last value: ${safe(last)}`,
  );
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v)?.slice(0, 500) ?? String(v);
  } catch {
    return String(v);
  }
}
