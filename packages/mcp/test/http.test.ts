import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { findRepoRoot } from '../src/cli.js';
import { serveAutomaxHttp } from '../src/transports/http.js';

describe('automax mcp (streamable HTTP)', () => {
  const root = findRepoRoot(process.cwd());
  let srv: Awaited<ReturnType<typeof serveAutomaxHttp>>;

  beforeAll(async () => {
    srv = await serveAutomaxHttp({
      rootDir: root,
      port: 0,
      caps: 'all',
      authenticate: (token) => {
        if (token === 'admin-token')
          return { name: 'admin', userId: 'u1', scopes: ['*'], via: 'http' };
        if (token === 'viewer-token')
          return {
            name: 'viewer',
            userId: 'u2',
            scopes: ['projects:read', 'runs:read', 'features:read'],
            via: 'http',
          };
        return null;
      },
    });
  });

  afterAll(async () => {
    await srv.close();
  });

  it('rejects requests without a valid bearer token', async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('AUTH_FAILED');
    const health = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
    expect((await health.json()).ok).toBe(true);
  });

  it('filters tools by the token scopes', async () => {
    const connect = async (token: string) => {
      const client = new Client({ name: 't', version: '0' });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${srv.port}/mcp`),
        { requestInit: { headers: { authorization: `Bearer ${token}` } } } as any,
      );
      await client.connect(transport);
      return client;
    };
    const admin = await connect('admin-token');
    const adminTools = (await admin.listTools()).tools.map((t) => t.name);
    expect(adminTools).toContain('proposal_accept');
    expect(adminTools).toContain('feature_write');
    const viewer = await connect('viewer-token');
    const viewerTools = (await viewer.listTools()).tools.map((t) => t.name);
    expect(viewerTools).toContain('project_list');
    expect(viewerTools).toContain('feature_read');
    expect(viewerTools).not.toContain('feature_write');
    expect(viewerTools).not.toContain('proposal_accept');
    expect(viewerTools).not.toContain('data_preview');
    const r = await viewer.callTool({ name: 'project_list', arguments: {} });
    expect(
      ((r.structuredContent as any).items as Array<{ slug: string }>).some(
        (p) => p.slug === 'demo-shop',
      ),
    ).toBe(true);
    await admin.close();
    await viewer.close();
  }, 60_000);
});
