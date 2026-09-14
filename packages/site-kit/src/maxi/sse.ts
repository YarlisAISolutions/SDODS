/**
 * An incremental parser for `text/event-stream` bodies read with fetch. EventSource cannot send a
 * POST body, so the chat reads the stream itself and feeds chunks in as they arrive.
 */
export interface SseMessage {
  event: string;
  data: string;
}

export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = '';

  const dispatch = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) onMessage({ event, data: data.join('\n') });
  };

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\n\n');
      }
    },
    /** Flushes a final event that was not followed by a blank line. */
    end() {
      if (buffer.trim()) dispatch(buffer);
      buffer = '';
    },
  };
}
