/**
 * electron-builder beforePack hook: stage the Node runtime for the arch being packed.
 *
 * This exists because a missing `extraResources` source is only a *warning*. The first packaging
 * run built an x64 .dmg with no Node in it at all, exited 0, and said nothing louder than
 * "file source doesn't exist" in the middle of the log. An app that ships without its runtime
 * cannot start, so this hook makes that outcome impossible rather than merely unlikely.
 *
 * Runs once per (platform, arch) target, so each artifact gets the runtime it needs and nothing
 * else. Staging is idempotent, so repeat builds and CI caches cost nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// electron-builder passes Arch as a numeric enum.
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

export default async function beforePack(context) {
  const platform = context.electronPlatformName; // darwin | win32 | linux
  const arch = ARCH[context.arch] ?? String(context.arch);

  if (arch === 'universal') {
    // A universal build lipo-merges two packs, and both would want a different binary at
    // Contents/Resources/node/bin/node. Ship separate per-arch artifacts instead.
    throw new Error(
      'The universal macOS target is not supported: the bundled Node runtime differs per arch. ' +
        'Build arm64 and x64 as separate artifacts.',
    );
  }

  const root = join(import.meta.dirname, '..', 'resources', 'node');
  const dest = join(root, `${platform}-${arch}`);
  const exe = platform === 'win32' ? join(dest, 'node.exe') : join(dest, 'bin', 'node');

  if (!existsSync(exe)) {
    console.log(`  • staging Node runtime for ${platform}-${arch}`);
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(import.meta.dirname, 'fetch-node-runtime.ts'),
        '--platform',
        platform,
        '--arch',
        arch,
      ],
      { stdio: 'inherit', cwd: join(import.meta.dirname, '..') },
    );
  }

  if (!existsSync(exe)) {
    throw new Error(`Node runtime for ${platform}-${arch} is missing at ${exe} after staging.`);
  }
  console.log(`  • Node runtime ready for ${platform}-${arch}`);
}
