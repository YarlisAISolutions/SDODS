/**
 * Spawning helpers shared by the bootstrap, server supervisor and updater.
 *
 * Everything the app runs goes through `<bundled node> <script>` — never a bare command name, and
 * never `shell: true`. Bare names fail on Windows (npm is `npm.cmd`) and in GUI-launched macOS
 * processes (minimal PATH); `shell: true` would make every path with a space a quoting hazard.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { buildChildEnv, nodeBin, npmCli, type ChildEnvOptions } from './runtime.js';
import { workspacePaths } from './paths.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type OnLine = (line: string, stream: 'stdout' | 'stderr') => void;

export interface RunOptions extends ChildEnvOptions {
  /** Streams each output line as it arrives, for progress UI. */
  onLine?: OnLine;
  timeoutMs?: number;
}

/** Split a chunked stream into lines without losing a trailing partial line between chunks. */
function lineReader(onLine: (line: string) => void) {
  let buffer = '';
  return {
    push(chunk: string) {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        onLine(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    },
    flush() {
      if (buffer.length) onLine(buffer);
      buffer = '';
    },
  };
}

/** Spawn a long-lived child. The caller owns its lifetime. */
export function spawnNode(args: string[], opts: RunOptions): ChildProcess {
  return spawn(nodeBin(), args, {
    cwd: opts.workspace,
    env: buildChildEnv(opts),
    stdio: ['ignore', 'pipe', 'pipe'],
    // A process group so the whole tree can be signalled on quit. Windows uses taskkill /T instead.
    detached: process.platform !== 'win32',
  });
}

/** Run a child to completion, capturing output and optionally streaming it line by line. */
export function runNode(args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawnNode(args, opts);
    let stdout = '';
    let stderr = '';

    const outReader = lineReader((l) => opts.onLine?.(l, 'stdout'));
    const errReader = lineReader((l) => opts.onLine?.(l, 'stderr'));

    child.stdout?.on('data', (c: Buffer) => {
      const s = c.toString();
      stdout += s;
      outReader.push(s);
    });
    child.stderr?.on('data', (c: Buffer) => {
      const s = c.toString();
      stderr += s;
      errReader.push(s);
    });

    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 30 * 60_000);
    const done = (code: number) => {
      clearTimeout(timer);
      outReader.flush();
      errReader.flush();
      resolve({ code, stdout, stderr });
    };
    child.on('exit', (code) => done(code ?? 1));
    child.on('error', (e) => {
      stderr += String(e);
      done(1);
    });
  });
}

/** Run npm against the workspace. `--no-audit --no-fund` keeps the progress output signal-dense. */
export function runNpm(args: string[], opts: RunOptions): Promise<RunResult> {
  return runNode([npmCli(), ...args, '--no-audit', '--no-fund', '--loglevel=info'], {
    ...opts,
    extraEnv: {
      // Playwright's postinstall would otherwise pull ~500 MB of browsers during the first-run
      // install; the app fetches them on demand instead. playwright@1.62 ships no install script,
      // but pin the behaviour so a future minor cannot reintroduce it.
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      ...opts.extraEnv,
    },
  });
}

/** Run the workspace's own `sdods` CLI. */
export function runSdods(args: string[], opts: RunOptions): Promise<RunResult> {
  return runNode([workspacePaths(opts.workspace).cliBin, ...args], opts);
}
