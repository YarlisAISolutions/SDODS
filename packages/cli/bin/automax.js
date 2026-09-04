#!/usr/bin/env node
// Published entry point. In the workspace, `bun run automax` uses tsx against src instead.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'bin.js');
const src = join(here, '..', 'src', 'bin.ts');
// Published install: only dist exists → run it. Workspace / `automax init --link` install: src is
// present and the workspace exports of @automax/* point at TypeScript, so always go through tsx
// (a stale `tsc -b` dist would otherwise import .ts files without a loader).
if (existsSync(dist) && !existsSync(src)) {
  await import(dist);
} else {
  const { register } = await import('tsx/esm/api');
  register();
  await import(src);
}
