import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolRegistry } from './registry.js';
import { type SdodsTool, type ToolContext } from './registry.js';

/** Register every visible tool on an MCP v2 server. */
export function toMcpServer(reg: ToolRegistry, server: McpServer, ctx: ToolContext): number {
  let count = 0;
  for (const tool of reg.list(ctx)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.shape,
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint ?? tool.access === 'read',
          destructiveHint: tool.annotations?.destructiveHint ?? false,
          idempotentHint: tool.annotations?.idempotentHint ?? tool.access === 'read',
          openWorldHint: tool.annotations?.openWorldHint ?? false,
        },
        _meta: { access: tool.access, capability: tool.capability },
      },
      async (args: unknown, extra: unknown) => {
        const serverCtx = extra as
          | {
              signal?: AbortSignal;
              mcpReq?: { log?: (level: string, data: unknown) => Promise<void> };
            }
          | undefined;
        const callCtx: ToolContext = {
          ...ctx,
          signal: serverCtx?.signal ?? ctx.signal,
          onProgress: (p) => {
            ctx.onProgress?.(p);
            void serverCtx?.mcpReq
              ?.log?.('info', p.message ?? `${p.current ?? ''}/${p.total ?? ''}`)
              .catch(() => undefined);
          },
        };
        const result = await reg.call(tool.name, args, callCtx);
        return result as never;
      },
    );
    count++;
  }
  return count;
}

/** Plain tool definitions the agents package wraps with the Claude Agent SDK `tool()` helper. */
export interface AgentSdkToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    >;
    isError?: boolean;
  }>;
}

export function toAgentSdkTools(reg: ToolRegistry, ctx: ToolContext): AgentSdkToolDef[] {
  return reg.list(ctx).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.shape,
    annotations: { readOnlyHint: tool.access === 'read', destructiveHint: false },
    handler: async (args) => {
      const r = await reg.call(tool.name, args, ctx);
      const content = [...r.content];
      if (r.structuredContent)
        content.push({ type: 'text', text: JSON.stringify(r.structuredContent) });
      return { content, isError: r.isError };
    },
  }));
}

/** OpenAI-compatible function definitions (chat completions `tools`). */
export interface OpenAiFunctionDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export function toOpenAiFunctions(
  reg: ToolRegistry,
  ctx?: Pick<ToolContext, 'principal' | 'caps'>,
): OpenAiFunctionDef[] {
  const tools = ctx ? reg.list(ctx) : reg.all();
  return tools.map((tool: SdodsTool<any>) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(z.object(tool.shape)) as Record<string, unknown>,
    },
  }));
}

/** JSON schema view of a tool (used by docs generation and tests). */
export function toolJsonSchema(tool: SdodsTool<any>): Record<string, unknown> {
  return z.toJSONSchema(z.object(tool.shape)) as Record<string, unknown>;
}
