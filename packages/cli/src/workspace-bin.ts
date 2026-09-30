import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * How to run a package's CLI from the workspace: `[node, <its bin script>]` when the package is
 * installed there, else `['npx', <bin>]`.
 *
 * `npx <bin>` only finds a tool through a `node_modules/.bin` shim. Some layouts have the package
 * but no shim npx recognises (bun on Windows writes `.bunx` shims), and npx then downloads an
 * unrelated registry package of the same name: `npx bddgen` fetched `bddgen@1.0.5` and every run
 * failed with "bddgen failed to generate specs". Resolving the package and running its bin with
 * this Node works in every layout.
 */
export function workspaceBin(rootDir: string, pkg: string, bin: string): [string, ...string[]] {
  try {
    const manifest = createRequire(join(rootDir, 'package.json')).resolve(`${pkg}/package.json`);
    const { bin: bins } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof bins === 'string' ? bins : bins?.[bin];
    if (rel) return [process.execPath, join(dirname(manifest), rel)];
  } catch {
    // not resolvable from here: fall back to npx
  }
  return ['npx', bin];
}
