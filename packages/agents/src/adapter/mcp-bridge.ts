import type { AgentSdkToolDef } from '@sdods/mcp';
import type { AgentEvent, ExternalMcpServerConfig } from './types.js';

/**
 * Lets an adapter that drives a chat endpoint itself use MCP servers.
 *
 * The Claude and CLI adapters hand `mcpServers` to something that already speaks MCP — the Agent
 * SDK, or the `claude`/`codex` binary. The chat-completions adapters had nowhere to hand them, so
 * they dropped them with a note, which quietly meant the planner, generator and healer ran without
 * a browser: they are the roles whose whole job is to look at the application. That was true of
 * every OpenAI-compatible provider, hosted or local, and it is the reason a local model could not
 * do the interesting half of the work.
 *
 * This connects the servers as a client, lists their tools, and presents them as ordinary function
 * definitions named `mcp__<server>__<tool>` — the same convention Claude Code uses, so prompts and
 * allowlists read the same everywhere.
 */

export interface BridgedTools {
  tools: AgentSdkToolDef[];
  close(): Promise<void>;
}

export interface BridgeOptions {
  servers?: Record<string, ExternalMcpServerConfig>;
  /** Adds `npx playwright mcp --headless`, the way the Claude adapter does for browser roles. */
  withPlaywright?: boolean;
  cwd?: string;
  onEvent?: (e: AgentEvent) => void;
}

/** Playwright's own MCP server, so a role that must look at the application can. */
const PLAYWRIGHT_SERVER: ExternalMcpServerConfig = {
  transport: 'stdio',
  command: 'npx',
  args: ['playwright', 'mcp', '--headless'],
};

export async function bridgeMcpServers(opts: BridgeOptions): Promise<BridgedTools> {
  const configured: Record<string, ExternalMcpServerConfig> = { ...(opts.servers ?? {}) };
  if (opts.withPlaywright && !configured.playwright) configured.playwright = PLAYWRIGHT_SERVER;
  const entries = Object.entries(configured);
  if (!entries.length) return { tools: [], close: async () => undefined };

  const { Client } = await import('@modelcontextprotocol/client');
  const closers: Array<() => Promise<void>> = [];
  const tools: AgentSdkToolDef[] = [];

  for (const [name, cfg] of entries) {
    try {
      const client = new Client({ name: 'sdods-agent', version: '0.1.0' });
      const transport = await transportFor(cfg, opts.cwd);
      await client.connect(transport);
      closers.push(() => client.close().catch(() => undefined));
      const listed = await client.listTools();
      const allowed = cfg.allowedTools?.length ? new Set(cfg.allowedTools) : undefined;
      for (const tool of listed.tools) {
        if (allowed && !allowed.has(tool.name)) continue;
        tools.push({
          name: `mcp__${name}__${tool.name}`,
          description: tool.description ?? `${name} ${tool.name}`,
          // The server already speaks JSON Schema; converting it to zod and back would only lose
          // detail, so it is passed through and used verbatim.
          inputSchema: {},
          parametersJsonSchema: (tool.inputSchema ?? {
            type: 'object',
            properties: {},
          }) as Record<string, unknown>,
          annotations: {
            readOnlyHint: tool.annotations?.readOnlyHint ?? false,
            destructiveHint: tool.annotations?.destructiveHint ?? false,
          },
          handler: async (args) => {
            const result = await client.callTool({ name: tool.name, arguments: args });
            const content = (result.content ?? []).map((c) =>
              c.type === 'text'
                ? { type: 'text' as const, text: c.text }
                : c.type === 'image'
                  ? { type: 'image' as const, data: c.data, mimeType: c.mimeType }
                  : { type: 'text' as const, text: `[${c.type}]` },
            );
            return { content, isError: Boolean(result.isError) };
          },
        });
      }
      opts.onEvent?.({
        type: 'status',
        message: `mcp: ${name} connected (${listed.tools.length} tool(s))`,
      });
    } catch (err) {
      // A server that will not start must not take the job with it: the model simply has fewer
      // tools, and the reason is on the record.
      opts.onEvent?.({
        type: 'status',
        message: `mcp: ${name} unavailable (${(err as Error).message})`,
      });
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(closers.map((c) => c()));
    },
  };
}

async function transportFor(cfg: ExternalMcpServerConfig, cwd?: string) {
  if (cfg.transport === 'http' || (!cfg.command && cfg.url)) {
    if (!cfg.url) throw new Error('an http MCP server needs a url');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    return new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
    });
  }
  if (!cfg.command) throw new Error('a stdio MCP server needs a command');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  return new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) },
    cwd,
    stderr: 'ignore',
  });
}
