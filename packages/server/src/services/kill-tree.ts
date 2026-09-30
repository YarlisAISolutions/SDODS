import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Stop a run's whole process tree, not just the CLI at its root.
 *
 * `sdods run` starts `npx playwright test`, which starts workers, which start browsers. Signalling
 * only the CLI leaves the rest running:
 *
 *   - Windows has no signals. `child.kill('SIGTERM')` is TerminateProcess on that one process, so
 *     the CLI's own SIGTERM handler never runs to pass the stop on. `taskkill /T /F` ends the tree.
 *   - macOS and Linux: the run is spawned in its own process group (`detached`), so signalling the
 *     negative pid reaches every descendant at once.
 *
 * Mirrors `killTree` in apps/desktop/src/main/runtime.ts, which does the same for the server itself.
 */
export function killTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  const pid = child.pid;
  if (child.exitCode != null) return;
  if (!pid) {
    // Never started, or not a real process (tests): signal what we have.
    child.kill(signal);
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      .on('error', () => child.kill())
      .unref();
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // Not a group leader (spawned without `detached`), or already gone.
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}
