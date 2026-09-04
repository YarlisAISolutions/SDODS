#!/usr/bin/env node
// Published entry point. In the workspace, `bun run automax` uses tsx against src instead.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'bin.js');
if (existsSync(dist)) {
  await import(dist);
} else {
  // Workspace fallback: register tsx and run from source.
  const { register } = await import('tsx/esm/api');
  register();
  await import(join(here, '..', 'src', 'bin.ts'));
}
