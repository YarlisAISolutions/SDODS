import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { legacyRunFiles, runFiles } from '@sdods/contracts';

/**
 * `/reports/<run>/` serves html-report/ unsandboxed (the Playwright report needs localStorage), so
 * nothing uploaded may land there: a planted index.html would run with the viewer's session.
 */
const SERVER_ONLY_DIRS = new Set<string>([runFiles.htmlReport, legacyRunFiles.htmlReport]);

export interface ExtractResult {
  files: number;
  bytes: number;
  skipped: number;
}

export class ArchiveTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`artifacts archive exceeds ${maxBytes} bytes when extracted.`);
    this.name = 'ArchiveTooLargeError';
  }
}

/**
 * Extract an uploaded run archive (`artifacts.tgz`) into `dir`.
 *
 * Every entry is validated: only regular files and directories are accepted, paths must be
 * relative and resolve inside `dir` (no absolute paths, no `..`), symlinks and hard links are
 * skipped, and so is anything under html-report/. Once the accepted bytes pass `maxBytes`, remaining entries are dropped and
 * ArchiveTooLargeError is thrown after extraction (tar's filter cannot abort the stream).
 */
export async function extractArtifacts(
  archive: string,
  dir: string,
  maxBytes: number,
): Promise<ExtractResult> {
  const tar = await import('tar');
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  const result: ExtractResult = { files: 0, bytes: 0, skipped: 0 };
  let tooLarge = false;
  await tar.x({
    file: archive,
    cwd: root,
    strip: 0,
    preservePaths: false,
    filter: (path, entry) => {
      if (tooLarge) return false;
      const e = entry as { type?: string; size?: number };
      if (e.type !== 'File' && e.type !== 'Directory') {
        result.skipped++;
        return false;
      }
      const target = resolve(root, path);
      const segments = path.split(/[\\/]/).filter((p) => p && p !== '.');
      if (
        isAbsolute(path) ||
        segments.includes('..') ||
        SERVER_ONLY_DIRS.has(segments[0] ?? '') ||
        !(target === root || target.startsWith(root + sep))
      ) {
        result.skipped++;
        return false;
      }
      if (e.type === 'File') {
        const size = Number(e.size ?? 0);
        if (result.bytes + size > maxBytes) {
          tooLarge = true;
          return false;
        }
        result.files++;
        result.bytes += size;
      }
      return true;
    },
  });
  if (tooLarge) throw new ArchiveTooLargeError(maxBytes);
  return result;
}
