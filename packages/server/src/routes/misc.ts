import type { FastifyInstance } from 'fastify';
import { migrationStatus } from '@automax/db';
import { VERSION } from '@automax/core';
import { SCOPES } from '@automax/contracts';

export async function miscRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    const status = await migrationStatus(app.adb).catch(() => null);
    return {
      ok: true,
      version: VERSION,
      driver: app.adb.driver,
      migrations: status,
      runs: { active: app.runManager.list().filter((j) => j.status === 'running').length },
      uptimeSec: Math.round(process.uptime()),
    };
  });

  app.get('/api/mcp/info', async (req) => {
    const base = app.config.publicUrl ?? `${req.protocol}://${req.headers.host}`;
    let tools: Array<{ name: string; scope: string | null }> = [];
    try {
      const mcp = await import('@automax/mcp');
      const built = mcp.buildAutomaxMcpServer({ rootDir: app.config.rootDir, caps: 'all' });
      tools = built.registry
        .list(built.ctx)
        .map((t) => ({ name: t.name, scope: mcp.requiredScope(t) }));
    } catch {
      tools = [];
    }
    return {
      url: `${base}/mcp`,
      transport: 'streamable-http',
      version: VERSION,
      tools,
      scopes: SCOPES,
      snippets: {
        claudeCode: `claude mcp add --transport http automax ${base}/mcp --header "Authorization: Bearer <token>"`,
        json: {
          mcpServers: {
            automax: {
              type: 'http',
              url: `${base}/mcp`,
              headers: { Authorization: 'Bearer <token>' },
            },
          },
        },
        vscode: {
          servers: {
            automax: {
              type: 'http',
              url: `${base}/mcp`,
              headers: { Authorization: 'Bearer ${input:automax-token}' },
            },
          },
        },
        stdio: {
          mcpServers: {
            automax: { command: 'npx', args: ['automax', 'mcp'], cwd: app.config.rootDir },
          },
        },
      },
    };
  });
}
