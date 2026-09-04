/**
 * Copies real output into public/screenshots/ so the docs show the product, not placeholders:
 *   - from the newest demo run that has per-step captures: scenario start/end and every
 *     before/after pair of one scenario (a regression run produces them), plus the dashboard
 *   - from packages/web/screenshots: the web UI pages rendered against the mock API
 * Runs before every docs build. Missing sources are not errors: existing images are kept.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const runsDir = process.env.SDODS_ARTIFACTS_DIR
  ? resolve(repoRoot, process.env.SDODS_ARTIFACTS_DIR)
  : join(repoRoot, '.sdods', 'runs');
const target = resolve(import.meta.dirname, '..', 'public', 'screenshots');
const uiTarget = join(target, 'ui');
mkdirSync(uiTarget, { recursive: true });

/** Scenarios that make a good narrative, in order of preference. */
const PREFERRED = [
  'Add a product to the cart',
  'Checkout form is reachable from the cart',
  'Login with the user',
];
const UI_PAGES = [
  'recorder',
  'dashboard',
  'workspaces',
  'run-detail',
  'scenario-steps',
  'feature-editor',
  'settings-mcp',
  'processes',
  'schedules',
];

interface Candidate {
  dir: string;
  name: string;
  pairs: Array<{ index: string; before: string; after: string }>;
  start?: string;
  end?: string;
}

function runsNewestFirst(): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .map((id) => ({ dir: join(runsDir, id), mtime: statSync(join(runsDir, id)).mtimeMs }))
    .filter((r) => existsSync(join(r.dir, 'run.json')))
    .sort((a, b) => b.mtime - a.mtime)
    .map((r) => r.dir);
}

function candidates(runDir: string): Candidate[] {
  const demo = join(runDir, 'demo-shop');
  if (!existsSync(demo)) return [];
  const out: Candidate[] = [];
  for (const fp of readdirSync(demo)) {
    const attempt = join(demo, fp, 'r0');
    if (!existsSync(attempt)) continue;
    const files = readdirSync(attempt);
    const pairs = files
      .filter((f) => /^\d{2}-before\.png$/.test(f))
      .map((f) => ({ index: f.slice(0, 2), before: f, after: f.replace('before', 'after') }))
      .filter((p) => files.includes(p.after))
      .sort((a, b) => a.index.localeCompare(b.index));
    if (!pairs.length) continue;
    let name = fp;
    try {
      name =
        (JSON.parse(readFileSync(join(attempt, 'meta.json'), 'utf8')) as { scenarioName?: string })
          .scenarioName ?? fp;
    } catch {
      /* keep fingerprint */
    }
    out.push({
      dir: attempt,
      name,
      pairs,
      start: files.includes('scenario-start.png') ? 'scenario-start.png' : undefined,
      end: files.includes('scenario-end.png') ? 'scenario-end.png' : undefined,
    });
  }
  return out;
}

const copied: string[] = [];
let chosenRun: string | null = null;
let chosen: Candidate | undefined;
for (const run of runsNewestFirst()) {
  const list = candidates(run);
  if (!list.length) continue;
  chosen =
    PREFERRED.map((p) => list.find((c) => c.name.startsWith(p))).find(Boolean) ??
    list.sort((a, b) => b.pairs.length - a.pairs.length)[0];
  chosenRun = run;
  break;
}

if (chosen && chosenRun) {
  if (chosen.start) {
    copyFileSync(join(chosen.dir, chosen.start), join(target, 'scenario-start.png'));
    copied.push('scenario-start.png');
  }
  if (chosen.end) {
    copyFileSync(join(chosen.dir, chosen.end), join(target, 'scenario-end.png'));
    copied.push('scenario-end.png');
  }
  chosen.pairs.forEach((p, i) => {
    const n = String(i + 1).padStart(2, '0');
    copyFileSync(join(chosen!.dir, p.before), join(target, `step-${n}-before.png`));
    copyFileSync(join(chosen!.dir, p.after), join(target, `step-${n}-after.png`));
    copied.push(`step-${n}-before.png`, `step-${n}-after.png`);
  });
  // Backwards-compatible names used by older pages.
  const first = chosen.pairs[0];
  if (first) {
    copyFileSync(join(chosen.dir, first.before), join(target, 'step-before.png'));
    copyFileSync(join(chosen.dir, first.after), join(target, 'step-after.png'));
  }
  const dashboard = join(chosenRun, 'dashboard', 'index.html');
  if (existsSync(dashboard)) {
    copyFileSync(dashboard, join(target, 'dashboard.html'));
    copied.push('dashboard.html');
  }
  console.log(
    `collect-screenshots — "${chosen.name}" from ${chosenRun}: ${chosen.pairs.length} step pair(s)`,
  );
} else {
  console.log('collect-screenshots — no run with per-step captures found; keeping existing images');
}

const webShots = join(repoRoot, 'packages', 'web', 'screenshots');
if (existsSync(webShots)) {
  for (const page of UI_PAGES) {
    const src = join(webShots, `${page}.png`);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(uiTarget, `${page}.png`));
    copied.push(`ui/${page}.png`);
  }
}

// Placeholders keep image links valid before the first demo run.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB/fwmzAAAADklEQVR4nGP4//8/AwMDAAf/Av5W1M1PAAAAAElFTkSuQmCC',
  'base64',
);
const placeholders: string[] = [];
for (const name of [
  'scenario-start.png',
  'scenario-end.png',
  'step-before.png',
  'step-after.png',
]) {
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
  JSON.stringify(
    {
      run: chosenRun,
      scenario: chosen?.name ?? null,
      steps: chosen?.pairs.length ?? 0,
      copied,
      placeholders,
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
