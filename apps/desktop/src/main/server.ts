/**
 * Supervises the `sdods serve` child process.
 *
 * The server binds 127.0.0.1 on a port this process chooses. It has to be chosen here rather than
 * discovered: `packages/server/src/config.ts` hardcodes 4444 with no collision handling, and
 * `startServer` formats its URL from the *configured* port without reporting what it actually
 * bound. The chosen port is persisted, because `sdods mcp install` writes the server URL into
 * .mcp.json — a fresh random port each launch would break every external MCP client and any
 * bookmark the user made.
 */
import { createServer } from 'node:net';
import type { ChildProcess } from 'node:child_process';
import { spawnNode } from './proc.js';
import { killTree } from './runtime.js';
import { workspacePaths } from './paths.js';

export interface ServerHandle {
  /** pid of the `sdods serve` child -- the process that can outlive the app. */
  pid: number | undefined;
  port: number;
  url: string;
  /** Present only on a genuinely first run: the token that authorises admin creation. */
  setupToken: string | null;
  stop: () => void;
}

export interface StartOptions {
  workspace: string;
  sessionSecret: string;
  /** Preferred port; a fresh one is chosen if it is taken. */
  port?: number;
  onLog?: (line: string) => void;
}

/** Ask the OS for a free port by binding zero and reading back the assignment. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/** True when nothing is listening on the port, i.e. we can take it. */
export function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/** Reuse the remembered port when we can, so URLs stay stable across launches. */
export async function resolvePort(preferred?: number): Promise<number> {
  if (preferred && (await portAvailable(preferred))) return preferred;
  return freePort();
}

export interface HealthPayload {
  ok: boolean;
  version: string;
  driver: string;
}

async function pollHealth(url: string, timeoutMs: number): Promise<HealthPayload | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return (await res.json()) as HealthPayload;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

export class ServerStartError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
    this.name = 'ServerStartError';
  }
}

/**
 * Start the server and resolve once `/api/health` answers.
 *
 * The scheduler is left enabled — a desktop user's schedules should fire while the app is open.
 */
export async function startServer(opts: StartOptions): Promise<ServerHandle> {
  const port = await resolvePort(opts.port);
  const url = `http://127.0.0.1:${port}`;
  const cliBin = workspacePaths(opts.workspace).cliBin;

  const child: ChildProcess = spawnNode(
    [cliBin, 'serve', '--port', String(port), '--host', '127.0.0.1'],
    { workspace: opts.workspace, sessionSecret: opts.sessionSecret, port },
  );

  let output = '';
  let setupToken: string | null = null;
  const capture = (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    // Keep the buffer bounded: this process can live for days.
    if (output.length > 64_000) output = output.slice(-32_000);
    // `serve` prints ".../setup?token=<hex>" on a first run, when the user table is empty. That
    // token is the only way to create the first admin without a terminal.
    setupToken ??= text.match(/setup\?token=([0-9a-f]{16,})/)?.[1] ?? null;
    for (const line of text.split('\n')) if (line.trim()) opts.onLog?.(line);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  let exited: number | null = null;
  child.on('exit', (code) => (exited = code ?? 1));

  const health = await pollHealth(url, 90_000);
  if (!health) {
    if (child.pid) killTree(child.pid);
    throw new ServerStartError(
      exited === null
        ? 'The SDODS server did not become ready in time.'
        : `The SDODS server exited with code ${exited}.`,
      output.trim().split('\n').slice(-25).join('\n'),
    );
  }

  return {
    pid: child.pid,
    port,
    url,
    setupToken,
    stop: () => {
      if (child.pid) killTree(child.pid);
    },
  };
}
