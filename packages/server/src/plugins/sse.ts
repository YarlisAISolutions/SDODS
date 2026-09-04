import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SseEvent } from '../types.js';

/** `reply.sse(asyncIterable)` writes text/event-stream with a 15s heartbeat and closes when the source ends. */
export default fp(async function ssePlugin(app: FastifyInstance) {
  app.decorateReply('sse', function (this: FastifyReply, source: AsyncIterable<SseEvent>) {
    const raw = this.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write(':ok\n\n');
    const hb = setInterval(() => {
      if (!raw.writableEnded) raw.write(':hb\n\n');
    }, 15_000);
    hb.unref();
    const iterator = source[Symbol.asyncIterator]();
    let closed = false;
    const stop = () => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      void iterator.return?.(undefined);
      if (!raw.writableEnded) raw.end();
    };
    this.request.raw.on('close', stop);
    (async () => {
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done || closed) break;
          const lines = [`event: ${value.event}`];
          if (value.id !== undefined) lines.unshift(`id: ${value.id}`);
          lines.push(`data: ${JSON.stringify(value.data)}`);
          raw.write(lines.join('\n') + '\n\n');
        }
      } catch (e) {
        if (!raw.writableEnded)
          raw.write(`event: error\ndata: ${JSON.stringify({ message: (e as Error).message })}\n\n`);
      } finally {
        stop();
      }
    })();
    this.hijack();
    return this;
  });
});
