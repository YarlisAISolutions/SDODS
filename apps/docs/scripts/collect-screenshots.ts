/**
 * Copies screenshots from the most recent demo run into public/screenshots/ so the docs
 * show real output. Runs before every docs build; a missing run is not an error.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const runsDir = process.env.AUTOMAX_ARTIFACTS_DIR
  ? resolve(repoRoot, process.env.AUTOMAX_ARTIFACTS_DIR)
  : join(repoRoot, '.automax', 'runs');
const target = resolve(import.meta.dirname, '..', 'public', 'screenshots');
mkdirSync(target, { recursive: true });

function newestRun(): string | null {
  if (!existsSync(runsDir)) return null;
  const runs = readdirSync(runsDir)
    .map((id) => ({ id, dir: join(runsDir, id), mtime: statSync(join(runsDir, id)).mtimeMs }))
    .filter((r) => existsSync(join(r.dir, 'run.json')))
    .sort((a, b) => b.mtime - a.mtime);
  return runs[0]?.dir ?? null;
}

const run = newestRun();
const copied: string[] = [];
if (!run) {
  console.log('collect-screenshots — no run found under .automax/runs; keeping existing images');
} else {
  const demo = join(run, 'demo-shop');
  if (existsSync(demo)) {
    let picked = 0;
    for (const fp of readdirSync(demo)) {
      const attempt = join(demo, fp, 'r0');
      if (!existsSync(attempt)) continue;
      const files = readdirSync(attempt).filter((f) => f.endsWith('.png'));
      const start = files.find((f) => f === 'scenario-start.png');
      const before = files.find((f) => /^\d{2}-before\.png$/.test(f));
      const after = before ? before.replace('before', 'after') : undefined;
      if (start && picked === 0) {
        copyFileSync(join(attempt, start), join(target, 'scenario-start.png'));
        copied.push('scenario-start.png');
      }
      if (before && after && files.includes(after)) {
        copyFileSync(join(attempt, before), join(target, 'step-before.png'));
        copyFileSync(join(attempt, after), join(target, 'step-after.png'));
        copied.push('step-before.png', 'step-after.png');
        picked++;
        break;
      }
    }
  }
  const dashboard = join(run, 'dashboard', 'index.html');
  if (existsSync(dashboard)) {
    copyFileSync(dashboard, join(target, 'dashboard.html'));
    copied.push('dashboard.html');
  }
  console.log(
    `collect-screenshots — from ${run}: ${copied.length ? copied.join(', ') : 'nothing matched'}`,
  );
}
// Placeholders keep the site's image links valid before the first demo run.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB/fwmzAAAADklEQVR4nGP4//8/AwMDAAf/Av5W1M1PAAAAAElFTkSuQmCC',
  'base64',
);
const placeholders: string[] = [];
for (const name of ['scenario-start.png', 'step-before.png', 'step-after.png']) {
  const file = join(target, name);
  if (!existsSync(file)) {
    writeFileSync(file, PLACEHOLDER_PNG);
    placeholders.push(name);
  }
}
if (placeholders.length)
  console.log(`collect-screenshots — wrote placeholders for ${placeholders.join(', ')}`);
writeFileSync(
  join(target, 'manifest.json'),
  JSON.stringify({ run: run ?? null, copied, placeholders, at: new Date().toISOString() }, null, 2),
);
