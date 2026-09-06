/**
 * Main-process logging to stdout and a rotating file.
 *
 * This exists because the first end-to-end run of the supervisor failed completely silently: the
 * only error path went over IPC to the renderer, so a main-process failure before the window could
 * receive it left nothing at all to look at. A desktop app has no terminal by default, so the file
 * is the user's (and our) only evidence — "Open Logs Folder" in the menu points at it.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logsDir } from './paths.js';

const MAX_BYTES = 2 * 1024 * 1024;
let logFile: string | null = null;

function target(): string {
  if (!logFile) {
    const dir = logsDir();
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, 'desktop.log');
  }
  return logFile;
}

/** Keep one previous file. Enough to survive a crash-and-relaunch without unbounded growth. */
function rotateIfNeeded(file: string) {
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    /* missing file is fine */
  }
}

function write(level: string, args: unknown[]) {
  const line = `${new Date().toISOString()} [${level}] ${args
    .map((a) =>
      a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a),
    )
    .join(' ')}`;
  // stdout keeps `electron-vite dev` and CI runs readable.
  process.stdout.write(line + '\n');
  try {
    const file = target();
    rotateIfNeeded(file);
    appendFileSync(file, line + '\n');
  } catch {
    // Logging must never be the reason the app fails to start.
  }
}

export const log = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
  file: () => target(),
};
