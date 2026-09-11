import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { legacyRunFiles, runFiles } from '@sdods/contracts';

/**
 * Serves: the web app (SPA fallback), the HTML report per run, the trace viewer,
 * and nothing else. API artifacts go through /api/runs/:id/files and /api/artifacts.
 */
export default fp(async function staticPlugin(app: FastifyInstance) {
  // HTML reports: /reports/<runId>/... → .sdods/runs/<runId>/html-report/...
  await app.register(fastifyStatic, {
    root: app.config.artifactsDir,
    prefix: '/reports/',
    decorateReply: true,
    serve: false,
  });
  app.get('/reports/:runId/*', async (req, reply) => {
    const { runId, '*': rest } = req.params as { runId: string; '*': string };
    if (!/^[A-Za-z0-9._-]+$/.test(runId) || rest.includes('..'))
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid path' } });
    // Run directories outlive releases: fall back to the pre-rename directory name so reports
    // recorded by an older version keep resolving.
    const candidates = [runFiles.htmlReport, legacyRunFiles.htmlReport].map((dir) =>
      join(runId, dir, rest || 'index.html'),
    );
    const file = candidates.find((c) => existsSync(join(app.config.artifactsDir, c)));
    if (!file)
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
          message: 'Trace viewer assets not found.',
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
    // No bundle: the API is up but every UI route is unserved. Answer them all rather than only
    // `/`, because the first thing a first-run user opens is the /setup?token=... URL the server
    // itself just printed -- and a bare 404 there reads as a broken install rather than a missing
    // build step.
    const page = `<!doctype html><title>SDODS</title><body style="font-family:system-ui;padding:2rem;max-width:34rem"><h1>SDODS server</h1><p>The API is live at <code>/api/health</code>, but the web UI was not found in this install.</p><p>From a source checkout, build it once with <code>bun run web:build</code> and restart the server.</p><p>To create the first admin without the UI:<br><code>sdods users create --admin --username &lt;name&gt; --password &lt;pw&gt;</code></p></body>`;
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mcp'))
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
        });
      return reply.code(503).type('text/html; charset=utf-8').send(page);
    });
    app.get('/', async (_req, reply) =>
      reply.code(503).type('text/html; charset=utf-8').send(page),
    );
  }
});
