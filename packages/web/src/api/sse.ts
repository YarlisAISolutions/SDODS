import { useEffect, useRef, useState } from 'react';

export interface SseMessage<T = unknown> {
  event: string;
  data: T;
  id?: string;
}

/**
 * EventSource hook with Last-Event-ID resume and exponential backoff.
 * `onMessage` receives every event; `events` accumulates them (capped).
 */
export function useSse<T = unknown>(
  url: string | null,
  opts: {
    enabled?: boolean;
    cap?: number;
    onMessage?: (m: SseMessage<T>) => void;
    eventNames?: string[];
  } = {},
) {
  const {
    enabled = true,
    cap = 5000,
    onMessage,
    eventNames = [
      'log',
      'status',
      'progress',
      'ingested',
      'done',
      'text',
      'tool',
      'diff',
      'error',
      'message',
    ],
  } = opts;
  const [events, setEvents] = useState<SseMessage<T>[]>([]);
  const [connected, setConnected] = useState(false);
  const lastId = useRef<string | null>(null);
  const cb = useRef(onMessage);
  cb.current = onMessage;

  useEffect(() => {
    if (!url || !enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    let backoff = 1000;
    const open = () => {
      const u = new URL(url, window.location.origin);
      if (lastId.current) u.searchParams.set('since', lastId.current);
      es = new EventSource(u.toString(), { withCredentials: true });
      es.onopen = () => {
        setConnected(true);
        backoff = 1000;
      };
      const handler = (name: string) => (e: MessageEvent) => {
        let data: T;
        try {
          data = JSON.parse(e.data) as T;
        } catch {
          data = e.data as T;
        }
        if (e.lastEventId) lastId.current = e.lastEventId;
        const msg: SseMessage<T> = { event: name, data, id: e.lastEventId || undefined };
        cb.current?.(msg);
        setEvents((prev) =>
          prev.length >= cap ? [...prev.slice(prev.length - cap + 1), msg] : [...prev, msg],
        );
        if (name === 'done') {
          closed = true;
          es?.close();
          setConnected(false);
        }
      };
      for (const n of eventNames) es.addEventListener(n, handler(n));
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (closed) return;
        setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
    };
  }, [url, enabled]);

  return { events, connected, clear: () => setEvents([]) };
}
