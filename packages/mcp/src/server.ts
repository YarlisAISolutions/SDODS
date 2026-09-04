import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { cliOrNote } from './cli.js';
import { findRepoRoot } from './cli.js';
import { toMcpServer } from './registry/adapters.js';
import type { ToolRegistry } from './registry/registry.js';
import {
  ALL_CAPABILITIES,
  DEFAULT_CAPABILITIES,
  type Capability,
  type Principal,
  type ToolContext,
  type ToolLogger,
} from './registry/registry.js';
import { registerResources } from './resources.js';
import { ROLE_PROMPTS, renderPrompt, type RoleName } from './prompts/index.js';
import { createRegistry } from './tools/index.js';

export const MCP_SERVER_NAME = 'sdods';
export const MCP_SERVER_VERSION = '0.1.0';

export interface BuildServerOptions {
  rootDir?: string;
  cwd?: string;
  project?: string;
  env?: string;
  caps?: Array<Capability | string> | 'all';
  principal?: Principal;
  registry?: ToolRegistry;
  logger?: ToolLogger;
  onProgress?: ToolContext['onProgress'];
}

export function stderrLogger(prefix = 'sdods-mcp'): ToolLogger {
  const w = (level: string, msg: string, data?: unknown) => {
    if (process.env.SDODS_MCP_QUIET === '1' && level !== 'warn') return;
    process.stderr.write(
      `[${prefix}] ${level} ${msg}${data !== undefined ? ' ' + JSON.stringify(data) : ''}\n`,
    );
  };
  return {
    info: (m, d) => w('info', m, d),
    warn: (m, d) => w('warn', m, d),
    debug: (m, d) => (process.env.SDODS_DEBUG ? w('debug', m, d) : undefined),
  };
}

export function parseCaps(input?: Array<Capability | string> | string | 'all'): Set<Capability> {
  if (input === 'all') return new Set(ALL_CAPABILITIES);
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : DEFAULT_CAPABILITIES;
  const caps = new Set<Capability>();
  for (const raw of list) {
    const c = String(raw).trim() as Capability;
    if (c === ('all' as Capability)) return new Set(ALL_CAPABILITIES);
    if (!c) continue;
    if (!ALL_CAPABILITIES.includes(c))
      throw new Error(`Unknown capability "${c}". Known: ${ALL_CAPABILITIES.join(', ')}`);
    caps.add(c);
  }
  return caps;
}

export const LOCAL_ADMIN: Principal = { name: 'local', scopes: ['*'], via: 'stdio' };

export function buildToolContext(opts: BuildServerOptions = {}): ToolContext {
  const rootDir = opts.rootDir ?? findRepoRoot(opts.cwd ?? process.cwd());
  const principal = opts.principal ?? LOCAL_ADMIN;
  return {
    rootDir,
    cwd: opts.cwd ?? rootDir,
    principal: principal.scopes.includes('*') ? { ...principal, scopes: allScopes() } : principal,
    caps: parseCaps(opts.caps),
    project: opts.project,
    env: opts.env,
    onProgress: opts.onProgress,
    logger: opts.logger ?? stderrLogger(),
  };
}

function allScopes(): string[] {
  // lazy import to avoid a static dependency on the scope list shape
  return [
    'orgs:read',
    'orgs:admin',
    'workspaces:read',
    'workspaces:write',
    'projects:read',
    'projects:write',
    'envs:read',
    'envs:write',
    'datasets:read',
    'datasets:write',
    'runs:read',
    'runs:write',
    'runs:ingest',
    'artifacts:read',
    'features:read',
    'features:write',
    'agents:run',
    'agents:review',
    'integrations:read',
    'integrations:write',
    'schedules:read',
    'schedules:write',
    'processes:read',
    'processes:write',
    'users:admin',
    'audit:read',
  ];
}

/** Build a fully wired MCP server (tools + resources + prompts) for a context. */
export function buildSdodsMcpServer(opts: BuildServerOptions = {}): {
  server: McpServer;
  ctx: ToolContext;
  registry: ToolRegistry;
  toolCount: number;
} {
  const ctx = buildToolContext(opts);
  const registry = opts.registry ?? createRegistry();
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      instructions:
        'SDODS is an automation platform with a reusable architecture built on Playwright. Tools are grouped by prefix: project_*, workspace_*, process_*, feature_*, step_*, run_*, heal_*, data_*, analyze_*, issue_*, schedule_*, proposal_*. Write tools only create proposals; nothing touches the working tree until a person accepts. Start with project_list, then feature_list / step_list before writing scenarios.',
    },
  );
  const toolCount = toMcpServer(registry, server, ctx);
  registerResources(server, ctx);
  registerPrompts(server, ctx);
  return { server, ctx, registry, toolCount };
}

export function registerPrompts(server: McpServer, ctx: ToolContext): void {
  for (const role of Object.keys(ROLE_PROMPTS) as RoleName[]) {
    const p = ROLE_PROMPTS[role];
    server.registerPrompt(
      `sdods-${role === 'planner' ? 'plan' : role === 'generator' ? 'generate' : role === 'healer' ? 'heal' : role === 'upgrader' ? 'upgrade' : 'review'}`,
      {
        title: p.title,
        description: p.description,
        argsSchema: z.object({
          project: z.string().optional().describe('project slug'),
          env: z.string().optional(),
          goal: z.string().optional().describe('what to plan/generate/heal/upgrade/review'),
        }),
      },
      async (args) => {
        const project = args.project ?? ctx.project;
        let steps: string[] | undefined;
        if (project) {
          const data = await cliOrNote<Array<{ pattern?: string; keyword?: string }>>(
            ['steps', 'list', '-p', project],
            { cwd: ctx.rootDir, timeoutMs: 120_000 },
          ).catch(() => undefined);
          if (Array.isArray(data))
            steps = data.map((s) => `${s.keyword ?? ''} ${s.pattern ?? ''}`.trim());
        }
        return {
          description: p.description,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: renderPrompt(role, {
                  project,
                  env: args.env ?? ctx.env,
                  goal: args.goal,
                  steps,
                }),
              },
            },
          ],
        };
      },
    );
  }
}
