import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ServerConfig } from '../config.js';

export interface CliResult<T = unknown> {
  ok: boolean;
  exitCode: number;
  data: T | null;
  stdout: string;
  stderr: string;
  error?: { code: string; message: string; hint?: string };
}

/** Build the argv that runs the SDODS CLI from source (tsx) or from dist. */
export function cliCommand(config: ServerConfig, args: string[]): { cmd: string; args: string[] } {
  const bin = config.cliBin;
  if (bin.endsWith('.ts'))
    return { cmd: process.execPath, args: ['--import', 'tsx', bin, ...args] };
  // The last-resort value is the bare command name, which has to be executed rather than handed
  // to node as a script path.
  if (!bin.includes('/') && !bin.includes('\\')) return { cmd: bin, args };
  return { cmd: process.execPath, args: [bin, ...args] };
}

export function spawnCli(
  config: ServerConfig,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): ChildProcess {
  const { cmd, args: argv } = cliCommand(config, args);
  return spawn(cmd, argv, {
    cwd: config.rootDir,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Run a CLI command with --json and parse its output. */
export async function runCliJson<T = unknown>(
  config: ServerConfig,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  timeoutMs = 120_000,
): Promise<CliResult<T>> {
  const child = spawnCli(config, ['--json', ...args], env);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
  child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
  const exitCode = await new Promise<number>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(1);
    });
  });
  let data: T | null;
  try {
    data = stdout.trim() ? (JSON.parse(stdout) as T) : null;
  } catch {
    data = null;
  }
  let error: CliResult['error'];
  if (exitCode !== 0) {
    try {
      const parsed = JSON.parse(stderr.trim().split('\n').filter(Boolean).pop() ?? '{}');
      error = parsed.error ?? { code: 'CLI_ERROR', message: stderr.trim() || `exit ${exitCode}` };
    } catch {
      error = { code: 'CLI_ERROR', message: stderr.trim() || stdout.trim() || `exit ${exitCode}` };
    }
  }
  return { ok: exitCode === 0, exitCode, data, stdout, stderr, error };
}

export interface CliCapabilities {
  /** version of the CLI the server actually spawns, which is not always this package's own */
  version: string | null;
  path: string;
  projectDelete: boolean;
  projectImport: boolean;
}

/** How long to wait before probing again after a probe that could not read the binary. */
const RETRY_AFTER_MS = 30_000;

let cached: CliCapabilities | null = null;
let inFlight: Promise<CliCapabilities | null> | null = null;
let retryAfter = 0;

/**
 * What the spawned CLI can do, if we already know.
 *
 * Non-blocking on purpose. `/api/health` is a liveness endpoint the desktop app polls every 400ms
 * while the server boots (apps/desktop/src/main/server.ts), and probing costs two CLI processes
 * that each pay tsx startup. Awaiting that would make every poll tick spawn a pair during exactly
 * the moment the machine is busiest -- and a probe that loses that race reports a capable binary
 * as incapable. So: answer with what is known, kick a probe off when nothing is, and let the next
 * caller have the result. `null` means "not known yet", which callers treat as permissive.
 */
export function cliCapabilitiesNow(config: ServerConfig): CliCapabilities | null {
  if (!cached && !inFlight && Date.now() >= retryAfter) void startProbe(config);
  return cached;
}

/** Waits for the answer. Prefer `cliCapabilitiesNow` on anything latency-sensitive. */
export async function cliCapabilities(config: ServerConfig): Promise<CliCapabilities | null> {
  if (cached) return cached;
  if (Date.now() < retryAfter) return null;
  return (inFlight ??= startProbe(config));
}

/** Test seam — the probe is cached for the process lifetime. */
export function resetCliCapabilities() {
  cached = null;
  inFlight = null;
  retryAfter = 0;
}

function startProbe(config: ServerConfig): Promise<CliCapabilities | null> {
  const run = probe(config)
    .then((c) => {
      // Never cache a failure as an answer, but do not retry it on every request either.
      if (c.version) cached = c;
      else retryAfter = Date.now() + RETRY_AFTER_MS;
      return c.version ? c : null;
    })
    .catch(() => {
      retryAfter = Date.now() + RETRY_AFTER_MS;
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

async function probe(config: ServerConfig): Promise<CliCapabilities> {
  const [version, help] = await Promise.all([
    runCliJson(config, ['--version'], {}, 20_000),
    runCliJson(config, ['project', '--help'], {}, 20_000),
  ]);
  const subcommands = help.ok ? help.stdout : '';
  // `project --help` lists every subcommand, so an empty read means the spawn failed rather than
  // that the commands are missing. Report it as unknown (null version) so it is retried.
  if (!subcommands.trim())
    return { version: null, path: config.cliBin, projectDelete: false, projectImport: false };
  return {
    version: version.stdout.trim().match(/\d+\.\d+\.\d+[^\s]*/)?.[0] ?? null,
    path: config.cliBin,
    projectDelete: /\bdelete\b/.test(subcommands),
    projectImport: /\bimport\b/.test(subcommands),
  };
}

export { existsSync };
