/**
 * Turns real command output into the cropped terminal images used by the getting-started pages
 * and the workshop.
 *
 * Every image on those pages must be something the reader can reproduce, so this script runs the
 * command itself (NO_COLOR, fixed width), keeps only the lines worth showing, renders them in a
 * terminal card and screenshots that card in headless chromium. The screenshot is taken of the
 * card element, so the PNG is cropped to the output and nothing else — no desktop, no padding,
 * no editing by hand.
 *
 * Usage:
 *   node --import tsx apps/docs/scripts/capture-cli-shots.ts            # every shot
 *   node --import tsx apps/docs/scripts/capture-cli-shots.ts onboard    # one group
 *
 * Shots whose command needs something that is not there (the workshop app, a running server) are
 * skipped with a note rather than failing the run, so a partial refresh is always possible.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const outDir = join(here, '..', 'public', 'screenshots', 'cli');
/** The workshop clones the application next to the SDODS checkout. */
const workshopApp =
  process.env.SDODS_WORKSHOP_APP ?? resolve(repoRoot, '..', 'cypress-realworld-app');

interface Shot {
  /** File name without extension, and the key in the manifest. */
  name: string;
  /** Group, so a single area can be refreshed on its own. */
  group: 'install' | 'onboard' | 'workshop';
  /** What the reader types. Shown verbatim in the image header. */
  display: string;
  /** What is actually run. Defaults to `display` split on spaces. */
  argv?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Keep the first N lines of output. */
  head?: number;
  /** Keep from the first line matching this pattern. */
  from?: RegExp;
  /** Stop before the first line matching this pattern. */
  until?: RegExp;
  /** Drop lines matching this pattern (progress spinners, absolute paths). */
  drop?: RegExp;
  /** Skip when this path is missing. */
  needs?: string;
  /** Terminal width in characters; the card is sized from it. */
  columns?: number;
  /** Wrap long lines instead of letting them run off the card. */
  wrap?: boolean;
  /** Cosmetic line rewrites: collapse run ids and generated paths so a line fits a page. */
  rewrite?: Array<[RegExp, string]>;
}

const sdods = (args: string) => [
  'node',
  '--import',
  'tsx',
  'packages/cli/src/bin.ts',
  ...args.split(' '),
];

const SHOTS: Shot[] = [
  {
    name: 'doctor',
    group: 'install',
    display: 'sdods doctor',
    argv: sdods('doctor'),
    until: /^Tokens and keys/,
    columns: 92,
    head: 16,
  },
  {
    name: 'install-dry-run',
    group: 'install',
    display: 'sh install.sh --dry-run --browsers chromium',
    argv: ['sh', 'apps/www/public/install.sh', '--dry-run', '--browsers', 'chromium'],
    env: { SDODS_YES: '1' },
    until: /^SDODS is ready/,
    columns: 104,
    head: 14,
  },
  {
    name: 'version-check',
    group: 'install',
    display: 'sh install.sh --version-check',
    argv: ['sh', 'apps/www/public/install.sh', '--version-check'],
    env: { SDODS_YES: '1' },
    columns: 92,
    head: 14,
  },
  {
    name: 'project-list',
    group: 'install',
    display: 'sdods project list',
    argv: sdods('project list'),
    columns: 96,
    head: 14,
  },
  {
    name: 'analyze-summary',
    group: 'onboard',
    display: 'sdods analyze ../cypress-realworld-app',
    argv: sdods('analyze ../cypress-realworld-app'),
    needs: workshopApp,
    from: /^Analysis of/,
    until: /^Routes \(/,
    head: 12,
  },
  {
    name: 'analyze-routes',
    group: 'onboard',
    display: 'sdods analyze ../cypress-realworld-app | sed -n "/^Routes/,/^$/p"',
    argv: sdods('analyze ../cypress-realworld-app'),
    needs: workshopApp,
    from: /^Routes \(/,
    until: /^Existing tests/,
    head: 21,
    columns: 104,
  },
  {
    name: 'analyze-checklist',
    group: 'onboard',
    display: 'sdods analyze ../cypress-realworld-app | sed -n "/^Checklist/,/^Proposed/p"',
    argv: sdods('analyze ../cypress-realworld-app'),
    needs: workshopApp,
    from: /^Checklist/,
    until: /^Proposed project/,
    head: 18,
    columns: 92,
    wrap: true,
  },
  {
    name: 'analyze-modules',
    group: 'onboard',
    display: 'sdods analyze ../cypress-realworld-app | sed -n "/^--- modules/,/^--- sdods/p"',
    argv: sdods('analyze ../cypress-realworld-app'),
    needs: workshopApp,
    from: /^--- modules/,
    until: /^--- sdods\.project\.yaml/,
    columns: 112,
  },
  {
    name: 'analyze-tests',
    group: 'onboard',
    display: 'sdods analyze ../cypress-realworld-app | sed -n "/^Existing tests/,/^$/p"',
    argv: sdods('analyze ../cypress-realworld-app'),
    needs: workshopApp,
    from: /^Existing tests/,
    until: /^Environment files/,
    head: 10,
  },
  {
    name: 'run-api',
    group: 'workshop',
    display: 'sdods run -p rwa-bank -e local -l api',
    argv: sdods('run -p rwa-bank -e local -l api'),
    needs: workshopApp,
    from: /^ {2}✓ {2}1 /,
    drop: /\[(api|ui)\]|INFO|←/,
    rewrite: [[/^(\s*✓\s+\d+\s+).*?\.feature\.spec\.js:\d+:\d+ › /, '$1']],
    until: /^artifacts:/,
    columns: 92,
    head: 18,
  },
  {
    name: 'run-ui-first',
    group: 'workshop',
    display: 'sdods run -p rwa-raw -e local -l ui -b chromium -t @smoke',
    argv: sdods('run -p rwa-raw -e local -l ui -b chromium -t @smoke'),
    // The pristine project as `analyze` wrote it, kept out of the repository:
    //   sdods analyze ../cypress-realworld-app --apply --project rwa-raw --name "RWA raw"
    needs: resolve(repoRoot, 'projects', 'rwa-raw'),
    from: /^ {2}1\) /,
    until: /^ {4}Call log/,
    rewrite: [[/^(\s*\d+\) )\[[^\]]+\] › .*?\.feature\.spec\.js:\d+:\d+ › /, '$1']],
    columns: 88,
    head: 9,
    wrap: true,
  },
  {
    name: 'run-ui-first-summary',
    group: 'workshop',
    display: 'sdods run -p rwa-raw -e local -l ui -b chromium -t @smoke',
    argv: sdods('run -p rwa-raw -e local -l ui -b chromium -t @smoke'),
    // The pristine project as `analyze` wrote it, kept out of the repository:
    //   sdods analyze ../cypress-realworld-app --apply --project rwa-raw --name "RWA raw"
    needs: resolve(repoRoot, 'projects', 'rwa-raw'),
    from: /^ {2}\d+ failed/,
    until: /^artifacts:/,
    rewrite: [[/^(\s{4})\[[^\]]+\] › .*?\.feature\.spec\.js:\d+:\d+ › /, '$1']],
    columns: 88,
    head: 12,
  },
  {
    name: 'run-ui-green',
    group: 'workshop',
    display: 'sdods run -p rwa-bank -e local -l ui -b chromium -t @smoke',
    argv: sdods('run -p rwa-bank -e local -l ui -b chromium -t @smoke'),
    needs: workshopApp,
    from: /^ {2}✓ {2}1 /,
    drop: /INFO|←/,
    rewrite: [[/^(\s*✓\s+\d+\s+).*?\.feature\.spec\.js:\d+:\d+ › /, '$1']],
    until: /^artifacts:/,
    columns: 92,
    head: 12,
  },
  {
    name: 'coverage',
    group: 'workshop',
    display: 'sdods coverage -p rwa-bank --routes',
    argv: sdods('coverage -p rwa-bank --routes'),
    from: /^Coverage for/,
    columns: 92,
    head: 14,
  },
  {
    name: 'features-list',
    group: 'workshop',
    display: 'sdods features list -p rwa-bank',
    argv: sdods('features list -p rwa-bank'),
    columns: 100,
    head: 17,
  },
  {
    name: 'lint',
    group: 'workshop',
    display: 'sdods lint -p rwa-bank',
    argv: sdods('lint -p rwa-bank'),
    columns: 70,
    head: 6,
  },
  {
    name: 'data-preview',
    group: 'workshop',
    display: 'sdods data preview projects/rwa-bank/data/common/users.csv',
    argv: sdods('data preview projects/rwa-bank/data/common/users.csv'),
    columns: 84,
    head: 8,
  },
  {
    name: 'auth-list',
    group: 'workshop',
    display: 'sdods auth list -p rwa-bank -e local',
    argv: sdods('auth list -p rwa-bank -e local'),
    rewrite: [[/\S*projects\/rwa-bank\/\.auth\/local\//, '.auth/local/']],
    columns: 76,
    head: 8,
  },
  {
    name: 'har-list',
    group: 'workshop',
    display: 'sdods har list -p rwa-bank -e local',
    argv: sdods('har list -p rwa-bank -e local'),
    columns: 76,
    head: 6,
  },
  {
    name: 'insights',
    group: 'workshop',
    display: 'sdods insights show -p rwa-bank',
    argv: sdods('insights show -p rwa-bank'),
    columns: 128,
    head: 9,
  },
  {
    name: 'processes',
    group: 'workshop',
    display: 'sdods processes list -p rwa-bank',
    argv: sdods('processes list -p rwa-bank'),
    columns: 108,
    head: 8,
  },
  {
    name: 'run-regression',
    group: 'workshop',
    display: 'sdods run -p rwa-bank -e local -t @regression',
    argv: sdods('run -p rwa-bank -e local -t @regression'),
    needs: workshopApp,
    from: /^ {2}✓ {2}1 /,
    drop: /INFO|←/,
    rewrite: [[/^(\s*✓\s+\d+\s+).*?\.feature\.spec\.js:\d+:\d+ › /, '$1']],
    until: /^artifacts:/,
    columns: 100,
    head: 14,
  },
];

/** Keeps only the interesting window of the output — this is the crop, in text. */
function crop(out: string, shot: Shot): string[] {
  // The reader's machine is not this machine: paths are shown as a reader would see them.
  const home = process.env.HOME ?? '';
  let lines = out
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => (home ? l.split(home).join('~') : l));
  lines = lines.filter((l) => !/^\(node:\d+\) Warning|^\(Use `node --trace-warnings/.test(l));
  if (shot.rewrite) {
    lines = lines.map((l) => shot.rewrite!.reduce((acc, [re, to]) => acc.replace(re, to), l));
  }
  if (shot.drop) lines = lines.filter((l) => !shot.drop!.test(l));
  if (shot.from) {
    const i = lines.findIndex((l) => shot.from!.test(l));
    if (i >= 0) lines = lines.slice(i);
  }
  if (shot.until) {
    const i = lines.findIndex((l) => shot.until!.test(l));
    if (i > 0) lines = lines.slice(0, i);
  }
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (shot.head && lines.length > shot.head) lines = [...lines.slice(0, shot.head), '…'];
  return lines;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Colours the two things a reader looks for: a passing mark and a warning. */
function paint(line: string): string {
  const html = esc(line);
  if (/^\s*[✓✔]/.test(line)) return `<span class="ok">${html}</span>`;
  if (/^\s*[⚠!]/.test(line)) return `<span class="warn">${html}</span>`;
  if (/^\s*[✖✗×]/.test(line)) return `<span class="bad">${html}</span>`;
  if (/^\s*[ℹ]/.test(line)) return `<span class="info">${html}</span>`;
  if (/^[A-Z][A-Za-z -]+ {2,}/.test(line)) return `<span class="key">${html}</span>`;
  return html;
}

function cardHtml(shot: Shot, lines: string[]): string {
  const cols = shot.columns ?? 84;
  return `<!doctype html><meta charset="utf-8">
<style>
  :root { color-scheme: light }
  body { margin: 0; padding: 24px; background: #eef2ff; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace }
  .card { width: ${cols}ch; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(15,23,42,.18); background: #0f172a }
  .bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #1e293b }
  .dot { width: 11px; height: 11px; border-radius: 50% }
  .term { padding: 14px 16px 18px; color: #cbd5e1; white-space: ${shot.wrap ? 'pre-wrap' : 'pre'}; overflow-wrap: anywhere; overflow: hidden }
  .prompt { color: #2dd4bf }
  .cmd { color: #f8fafc; font-weight: 600 }
  .ok { color: #4ade80 } .warn { color: #fbbf24 } .bad { color: #fb7185 }
  .info { color: #93c5fd } .key { color: #e2e8f0 }
</style>
<div class="card">
  <div class="bar">
    <span class="dot" style="background:#fb7185"></span>
    <span class="dot" style="background:#f59e0b"></span>
    <span class="dot" style="background:#22c55e"></span>
    <span style="margin-left:6px;color:#94a3b8;font-size:11px">${esc(shot.name)}</span>
  </div>
  <div class="term"><span class="prompt">$</span> <span class="cmd">${esc(shot.display)}</span>

${lines.map(paint).join('\n')}</div>
</div>`;
}

async function main() {
  const only = process.argv[2];
  const shots = SHOTS.filter((s) => !only || s.group === only || s.name === only);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 1400, height: 900 },
  });
  // Merge with what is already there, so refreshing one group does not drop the others.
  const manifestFile = join(outDir, 'manifest.json');
  const manifest: Record<string, { command: string; width: number; height: number }> = existsSync(
    manifestFile,
  )
    ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<
        string,
        { command: string; width: number; height: number }
      >)
    : {};
  const skipped: string[] = [];

  for (const shot of shots) {
    if (shot.needs && !existsSync(shot.needs)) {
      skipped.push(`${shot.name} (missing ${shot.needs})`);
      continue;
    }
    const argv = shot.argv ?? shot.display.split(' ');
    const res = spawnSync(argv[0]!, argv.slice(1), {
      cwd: shot.cwd ?? repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: undefined,
        COLUMNS: String(shot.columns ?? 84),
        ...shot.env,
      },
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    const lines = crop(output, shot);
    if (lines.length === 0) {
      skipped.push(`${shot.name} (no output; exit ${res.status})`);
      continue;
    }
    await page.setContent(cardHtml(shot, lines), { waitUntil: 'load' });
    const card = page.locator('.card');
    const file = join(outDir, `${shot.name}.png`);
    await card.screenshot({ path: file, scale: 'css' });
    const box = (await card.boundingBox())!;
    manifest[shot.name] = {
      command: shot.display,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
    console.log(
      `✓ ${shot.name}  ${Math.round(box.width)}×${Math.round(box.height)}  ${shot.display}`,
    );
  }

  await browser.close();
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  if (skipped.length) console.log(`skipped: ${skipped.join(', ')}`);
  console.log('\nMDX snippets:\n');
  for (const [name, m] of Object.entries(manifest)) {
    console.log(
      `<Screenshot src="/screenshots/cli/${name}.png" width={${m.width}} height={${m.height}} alt="Output of ${m.command}" />`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
