/**
 * Refresh the download page's release manifest from a published GitHub release.
 *
 *   bun run desktop:sync-release desktop-v0.1.0
 *   bun run desktop:sync-release            # newest desktop-v* release
 *   bun run desktop:sync-release desktop-v0.2.0 --signed=macos   # platforms whose builds are signed
 *
 * sdods.com is a static export: it cannot query GitHub at request time, and querying at build
 * time would make every site deploy depend on GitHub being up. So the release is committed, and
 * this script is the only thing that writes it. Run it after the desktop workflow publishes, then
 * commit the result — that commit is what makes the download buttons appear.
 *
 * It reads the *real* asset list, so the page can never advertise a file the release does not
 * have. If the release is missing an expected platform, it says so and exits non-zero rather than
 * publishing a page with a hole in it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSignedPlatforms, type SignablePlatform } from '../apps/www/lib/desktop-release.js';

const MANIFEST = join(import.meta.dirname, '..', 'apps', 'www', 'lib', 'desktop-release.ts');

/**
 * The PUBLIC releases-only repository, not the source repository.
 *
 * Installers live in the public releases-only repository. That was required while
 * YarlisAISolutions/SDODS was private (until 2026-09-26); it stays because installed apps, the apt repository, Homebrew and Scoop already point there, and one releases-only repository keeps the download page's asset list clean.
 */
const REPO = process.env.SDODS_RELEASE_REPO ?? 'YarlisAISolutions/sdods-releases';

interface GhAsset {
  name: string;
  size: number;
}
interface GhRelease {
  tag_name: string;
  published_at: string | null;
  draft: boolean;
  assets: GhAsset[];
}

type Platform = 'macos' | 'windows' | 'linux';

interface Entry {
  platform: Platform;
  label: string;
  file: string;
  size: string;
  arch: 'arm64' | 'x64' | 'universal';
  secondary?: boolean;
}

function mib(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * Classify a release asset. Anything unrecognised is ignored rather than guessed at — blockmaps,
 * latest*.yml and checksums all live in the same release and are not downloads.
 */
function classify(name: string, size: number): Entry | null {
  const arch: Entry['arch'] = /arm64|aarch64/i.test(name)
    ? 'arm64'
    : /x64|x86_64|amd64/i.test(name)
      ? 'x64'
      : 'universal';
  const archLabel = arch === 'arm64' ? 'Apple silicon' : arch === 'x64' ? 'Intel' : '';

  if (name.endsWith('.dmg')) {
    return {
      platform: 'macos',
      label: arch === 'arm64' ? 'Apple silicon' : arch === 'x64' ? 'Intel' : 'Universal',
      file: name,
      size: mib(size),
      arch,
      // A universal build carries both slices and is nearly twice the size. It is the safe answer,
      // never the best one, so it is listed rather than recommended.
      secondary: arch === 'universal' || undefined,
    };
  }
  if (name.endsWith('.exe')) {
    return {
      platform: 'windows',
      // An installer with no architecture in its filename bundles every slice. Labelling it
      // "64-bit" -- which the arm64-or-else fallback used to do -- put two different downloads
      // under the same name, one of them twice the size.
      label: arch === 'arm64' ? 'ARM64' : arch === 'x64' ? '64-bit' : 'Universal (x64 + ARM64)',
      file: name,
      size: mib(size),
      arch,
      secondary: arch === 'universal' || undefined,
    };
  }
  if (name.endsWith('.AppImage')) {
    return {
      platform: 'linux',
      label: `AppImage (${arch === 'arm64' ? 'ARM64' : '64-bit'})`,
      file: name,
      size: mib(size),
      arch,
      // Listed, not recommended. The AppImage runtime dlopens libfuse.so.2, which Ubuntu 22.04 and
      // later do not install by default, so a double-click can fail with "Cannot mount AppImage"
      // on a current desktop. The .deb has no such dependency. Recommending the AppImage while the
      // install steps below call the .deb "the recommended route" also just contradicted itself.
      secondary: true,
    };
  }
  if (name.endsWith('.deb')) {
    return {
      platform: 'linux',
      label: `.deb (${arch === 'arm64' ? 'ARM64' : '64-bit'})`,
      file: name,
      size: mib(size),
      arch,
      // The primary Linux download: `apt install ./SDODS-*.deb` resolves its own dependencies and
      // needs nothing the distribution does not already ship.
    };
  }
  // macOS .zip exists for electron-updater, not for people to download.
  if (name.endsWith('.zip') && /mac/i.test(name)) {
    return {
      platform: 'macos',
      label: `Zip${archLabel ? ` (${archLabel})` : ''}`,
      file: name,
      size: mib(size),
      arch,
      secondary: true,
    };
  }
  return null;
}

async function gh<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  // A token is optional for a public repo but avoids the 60/hour anonymous rate limit.
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers });
  if (res.status === 404) {
    // A 404 on a *private* repo is indistinguishable from one that does not exist, so say both.
    throw new Error(
      `${REPO} is not readable (404).\n` +
        `  If it does not exist yet, create it as a PUBLIC repository:\n` +
        `    gh repo create ${REPO} --public -d 'SDODS desktop installers'\n` +
        `  If it exists but is private, its release assets are private too and the download page\n` +
        `  would 404 for every visitor. Set SDODS_RELEASE_REPO to override the target.`,
    );
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function resolveRelease(tag?: string): Promise<GhRelease> {
  if (tag) return gh<GhRelease>(`/releases/tags/${tag}`);
  const all = await gh<GhRelease[]>('/releases?per_page=30');
  const found = all.find((r) => r.tag_name.startsWith('desktop-v') && !r.draft);
  if (!found) {
    throw new Error(
      'No published desktop-v* release found. Cut one with `git tag desktop-v<version>` and let ' +
        'the desktop workflow build it, or pass a tag explicitly.',
    );
  }
  return found;
}

/**
 * A single-quoted TypeScript string literal.
 *
 * `JSON.stringify` would be the obvious choice, but it emits double quotes and this repo's
 * Prettier config uses single ones — so the generated manifest failed `prettier --check` and took
 * CI down with it, on a file nobody had edited by hand.
 */
const str = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function render(release: GhRelease, entries: Entry[], signed: SignablePlatform[]): string {
  const version = release.tag_name.replace(/^desktop-v/, '');
  const assetBaseUrl = `https://github.com/${REPO}/releases/download/${release.tag_name}`;
  const published = release.published_at ? release.published_at.slice(0, 10) : null;
  const assets = entries
    .map(
      (e) =>
        `    {\n` +
        `      platform: '${e.platform}',\n` +
        `      label: ${str(e.label)},\n` +
        `      file: ${str(e.file)},\n` +
        `      size: ${str(e.size)},\n` +
        `      arch: '${e.arch}',\n` +
        (e.secondary ? `      secondary: true,\n` : '') +
        `    },`,
    )
    .join('\n');

  const source = readFileSync(MANIFEST, 'utf8');
  const replacement =
    `export const DESKTOP_RELEASE: DesktopRelease = {\n` +
    `  tag: ${str(release.tag_name)},\n` +
    `  assetBaseUrl: ${str(assetBaseUrl)},\n` +
    `  version: ${str(version)},\n` +
    `  published: ${published ? str(published) : 'null'},\n` +
    `  signed: [${signed.map(str).join(', ')}],\n` +
    `  assets: [\n${assets}\n  ],\n` +
    `};`;

  const pattern = /export const DESKTOP_RELEASE: DesktopRelease = \{[\s\S]*?\n\};/;
  if (!pattern.test(source)) {
    throw new Error(`Could not find the DESKTOP_RELEASE block in ${MANIFEST}`);
  }
  return source.replace(pattern, replacement);
}

/**
 * `--signed=<list>` names the platforms whose installers are signed. A bare `--signed` is refused:
 * it used to mean every platform, which dropped the SmartScreen advice the day only macOS was signed.
 */
function signedFrom(args: string[]): SignablePlatform[] {
  const flag = args.find((a) => a === '--signed' || a.startsWith('--signed='));
  if (!flag) return [];
  try {
    return parseSignedPlatforms(flag.slice('--signed='.length));
  } catch (e) {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const signed = signedFrom(args);
  const tag = args.find((a) => a.startsWith('desktop-v'));

  const release = await resolveRelease(tag);
  if (release.draft) {
    // Draft assets are not downloadable, so syncing now would publish a page of 404s.
    console.error(
      `✖ ${release.tag_name} is still a draft in ${REPO}.\n` +
        `  Publish the release first, then run this again — the download page links straight at\n` +
        `  its assets and a draft would give every visitor a 404.`,
    );
    process.exit(1);
  }

  const entries = release.assets
    .map((a) => classify(a.name, a.size))
    .filter((e): e is Entry => e !== null)
    .sort(
      (a, b) => a.platform.localeCompare(b.platform) || Number(a.secondary) - Number(b.secondary),
    );

  const platforms = new Set(entries.filter((e) => !e.secondary).map((e) => e.platform));
  const missing = (['macos', 'windows', 'linux'] as Platform[]).filter((p) => !platforms.has(p));
  if (missing.length) {
    console.error(
      `✖ ${release.tag_name} has no primary installer for: ${missing.join(', ')}.\n` +
        `  The download page would show a gap. Fix the release before syncing.`,
    );
    process.exit(1);
  }

  writeFileSync(MANIFEST, render(release, entries, signed));
  console.log(`✔ ${release.tag_name} from ${REPO} → apps/www/lib/desktop-release.ts`);
  for (const e of entries) {
    console.log(
      `    ${e.platform.padEnd(8)} ${e.label.padEnd(22)} ${e.size.padStart(7)}  ${e.file}`,
    );
  }
  console.log('\nCommit the change, then merge to main to publish the download page.');
}

await main().catch((err: unknown) => {
  // A stack trace helps nobody here: every failure mode is either "no release yet" or a GitHub
  // API problem, and both are actionable sentences.
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
