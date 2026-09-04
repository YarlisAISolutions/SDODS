import { z, type ZodRawShape } from 'zod';
import { hasScope, isScope, scopeForToolAccess, type Scope } from '@sdods/contracts';

export const DOCS_BASE_URL = 'https://docs.sdods.com';

export type ToolAccess = 'read' | 'run' | 'write';
export type Capability = 'core' | 'analyze' | 'run' | 'data' | 'agents' | 'issues' | 'schedules';
export const ALL_CAPABILITIES: Capability[] = [
  'core',
  'analyze',
  'run',
  'data',
  'agents',
  'issues',
  'schedules',
];
export const DEFAULT_CAPABILITIES: Capability[] = ['core', 'analyze', 'run', 'data', 'schedules'];

export interface Principal {
  userId?: string;
  name?: string;
  scopes: string[];
  via: 'stdio' | 'http';
}

export interface ToolLogger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  debug(msg: string, data?: unknown): void;
}

export interface ToolContext {
  rootDir: string;
  cwd: string;
  principal: Principal;
  caps: Set<Capability>;
  /** default project/env when the client did not pass one */
  project?: string;
  env?: string;
  onProgress?: (progress: { message?: string; current?: number; total?: number }) => void;
  signal?: AbortSignal;
  logger: ToolLogger;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolResult {
  /** human readable summary (markdown) */
  text: string;
  /** machine readable payload */
  data?: unknown;
  isError?: boolean;
  /** optional images (base64 PNG) */
  images?: Array<{ data: string; mimeType: string }>;
}

export interface SdodsTool<S extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  description: string;
  shape: S;
  access: ToolAccess;
  /** scope domain: projects, features, runs, datasets, agents, integrations, schedules … */
  domain: string;
  capability: Capability;
  annotations?: ToolAnnotations;
  docsPath?: string;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface McpToolResultShape {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export function defineTool<S extends ZodRawShape>(tool: SdodsTool<S>): SdodsTool<S> {
  return tool;
}

export function requiredScope(tool: SdodsTool<any>): Scope | null {
  // agents has no read/write pair: run → agents:run, review/apply → agents:review
  if (tool.domain === 'agents') return tool.access === 'run' ? 'agents:run' : 'agents:review';
  return scopeForToolAccess(tool.access, tool.domain);
}

export class ToolRegistry {
  private readonly tools = new Map<string, SdodsTool<any>>();

  register<S extends ZodRawShape>(tool: SdodsTool<S>): this {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: Array<SdodsTool<any>>): this {
    for (const t of tools) this.register(t);
    return this;
  }

  get(name: string): SdodsTool<any> | undefined {
    return this.tools.get(name);
  }

  all(): SdodsTool<any>[] {
    return [...this.tools.values()];
  }

  /** Tools visible to a principal with the given capabilities (scope + capability gating). */
  list(ctx: Pick<ToolContext, 'principal' | 'caps'>): SdodsTool<any>[] {
    return this.all().filter((t) => this.isAllowed(t, ctx));
  }

  isAllowed(tool: SdodsTool<any>, ctx: Pick<ToolContext, 'principal' | 'caps'>): boolean {
    if (!ctx.caps.has(tool.capability)) return false;
    const scope = requiredScope(tool);
    if (!scope) return true;
    if (!isScope(scope)) return true;
    return hasScope(ctx.principal.scopes, scope);
  }

  async call(name: string, rawArgs: unknown, ctx: ToolContext): Promise<McpToolResultShape> {
    const tool = this.tools.get(name);
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`, { code: 'UNKNOWN_TOOL' });
    }
    if (!ctx.caps.has(tool.capability)) {
      return errorResult(
        `Tool ${name} requires capability "${tool.capability}" (start with --caps ${tool.capability}).`,
        {
          code: 'CAPABILITY_DISABLED',
        },
      );
    }
    const scope = requiredScope(tool);
    if (scope && isScope(scope) && !hasScope(ctx.principal.scopes, scope)) {
      return errorResult(`Insufficient scope: ${name} requires ${scope}.`, {
        code: 'INSUFFICIENT_SCOPE',
        scope,
      });
    }
    const parsed = z.object(tool.shape).safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return errorResult(
        `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`,
        {
          code: 'INVALID_ARGS',
          issues: parsed.error.issues,
        },
      );
    }
    try {
      const result = await tool.handler(parsed.data, ctx);
      return toMcpResult(tool, result);
    } catch (e) {
      const err = e as Error & { error?: { code?: string; hint?: string }; exitCode?: number };
      ctx.logger.warn(`tool ${name} failed`, { message: err.message });
      return errorResult(err.message, {
        code: err.error?.code ?? 'TOOL_FAILED',
        hint: err.error?.hint,
        exitCode: err.exitCode,
      });
    }
  }
}

export function toMcpResult(tool: SdodsTool<any>, result: ToolResult): McpToolResultShape {
  const content: McpToolResultShape['content'] = [{ type: 'text', text: result.text }];
  for (const img of result.images ?? [])
    content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  const structured = toStructured(result.data);
  return {
    content,
    ...(structured ? { structuredContent: structured } : {}),
    ...(result.isError ? { isError: true } : {}),
    _meta: {
      docsUrl: `${DOCS_BASE_URL}${tool.docsPath ?? '/docs/reference/mcp-tools'}#${tool.name.replace(/_/g, '-')}`,
      access: tool.access,
      capability: tool.capability,
    },
  };
}

function toStructured(data: unknown): Record<string, unknown> | undefined {
  if (data === undefined) return undefined;
  if (Array.isArray(data)) return { items: data };
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return { value: data };
}

export function errorResult(
  message: string,
  data: Record<string, unknown> = {},
): McpToolResultShape {
  const code = typeof data.code === 'string' ? data.code : 'TOOL_FAILED';
  return {
    content: [
      {
        type: 'text',
        text: `Error [${code}]: ${message}${data.hint ? `\nHint: ${String(data.hint)}` : ''}`,
      },
    ],
    structuredContent: { error: { message, ...data } },
    isError: true,
  };
}

/** Summarise a JSON payload for the text part of a result. */
export function summarize(title: string, data: unknown, max = 4000): string {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const clipped =
    body.length > max
      ? body.slice(0, max) + `\n… (${body.length - max} more chars in structuredContent)`
      : body;
  return `${title}\n\n\`\`\`json\n${clipped}\n\`\`\``;
}
