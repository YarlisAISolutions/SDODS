import fp from 'fastify-plugin';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { resolveApiToken } from '@automax/db';

/**
 * Mounts the AutoMax MCP streamable-HTTP endpoint at /mcp using the transport from @automax/mcp.
 * Bearer API tokens only (sessions are not accepted: MCP clients must use tokens).
 */
export default fp(async function mcpPlugin(app: FastifyInstance) {
  let handler:
    ((req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void>) | null = null;
  let close: (() => Promise<void>) | null = null;
  try {
    const mcp = await import('@automax/mcp');
    const created = mcp.createMcpHttpHandler({
      rootDir: app.config.rootDir,
      caps: 'all',
      authenticate: async (token) => {
        if (app.config.authDisabled) return { name: 'local', scopes: ['*'], via: 'http' as const };
        if (!token) return null;
        const t = await resolveApiToken(app.adb.db, token);
        if (!t) return null;
        return { userId: t.userId, name: t.username, scopes: t.scopes, via: 'http' as const };
      },
      allowedHosts: app.config.allowedHosts,
    });
    handler = created.handler;
    close = created.close;
  } catch (e) {
    app.log.warn(`MCP over HTTP unavailable: ${(e as Error).message}`);
  }

  // Raw body: the MCP transport parses JSON itself.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    if (req.url.startsWith('/mcp')) return done(null, body);
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (req, reply) => {
      if (!handler)
        return reply.code(503).send({
          error: { code: 'NOT_SUPPORTED', message: 'MCP transport not available in this build.' },
        });
      const raw = req.body as Buffer | undefined;
      let parsed: unknown;
      if (raw && raw.length) {
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          return reply
            .code(400)
            .send({ error: { code: 'BAD_REQUEST', message: 'Body is not JSON' } });
        }
      }
      reply.hijack();
      await handler(req.raw, reply.raw, parsed);
    },
  });

  app.addHook('onClose', async () => {
    await close?.();
  });
});
