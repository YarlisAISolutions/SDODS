import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type McpClient = 'claude' | 'cursor' | 'vscode' | 'windsurf';

export interface SnippetOptions {
  project?: string;
  env?: string;
  caps?: string;
  /** when set, produce HTTP config instead of stdio */
  httpUrl?: string;
  tokenPlaceholder?: string;
  /** command used to start the stdio server */
  command?: string;
  args?: string[];
  withPlaywright?: boolean;
}

function stdioArgs(o: SnippetOptions): string[] {
  const args = [...(o.args ?? ['automax', 'mcp'])];
  if (o.project) args.push('--project', o.project);
  if (o.env) args.push('--env', o.env);
  if (o.caps) args.push('--caps', o.caps);
  return args;
}

export function serverEntry(o: SnippetOptions, client: McpClient): Record<string, unknown> {
  const token =
    o.tokenPlaceholder ?? (client === 'vscode' ? '${input:automax-token}' : '<YOUR_AUTOMAX_TOKEN>');
  if (o.httpUrl) {
    return client === 'vscode'
      ? { type: 'http', url: o.httpUrl, headers: { Authorization: `Bearer ${token}` } }
      : { type: 'http', url: o.httpUrl, headers: { Authorization: `Bearer ${token}` } };
  }
  return { command: o.command ?? 'npx', args: stdioArgs(o) };
}

export function playwrightEntry(): Record<string, unknown> {
  return { command: 'npx', args: ['playwright', 'mcp', '--headless'] };
}

export function snippets(
  o: SnippetOptions,
): Record<McpClient, { file: string; json: Record<string, unknown>; cli?: string }> {
  const pw = o.withPlaywright === false ? {} : { playwright: playwrightEntry() };
  const claudeCli = o.httpUrl
    ? `claude mcp add --transport http automax ${o.httpUrl} --header "Authorization: Bearer ${o.tokenPlaceholder ?? '$AUTOMAX_TOKEN'}"`
    : `claude mcp add automax -- npx ${stdioArgs(o).join(' ')}`;
  return {
    claude: {
      file: '.mcp.json',
      json: { mcpServers: { automax: serverEntry(o, 'claude'), ...pw } },
      cli: claudeCli,
    },
    cursor: {
      file: '.cursor/mcp.json',
      json: { mcpServers: { automax: serverEntry(o, 'cursor'), ...pw } },
    },
    windsurf: {
      file: '.windsurf/mcp.json',
      json: { mcpServers: { automax: serverEntry(o, 'windsurf'), ...pw } },
    },
    vscode: {
      file: '.vscode/mcp.json',
      json: {
        servers: { automax: serverEntry(o, 'vscode'), ...pw },
        ...(o.httpUrl
          ? {
              inputs: [
                {
                  id: 'automax-token',
                  type: 'promptString',
                  description: 'AutoMax API token',
                  password: true,
                },
              ],
            }
          : {}),
      },
    },
  };
}

/** Write (merge) the client config file; never clobbers other servers. */
export function installClientConfig(
  rootDir: string,
  client: McpClient,
  o: SnippetOptions,
): { file: string; merged: Record<string, unknown>; created: boolean } {
  const s = snippets(o)[client];
  const file = join(rootDir, s.file);
  const existing = existsSync(file) ? safeParse(readFileSync(file, 'utf8')) : {};
  const merged: Record<string, unknown> = { ...existing };
  const key = client === 'vscode' ? 'servers' : 'mcpServers';
  merged[key] = {
    ...((existing[key] as Record<string, unknown>) ?? {}),
    ...(s.json[key] as Record<string, unknown>),
  };
  if (client === 'vscode' && s.json.inputs) {
    const inputs = ((existing.inputs as Array<{ id: string }>) ?? []).filter(
      (i) => i.id !== 'automax-token',
    );
    merged.inputs = [...inputs, ...(s.json.inputs as unknown[])];
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return { file, merged, created: Object.keys(existing).length === 0 };
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
