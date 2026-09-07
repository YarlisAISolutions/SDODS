/**
 * Stage an official Node runtime into `resources/node/<platform>-<arch>/`.
 *
 * The desktop app ships its own Node so a fresh machine needs nothing pre-installed. That binary
 * runs the SDODS server and npm, and it must be a real Node — not Electron in node mode — because
 * the server loads native modules (better-sqlite3, argon2) built for Node's ABI.
 *
 * Every download is checked against the official SHASUMS256.txt for the release. A build that
 * cannot verify its runtime fails rather than shipping something unverified.
 *
 *   node --import tsx scripts/fetch-node-runtime.ts                  # this machine
 *   node --import tsx scripts/fetch-node-runtime.ts --all            # every shipped target
 *   node --import tsx scripts/fetch-node-runtime.ts --platform win32 --arch x64
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Pinned deliberately: the runtime users get should change only when we decide it does. */
export const NODE_VERSION = 'v22.23.2';
const DIST = `https://nodejs.org/dist/${NODE_VERSION}`;

export interface Target {
  platform: NodeJS.Platform | 'win32' | 'darwin' | 'linux';
  arch: 'x64' | 'arm64';
}

/** The six targets the app ships. Kept in step with electron-builder.yml. */
export const TARGETS: Target[] = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'win32', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
];

/** Node's own naming: `win` not `win32`, and `.zip` on Windows, `.tar.xz` on Linux. */
function artifact(t: Target): { name: string; ext: string } {
  const os = t.platform === 'win32' ? 'win' : t.platform;
  const ext = t.platform === 'win32' ? 'zip' : t.platform === 'linux' ? 'tar.xz' : 'tar.gz';
  return { name: `node-${NODE_VERSION}-${os}-${t.arch}`, ext };
}

export const targetDir = (root: string, t: Target) => join(root, `${t.platform}-${t.arch}`);

let shasums: Map<string, string> | null = null;

async function checksums(): Promise<Map<string, string>> {
  if (shasums) return shasums;
  const res = await fetch(`${DIST}/SHASUMS256.txt`);
  if (!res.ok) throw new Error(`Could not fetch SHASUMS256.txt (${res.status})`);
  const map = new Map<string, string>();
  for (const line of (await res.text()).split('\n')) {
    const [sum, file] = line.trim().split(/\s+/);
    if (sum && file) map.set(file, sum);
  }
  shasums = map;
  return map;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Fetch, verify and extract one target. Idempotent: an already-staged runtime is left alone, so
 * this is cheap to call from a build hook and cacheable in CI.
 */
export async function fetchRuntime(root: string, t: Target): Promise<string> {
  const dest = targetDir(root, t);
  const nodeExe = t.platform === 'win32' ? join(dest, 'node.exe') : join(dest, 'bin', 'node');
  if (existsSync(nodeExe)) {
    console.log(`  ok    ${t.platform}-${t.arch} already staged`);
    return dest;
  }

  const { name, ext } = artifact(t);
  const file = `${name}.${ext}`;
  const expected = (await checksums()).get(file);
  if (!expected) throw new Error(`${file} is not listed in SHASUMS256.txt for ${NODE_VERSION}`);

  console.log(`  ...   ${t.platform}-${t.arch}: downloading ${file}`);
  const buf = await download(`${DIST}/${file}`);

  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${file}\n  expected ${expected}\n  actual   ${actual}`);
  }

  // Extract into a temp sibling and move into place, so an interrupted run never leaves a
  // half-extracted directory that the `existsSync` check above would accept next time.
  const staging = `${dest}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const archive = join(staging, file);
  writeFileSync(archive, buf);

  // bsdtar reads .zip, .tar.gz and .tar.xz alike, and ships with macOS, Windows 10+ and every
  // mainstream Linux image -- so one command covers all six targets and `unzip` is not needed.
  //
  // Run it from the staging directory with a bare filename. Handed an absolute Windows path,
  // bsdtar reads the drive letter as a remote host and fails with "Cannot connect to D:", because
  // `host:path` is valid tar syntax. Keeping both arguments relative avoids the colon entirely.
  await exec('tar', ['-xf', file], { cwd: staging });
  rmSync(archive);

  // Archives contain a single top-level `node-<version>-<os>-<arch>/` directory; hoist it.
  const entries = readdirSync(staging);
  const inner = entries.length === 1 && entries[0] ? join(staging, entries[0]) : staging;
  rmSync(dest, { recursive: true, force: true });
  renameSync(inner, dest);
  rmSync(staging, { recursive: true, force: true });

  if (!existsSync(nodeExe)) throw new Error(`Extracted ${file} but ${nodeExe} is missing`);
  const saved = prune(dest);
  console.log(`  ok    ${t.platform}-${t.arch} staged${saved ? ` (pruned ${saved})` : ''}`);
  return dest;
}

/**
 * Drop what a *runtime* never reads. This is worth doing: a full Node distribution is ~187 MB,
 * and `include/` alone -- the C++ headers -- is ~62 MB of it. node-gyp downloads its own headers
 * from nodejs.org rather than reading these, so nothing in the app's install path needs them.
 *
 * The node binary itself (~108 MB, V8 plus full ICU) is the irreducible part and is left alone.
 */
function prune(dest: string): string | null {
  const before = dirSize(dest);
  const droppable = [
    'include', // C++ addon headers
    'share', // man pages, systemtap scripts
    'CHANGELOG.md',
    'README.md',
    join('lib', 'node_modules', 'npm', 'docs'),
    join('lib', 'node_modules', 'npm', 'man'),
  ];
  for (const rel of droppable) rmSync(join(dest, rel), { recursive: true, force: true });
  const after = dirSize(dest);
  if (before <= after) return null;
  return `${Math.round((before - after) / 1024 / 1024)} MB`;
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) {
      try {
        total += statSync(full).size;
      } catch {
        /* symlink to a pruned target */
      }
    }
  }
  return total;
}

function parseArgs(argv: string[]): Target[] {
  if (argv.includes('--all')) return TARGETS;
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const platform = at('--platform') ?? process.platform;
  const arch = at('--arch') ?? process.arch;
  const found = TARGETS.find((t) => t.platform === platform && t.arch === arch);
  if (!found) throw new Error(`Unsupported target ${platform}-${arch}`);
  return [found];
}

async function main() {
  const here = join(import.meta.dirname, '..');
  const root = join(here, 'resources', 'node');
  mkdirSync(root, { recursive: true });

  const targets = parseArgs(process.argv.slice(2));
  console.log(`Staging Node ${NODE_VERSION} into resources/node/`);
  for (const t of targets) await fetchRuntime(root, t);

  // Record what was staged so a build can report the runtime it shipped.
  writeFileSync(join(root, 'VERSION'), `${NODE_VERSION}\n`, 'utf8');
  console.log('done.');
}

// Run only when invoked as a script; the electron-builder hook imports fetchRuntime instead.
if (process.argv[1]?.includes('fetch-node-runtime')) await main();
