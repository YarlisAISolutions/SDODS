import type { FastifyInstance } from 'fastify';
import { migrationStatus } from '@sdods/db';
import { VERSION } from '@sdods/core';
import { SCOPES } from '@sdods/contracts';
import { cliCapabilitiesNow } from '../services/cli.js';

export async function miscRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    const status = await migrationStatus(app.adb).catch(() => null);
    // The CLI is a separate package that a workspace installs and upgrades on its own schedule,
    // so the dashboard has to know what the binary behind it can actually do. Read without
    // awaiting: health is polled while the server boots, and probing costs two processes.
    const cli = cliCapabilitiesNow(app.config);
    return {
      ok: true,
      version: VERSION,
      cli,
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
      const mcp = await import('@sdods/mcp');
      const built = mcp.buildSdodsMcpServer({ rootDir: app.config.rootDir, caps: 'all' });
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
        claudeCode: `claude mcp add --transport http sdods ${base}/mcp --header "Authorization: Bearer <token>"`,
        codex: `codex mcp add sdods --url ${base}/mcp --bearer-token-env-var SDODS_TOKEN`,
        gemini: `gemini mcp add --transport http --header "Authorization: Bearer <token>" sdods ${base}/mcp`,
        json: {
          mcpServers: {
            sdods: {
              type: 'http',
              url: `${base}/mcp`,
              headers: { Authorization: 'Bearer <token>' },
            },
          },
        },
        vscode: {
          servers: {
            sdods: {
              type: 'http',
              url: `${base}/mcp`,
              headers: { Authorization: 'Bearer ${input:sdods-token}' },
            },
          },
        },
        stdio: {
          mcpServers: {
            // `npx sdods` 404s on the registry; the bin belongs to @sdods/cli. `--cwd` pins the
            // workspace, which clients started outside it (Claude Desktop, user-level configs) need.
            sdods: {
              command: 'npx',
              args: ['-y', '@sdods/cli', '--cwd', app.config.rootDir, 'mcp'],
            },
          },
        },
      },
    };
  });
}
