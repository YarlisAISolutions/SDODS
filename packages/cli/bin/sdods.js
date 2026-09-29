#!/usr/bin/env node
// Published entry point. In the workspace, `bun run sdods` uses tsx against src instead.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'bin.js');
const src = join(here, '..', 'src', 'bin.ts');
// Published install: only dist exists → run it. Workspace / `sdods init --link` install: src is
// present and the workspace exports of @sdods/* point at TypeScript, so always go through tsx
// (a stale `tsc -b` dist would otherwise import .ts files without a loader).
// import() takes a URL, not a path. A POSIX path happens to parse as one; on Windows `D:\...` reads
// as the scheme `d:` and Node refuses it, so every published install failed there before running.
if (existsSync(dist) && !existsSync(src)) {
  await import(pathToFileURL(dist).href);
} else {
  const { register } = await import('tsx/esm/api');
  register();
  await import(pathToFileURL(src).href);
}
