/**
 * Copies the installers from `installer/` into the public directory of every site that serves
 * them, with a `.sha256` next to each file so users can verify before piping into a shell.
 *
 * One source of truth: edit `installer/install.sh` and `installer/install.ps1` only.
 * Run automatically before `docs:build` and `www:build`; also available as `bun run installer:sync`.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'installer');
const files = ['install.sh', 'install.ps1'];
const targets = [join(repoRoot, 'apps/docs/public'), join(repoRoot, 'apps/www/public')];

let copied = 0;
for (const target of targets) {
  mkdirSync(target, { recursive: true });
  for (const file of files) {
    const from = join(sourceDir, file);
    const to = join(target, file);
    copyFileSync(from, to);
    const digest = createHash('sha256').update(readFileSync(from)).digest('hex');
    // Same shape as `sha256sum` output, so `sha256sum -c install.sh.sha256` works.
    writeFileSync(`${to}.sha256`, `${digest}  ${file}\n`);
    copied++;
  }
}

const digests = files.map(
  (f) =>
    `${f}: ${createHash('sha256')
      .update(readFileSync(join(sourceDir, f)))
      .digest('hex')}`,
);
console.log(`sync-installer — ${copied} file(s) into ${targets.length} site(s)`);
for (const d of digests) console.log(`  ${d}`);
