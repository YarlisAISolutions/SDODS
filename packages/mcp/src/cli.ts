import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CLI-first bridge: every MCP tool that needs AutoMax behaviour spawns the `automax` CLI
 * with `--json` and parses its output. This keeps the MCP package decoupled from in-flight
 * runtime code and guarantees tools and humans see the same results.
 */
export interface CliError {
  code: string;
  message: string;
  hint?: string;
  docsUrl?: string;
}

export class AutomaxCliError extends Error {
  constructor(
    readonly error: CliError,
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(error.message);
    this.name = 'AutomaxCliError';
  }
  get notSupported(): boolean {
    return this.error.code === 'NOT_SUPPORTED';
  }
}

export interface CliOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** receives each stdout line as it arrives (progress) */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  /** do not pass --json (for commands that stream human output) */
  raw?: boolean;
}

export interface CliResult<T = unknown> {
  json: T;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Resolve the repo root (contains automax.workspace.yaml or projects/) from a starting dir. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, 'automax.workspace.yaml')) ||
      (existsSync(join(dir, 'projects')) && existsSync(join(dir, 'package.json')))
    )
      return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

/** Locate the CLI entry: workspace source (tsx) or a published bin. */
export function resolveCliInvocation(rootDir: string): { command: string; args: string[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(rootDir, 'packages', 'cli', 'src', 'bin.ts'),
    resolve(here, '..', '..', 'cli', 'src', 'bin.ts'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { command: process.execPath, args: ['--import', 'tsx', c] };
  }
  const distBin = [
    join(rootDir, 'node_modules', '.bin', 'automax'),
    resolve(here, '..', '..', 'cli', 'bin', 'automax.js'),
  ];
  for (const c of distBin) {
    if (existsSync(c)) return { command: process.execPath, args: [c] };
  }
  return { command: 'automax', args: [] };
}

export async function automaxCli<T = unknown>(
  args: string[],
  opts: CliOptions = {},
): Promise<CliResult<T>> {
  const cwd = opts.cwd ?? findRepoRoot();
  const inv = resolveCliInvocation(cwd);
  const finalArgs = [...inv.args, ...(opts.raw ? [] : ['--json']), ...args];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(inv.command, finalArgs, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    let stdout = '';
    let stderr = '';
    let outBuf = '';
    let errBuf = '';
    const feed = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      if (!opts.onLine) return;
      let buf = (stream === 'stdout' ? outBuf : errBuf) + text;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      if (stream === 'stdout') outBuf = buf;
      else errBuf = buf;
      for (const l of lines) opts.onLine(l, stream);
    };
    child.stdout.on('data', (c: Buffer) => feed(c, 'stdout'));
    child.stderr.on('data', (c: Buffer) => feed(c, 'stderr'));
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs).unref()
      : undefined;
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(new AutomaxCliError(parseCliError(stderr, stdout, exitCode), exitCode, stderr));
        return;
      }
      resolvePromise({
        json: (opts.raw ? undefined : parseJsonOutput<T>(stdout)) as T,
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}

export function parseCliError(stderr: string, stdout: string, exitCode: number): CliError {
  for (const line of stderr.split('\n').reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(t) as { error?: CliError };
      if (parsed.error?.code) return parsed.error;
    } catch {
      /* keep looking */
    }
  }
  const plain = stderr.trim() || stdout.trim() || `automax exited with code ${exitCode}`;
  const m = /✖\s+([A-Z_]+):\s+(.*)/.exec(plain);
  if (m) return { code: m[1]!, message: m[2]! };
  return { code: exitCode === 2 ? 'CONFIG_INVALID' : 'RUN_FAILED', message: plain.split('\n')[0]! };
}

/** The CLI may print log lines before the JSON; take the last balanced JSON document. */
export function parseJsonOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through */
  }
  const starts = [trimmed.lastIndexOf('\n{'), trimmed.lastIndexOf('\n[')].filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) + 1 : -1;
  if (start >= 0) {
    try {
      return JSON.parse(trimmed.slice(start)) as T;
    } catch {
      /* fall through */
    }
  }
  return { raw: trimmed } as T;
}

/** Wrap a CLI call so that "not implemented yet" degrades into a note instead of an error. */
export async function cliOrNote<T>(
  args: string[],
  opts: CliOptions = {},
): Promise<T | { note: string }> {
  try {
    const r = await automaxCli<T>(args, opts);
    return r.json;
  } catch (e) {
    if (e instanceof AutomaxCliError && e.notSupported) {
      return { note: `command not available in this build: automax ${args.join(' ')}` };
    }
    throw e;
  }
}
