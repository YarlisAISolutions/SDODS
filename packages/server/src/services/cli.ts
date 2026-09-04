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

/** Build the argv that runs the AutoMax CLI from source (tsx) or from dist. */
export function cliCommand(config: ServerConfig, args: string[]): { cmd: string; args: string[] } {
  const bin = config.cliBin;
  if (bin.endsWith('.ts'))
    return { cmd: process.execPath, args: ['--import', 'tsx', bin, ...args] };
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
  let data: T | null = null;
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

export { existsSync };
