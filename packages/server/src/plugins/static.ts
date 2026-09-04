import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/**
 * Serves: the web app (SPA fallback), Playwright HTML reports per run, the trace viewer,
 * and nothing else. API artifacts go through /api/runs/:id/files and /api/artifacts.
 */
export default fp(async function staticPlugin(app: FastifyInstance) {
  // Playwright HTML reports: /reports/<runId>/... → .sdods/runs/<runId>/playwright-report/...
  await app.register(fastifyStatic, {
    root: app.config.artifactsDir,
    prefix: '/reports/',
    decorateReply: false,
    serve: false,
  });
  app.get('/reports/:runId/*', async (req, reply) => {
    const { runId, '*': rest } = req.params as { runId: string; '*': string };
    if (!/^[A-Za-z0-9._-]+$/.test(runId) || rest.includes('..'))
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid path' } });
    const file = join(runId, 'playwright-report', rest || 'index.html');
    if (!existsSync(join(app.config.artifactsDir, file)))
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Report not found' } });
    return reply.sendFile(file, app.config.artifactsDir);
  });

  if (app.config.traceViewerDir) {
    await app.register(fastifyStatic, {
      root: app.config.traceViewerDir,
      prefix: '/trace/',
      decorateReply: false,
    });
  } else {
    app.get('/trace/*', async (_req, reply) =>
      reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Trace viewer assets not found (playwright-core missing).',
        },
      }),
    );
  }

  if (app.config.webDist && existsSync(join(app.config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: app.config.webDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });
    const index = readFileSync(join(app.config.webDist, 'index.html'), 'utf8');
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mcp'))
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
        });
      return reply.type('text/html; charset=utf-8').send(index);
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><title>SDODS</title><body style="font-family:system-ui;padding:2rem"><h1>SDODS server</h1><p>The web UI is not built yet. API is live at <code>/api/health</code>. Build it with <code>bun run --filter @sdods/web build</code>.</p></body>`,
        ),
    );
  }
});
