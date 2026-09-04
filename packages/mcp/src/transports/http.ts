import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { buildSdodsMcpServer, type BuildServerOptions } from '../server.js';
import type { Principal } from '../registry/registry.js';

export type Authenticate = (
  token: string | undefined,
  req: IncomingMessage,
) => Promise<Principal | null> | Principal | null;

export interface HttpTransportOptions extends Omit<BuildServerOptions, 'principal'> {
  /** Resolve a bearer token to a principal. Default denies everything. */
  authenticate?: Authenticate;
  /** idle session eviction (ms) */
  sessionIdleMs?: number;
  /** allowed Host header values (defaults to localhost variants); '*' disables the check */
  allowedHosts?: string[];
  path?: string;
}

interface Session {
  transport: NodeStreamableHTTPServerTransport;
  principalKey: string;
  lastSeen: number;
  close(): Promise<void>;
}

/**
 * Node request handler for the streamable-HTTP MCP endpoint. Mount it on any http server
 * (Fastify can pass raw req/res). Sessions are token-bound and evicted when idle.
 */
export function createMcpHttpHandler(opts: HttpTransportOptions = {}) {
  const sessions = new Map<string, Session>();
  const authenticate: Authenticate = opts.authenticate ?? (() => null);
  const idleMs = opts.sessionIdleMs ?? 30 * 60_000;
  const evict = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions)
      if (now - s.lastSeen > idleMs) void s.close().finally(() => sessions.delete(id));
  }, 60_000);
  evict.unref();

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined;
    const principal = await authenticate(token, req);
    if (!principal) {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="sdods"',
      });
      res.end(
        JSON.stringify({
          error: {
            code: 'AUTH_FAILED',
            message: 'A valid bearer token is required.',
            hint: 'Create one with `sdods tokens create` and pass Authorization: Bearer <token>.',
          },
        }),
      );
      return;
    }
    const principalKey = principal.userId ?? principal.name ?? token ?? 'anonymous';
    const sid = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sid) ? sid[0] : sid;
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (session && session.principalKey !== principalKey) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { code: 'AUTH_FAILED', message: 'Session belongs to another principal.' },
        }),
      );
      return;
    }
    if (!session) {
      if (req.method !== 'POST') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'INVALID_REQUEST',
              message: 'No session; send an initialize request first.',
            },
          }),
        );
        return;
      }
      const built = buildSdodsMcpServer({ ...opts, principal: { ...principal, via: 'http' } });
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          sessions.set(id, {
            transport,
            principalKey,
            lastSeen: Date.now(),
            close: () => built.server.close(),
          });
        },
      } as never);
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await built.server.connect(transport);
      session = {
        transport,
        principalKey,
        lastSeen: Date.now(),
        close: () => built.server.close(),
      };
    }
    session.lastSeen = Date.now();
    await session.transport.handleRequest(req, res, parsedBody);
  };

  return {
    handler,
    sessions,
    async close() {
      clearInterval(evict);
      for (const s of sessions.values()) await s.close().catch(() => undefined);
      sessions.clear();
    },
  };
}

/** Standalone HTTP server (`sdods mcp --http --port 4001`). */
export function serveSdodsHttp(
  opts: HttpTransportOptions & { port?: number; host?: string } = {},
): Promise<{ server: Server; port: number; close(): Promise<void> }> {
  const path = opts.path ?? '/mcp';
  const mcp = createMcpHttpHandler(opts);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: mcp.sessions.size }));
      return;
    }
    if (url.pathname !== path) {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Body is not JSON' } }),
          );
          return;
        }
      }
      mcp.handler(req, res, body).catch((e: Error) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL', message: e.message } }));
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 4001, opts.host ?? '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 4001);
      resolve({
        server,
        port,
        close: async () => {
          await mcp.close();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
