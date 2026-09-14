import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

export type McpClient = 'claude' | 'codex' | 'cursor' | 'vscode' | 'windsurf' | 'gemini';
export const MCP_CLIENTS: McpClient[] = [
  'claude',
  'codex',
  'cursor',
  'vscode',
  'windsurf',
  'gemini',
];

/**
 * How a client launches the stdio server when no command is given. `npx sdods` only resolves inside
 * a checkout that has the bin in node_modules/.bin; everywhere else npx asks the registry, where no
 * package named `sdods` exists, and the client reports CONNECTION_CLOSED. Name the package that owns
 * the bin.
 */
export const STDIO_LAUNCH = ['-y', '@sdods/cli', 'mcp'];

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
  const args = [...(o.args ?? STDIO_LAUNCH)];
  if (o.project) args.push('--project', o.project);
  if (o.env) args.push('--env', o.env);
  if (o.caps) args.push('--caps', o.caps);
  return args;
}

export function serverEntry(o: SnippetOptions, client: McpClient): Record<string, unknown> {
  const token =
    o.tokenPlaceholder ?? (client === 'vscode' ? '${input:sdods-token}' : '<YOUR_SDODS_TOKEN>');
  if (o.httpUrl) {
    const headers = { Authorization: `Bearer ${token}` };
    // Windsurf names the remote URL `serverUrl`; Gemini CLI uses `httpUrl` for Streamable HTTP
    // (its `url` means SSE).
    if (client === 'windsurf') return { serverUrl: o.httpUrl, headers };
    if (client === 'gemini') return { httpUrl: o.httpUrl, headers };
    return { type: 'http', url: o.httpUrl, headers };
  }
  return { command: o.command ?? 'npx', args: stdioArgs(o) };
}

/**
 * The raw upstream browser server.
 *
 * No longer registered by default: SDODS now wraps every one of its tools as `browser_*`, bound to
 * a project and environment, with credential headers redacted and the two code-execution tools
 * behind a scope and a switch. Registering the raw server alongside would leave an ungoverned path
 * to the same browser, which is the thing the wrapper exists to close. Kept for
 * `--with-playwright`, for anyone who wants upstream directly and accepts that.
 */
export function playwrightEntry(): Record<string, unknown> {
  return { command: 'npx', args: ['playwright', 'mcp', '--headless'] };
}

/** `claude mcp add` / `codex mcp add` / `gemini mcp add` command lines for the same configuration. */
export function cliCommands(o: SnippetOptions): { claude: string; codex: string; gemini: string } {
  const stdio = `${o.command ?? 'npx'} ${stdioArgs(o).join(' ')}`;
  const token = o.tokenPlaceholder ?? '$SDODS_TOKEN';
  return {
    claude: o.httpUrl
      ? `claude mcp add --transport http sdods ${o.httpUrl} --header "Authorization: Bearer ${token}"`
      : `claude mcp add sdods -- ${stdio}`,
    codex: o.httpUrl
      ? `codex mcp add sdods --url ${o.httpUrl} --bearer-token-env-var SDODS_TOKEN`
      : `codex mcp add sdods -- ${stdio}`,
    gemini: o.httpUrl
      ? `gemini mcp add --transport http sdods ${o.httpUrl} --header "Authorization: Bearer ${token}"`
      : `gemini mcp add sdods ${stdio}`,
  };
}

/** Codex keeps MCP servers in `~/.codex/config.toml` under `[mcp_servers.<name>]`. */
export function codexTomlEntries(o: SnippetOptions): Record<string, Record<string, unknown>> {
  const sdods: Record<string, unknown> = o.httpUrl
    ? { url: o.httpUrl, bearer_token_env_var: 'SDODS_TOKEN' }
    : { command: o.command ?? 'npx', args: stdioArgs(o) };
  const out: Record<string, Record<string, unknown>> = { sdods };
  if (o.withPlaywright === true) out.playwright = playwrightEntry();
  return out;
}

/** Windsurf reads one user-level file; a `.windsurf/mcp.json` in the project is ignored. */
export function windsurfConfigPath(): string {
  return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
}

export function codexConfigPath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
}

export function snippets(
  o: SnippetOptions,
): Record<
  McpClient,
  { file: string; json?: Record<string, unknown>; toml?: string; cli?: string }
> {
  const pw = o.withPlaywright === true ? { playwright: playwrightEntry() } : {};
  const cli = cliCommands(o);
  return {
    claude: {
      file: '.mcp.json',
      json: { mcpServers: { sdods: serverEntry(o, 'claude'), ...pw } },
      cli: cli.claude,
    },
    codex: {
      file: codexConfigPath(),
      toml: stringifyToml({ mcp_servers: codexTomlEntries(o) }),
      cli: cli.codex,
    },
    cursor: {
      file: '.cursor/mcp.json',
      json: { mcpServers: { sdods: serverEntry(o, 'cursor'), ...pw } },
    },
    windsurf: {
      file: windsurfConfigPath(),
      json: { mcpServers: { sdods: serverEntry(o, 'windsurf'), ...pw } },
    },
    gemini: {
      file: '.gemini/settings.json',
      json: { mcpServers: { sdods: serverEntry(o, 'gemini'), ...pw } },
      cli: cli.gemini,
    },
    vscode: {
      file: '.vscode/mcp.json',
      json: {
        servers: { sdods: serverEntry(o, 'vscode'), ...pw },
        ...(o.httpUrl
          ? {
              inputs: [
                {
                  id: 'sdods-token',
                  type: 'promptString',
                  description: 'SDODS API token',
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
  if (client === 'codex') return installCodexConfig(o);
  const s = snippets(o)[client];
  const file = isAbsolute(s.file) ? s.file : join(rootDir, s.file);
  const existing = existsSync(file) ? safeParse(readFileSync(file, 'utf8')) : {};
  const merged: Record<string, unknown> = { ...existing };
  const key = client === 'vscode' ? 'servers' : 'mcpServers';
  merged[key] = {
    ...((existing[key] as Record<string, unknown>) ?? {}),
    ...((s.json?.[key] as Record<string, unknown>) ?? {}),
  };
  if (client === 'vscode' && s.json?.inputs) {
    const inputs = ((existing.inputs as Array<{ id: string }>) ?? []).filter(
      (i) => i.id !== 'sdods-token',
    );
    merged.inputs = [...inputs, ...(s.json.inputs as unknown[])];
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return { file, merged, created: Object.keys(existing).length === 0 };
}

/**
 * Merge `[mcp_servers.sdods]` (and playwright) into the Codex config, keeping every other
 * table and server intact. Used when the `codex` CLI is not available to do it itself.
 */
export function installCodexConfig(
  o: SnippetOptions,
  file = codexConfigPath(),
): { file: string; merged: Record<string, unknown>; created: boolean } {
  const existing = existsSync(file) ? safeParseToml(readFileSync(file, 'utf8')) : {};
  const servers = {
    ...((existing.mcp_servers as Record<string, unknown>) ?? {}),
    ...codexTomlEntries(o),
  };
  const merged: Record<string, unknown> = { ...existing, mcp_servers: servers };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringifyToml(merged) + '\n');
  return { file, merged, created: Object.keys(existing).length === 0 };
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeParseToml(text: string): Record<string, unknown> {
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
