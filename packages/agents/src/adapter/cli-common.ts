import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { ALL_CAPABILITIES, resolveCliInvocation } from '@sdods/mcp';
import { AgentsConfigError, type ExternalMcpServerConfig } from './types.js';

/** Where the sdods MCP server for a project comes from (same resolution as packages/mcp). */
export interface McpStdioSpec {
  command: string;
  args: string[];
}

export interface CliAdapterContext {
  rootDir?: string;
  project?: string;
  env?: string;
  /** injected for tests: binary name/path override */
  bin?: string;
  /**
   * Also attach Playwright's own MCP server (default false). Its browser_run_code_unsafe runs code
   * in the Node process with no scope check, so an agent steered by a page it visits could write
   * files anyway; the governed browser_* tools in the sdods server cover the same ground.
   */
  withPlaywrightMcp?: boolean;
}

/** Locate a binary on PATH (or an explicit path). Returns null when missing. */
export function findOnPath(bin: string): string | null {
  if (bin.includes('/')) return bin;
  const path = process.env.PATH ?? '';
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        const r = spawnSync('test', ['-x', candidate]);
        if (r.status === 0) return candidate;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/**
 * Capabilities the sdods MCP server gets when an agent CLI starts it: everything except `agents`,
 * which holds proposal_accept and proposal_reject. With `--caps all` a healer could write a
 * proposal and accept it in the same job, and no person would ever review the change.
 */
export const AGENT_MCP_CAPABILITIES = ALL_CAPABILITIES.filter((c) => c !== 'agents');

/** Tools an agent must never call, whatever the server was started with. */
export const REVIEW_ONLY_TOOLS = ['proposal_accept', 'proposal_reject'];

export function sdodsMcpServerSpec(ctx: CliAdapterContext): McpStdioSpec {
  const rootDir = ctx.rootDir ?? process.cwd();
  const inv = resolveCliInvocation(rootDir);
  const args = [...inv.args, 'mcp', '--caps', AGENT_MCP_CAPABILITIES.join(',')];
  if (ctx.project) args.push('--project', ctx.project);
  if (ctx.env) args.push('--env', ctx.env);
  return { command: inv.command, args };
}

export function playwrightMcpSpec(): McpStdioSpec {
  return { command: 'npx', args: ['playwright', 'mcp', '--headless'] };
}

/** Full MCP server map for a run: sdods + playwright + the project's external servers. */
export function mcpServerMap(
  ctx: CliAdapterContext,
  external: Record<string, ExternalMcpServerConfig> = {},
): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {
    sdods: { type: 'stdio', ...sdodsMcpServerSpec(ctx) },
  };
  if (ctx.withPlaywrightMcp === true)
    servers.playwright = { type: 'stdio', ...playwrightMcpSpec() };
  for (const [name, cfg] of Object.entries(external)) {
    if (cfg.transport === 'http' && cfg.url)
      servers[name] = { type: 'http', url: cfg.url, headers: cfg.headers ?? {} };
    else if (cfg.command)
      servers[name] = {
        type: 'stdio',
        command: cfg.command,
        args: cfg.args ?? [],
        env: cfg.env ?? {},
      };
  }
  return servers;
}

export function writeTempJson(prefix: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const file = join(dir, 'mcp.json');
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

export interface JsonlRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** called for every non-empty stdout line; JSON lines are parsed, others passed as strings */
  onLine: (line: unknown, raw: string) => void;
  /** feed this to stdin then close it (default: stdin ignored) */
  stdin?: string;
  timeoutMs?: number;
}

export interface JsonlRunResult {
  exitCode: number;
  stderr: string;
  signal?: NodeJS.Signals | null;
}

/** Spawn a CLI that emits one JSON object per stdout line and stream the lines back. */
export function runJsonl(
  command: string,
  args: string[],
  o: JsonlRunOptions,
): Promise<JsonlRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: o.cwd,
      env: { ...process.env, ...o.env },
      stdio: [o.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let buffer = '';
    const handleChunk = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        emit(raw);
      }
    };
    const emit = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('{') || line.startsWith('[')) {
        try {
          o.onLine(JSON.parse(line), raw);
          return;
        } catch {
          /* not JSON */
        }
      }
      o.onLine(raw, raw);
    };
    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    const timer = o.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), o.timeoutMs) : undefined;
    const onAbort = () => child.kill('SIGTERM');
    o.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      if (buffer.trim()) emit(buffer);
      resolve({ exitCode: code ?? (signal ? 130 : 1), stderr, signal });
    });
    if (o.stdin !== undefined && child.stdin) {
      child.stdin.end(o.stdin);
    }
  });
}

/** Resolve the binary or throw a clear configuration error with install/login hints. */
export function requireCli(bin: string, install: string): string {
  const found = findOnPath(bin);
  if (!found) {
    throw new AgentsConfigError(`The ${bin} CLI is not installed or not on PATH.`, install);
  }
  return found;
}

export function runQuiet(
  command: string,
  args: string[],
  timeoutMs = 15_000,
): { ok: boolean; stdout: string } {
  try {
    const r = spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs });
    return { ok: r.status === 0, stdout: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  } catch {
    return { ok: false, stdout: '' };
  }
}
