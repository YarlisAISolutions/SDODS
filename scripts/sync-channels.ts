/**
 * Resolve every distribution channel against the registry that actually serves it, render the
 * package-manager manifests, and record which channels are live.
 *
 *   bun run channels:sync              # check everything, write manifests + the site manifest
 *   bun run channels:sync --check      # check only; non-zero if the committed state is stale
 *
 * Why this is one script and not six workflow steps: the six channels publish on three different
 * schedules, from two different repositories, and one of them (the desktop release) is published
 * by a human. Nothing can derive "is Homebrew live?" from this repository's own state — the only
 * true answer is whether the tap has the formula and the tarball it names can be fetched. So each
 * channel is probed, and a channel that cannot be probed is not live.
 *
 * Every SHA-256 here is computed from bytes this script downloaded. A checksum copied from a
 * release page is a checksum nobody verified, and it is the one field where being wrong means the
 * user's package manager refuses to install at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CHANNELS_TS = join(ROOT, 'apps', 'www', 'lib', 'install-channels.ts');
const PACKAGING = join(ROOT, 'packaging');

/** The public releases-only repository. See scripts/sync-desktop-release.ts for why it exists. */
const RELEASE_REPO = process.env.SDODS_RELEASE_REPO ?? 'siri1410/sdods-releases';
/** Public tap and bucket repositories. Both hold manifests only, never source. */
const TAP_REPO = process.env.SDODS_TAP_REPO ?? 'siri1410/homebrew-sdods';
const BUCKET_REPO = process.env.SDODS_BUCKET_REPO ?? 'siri1410/scoop-sdods';
const IMAGE = process.env.SDODS_IMAGE ?? 'siri1410/sdods-server';
/**
 * The apt repository is served from GitHub Pages on the public releases repository, not from
 * sdods.com: that site is a static export deployed whole, and hosting a few hundred megabytes of
 * .deb there would put them in every site deploy. Built by .github/workflows/apt.yml.
 */
const APT_URL = process.env.SDODS_APT_URL ?? 'https://siri1410.github.io/sdods-releases/apt';

const CHECK_ONLY = process.argv.includes('--check');

interface Probe {
  live: boolean;
  detail: string;
}

const ghHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
};

async function head(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

async function sha256(url: string): Promise<{ hash: string; bytes: number }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { hash: createHash('sha256').update(buf).digest('hex'), bytes: buf.byteLength };
}

// ── npm ────────────────────────────────────────────────────────────────────────────────────────

interface Npm {
  version: string;
  tarball: string;
  sha256: string;
}

async function probeNpm(): Promise<{ probe: Probe; npm: Npm | null }> {
  const res = await fetch('https://registry.npmjs.org/@sdods/cli/latest');
  if (!res.ok) {
    return { probe: { live: false, detail: `registry returned ${res.status}` }, npm: null };
  }
  const meta = (await res.json()) as { version: string; dist: { tarball: string } };
  // The registry publishes sha1 (`dist.shasum`) and an integrity string that is sha512. Homebrew
  // wants sha256, which is in neither, so the tarball is downloaded and hashed.
  const { hash } = await sha256(meta.dist.tarball);
  return {
    probe: { live: true, detail: `@sdods/cli@${meta.version}` },
    npm: { version: meta.version, tarball: meta.dist.tarball, sha256: hash },
  };
}

// ── Docker (GHCR) ──────────────────────────────────────────────────────────────────────────────

/**
 * GHCR answers anonymously for public packages only, and it answers 401 both for "private" and
 * for "does not exist" — which is exactly the state this repository is in until the first `v*`
 * tag is pushed. Either way the pull command on the site would fail, so both are "not live".
 */
async function probeDocker(): Promise<Probe> {
  try {
    const tokenRes = await fetch(
      `https://ghcr.io/token?scope=${encodeURIComponent(`repository:${IMAGE}:pull`)}&service=ghcr.io`,
    );
    if (!tokenRes.ok)
      return { live: false, detail: `no anonymous pull token (${tokenRes.status})` };
    const { token } = (await tokenRes.json()) as { token: string };
    const res = await fetch(`https://ghcr.io/v2/${IMAGE}/manifests/latest`, {
      method: 'HEAD',
      headers: {
        authorization: `Bearer ${token}`,
        accept:
          'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json',
      },
    });
    return res.ok
      ? { live: true, detail: `ghcr.io/${IMAGE}:latest` }
      : {
          live: false,
          detail: `manifest ${res.status} — not published, or the package is private`,
        };
  } catch (e) {
    return { live: false, detail: `unreachable: ${(e as Error).message}` };
  }
}

// ── the desktop release the Windows and Linux managers install ─────────────────────────────────

interface GhAsset {
  name: string;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  published_at: string | null;
  draft: boolean;
  assets: GhAsset[];
}

interface Desktop {
  version: string;
  releaseDate: string;
  winX64: { url: string; sha256: string };
  winArm64: { url: string; sha256: string };
  debs: string[];
}

async function resolveDesktop(): Promise<{ probe: Probe; desktop: Desktop | null }> {
  const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`, {
    headers: ghHeaders(),
  });
  if (!res.ok) {
    return {
      probe: { live: false, detail: `${RELEASE_REPO} returned ${res.status}` },
      desktop: null,
    };
  }
  const all = (await res.json()) as GhRelease[];
  const published = all.find((r) => r.tag_name.startsWith('desktop-v') && !r.draft);
  if (!published) {
    const draft = all.find((r) => r.tag_name.startsWith('desktop-v'));
    return {
      probe: {
        live: false,
        detail: draft
          ? `${draft.tag_name} is still a draft — a person publishes it in ${RELEASE_REPO}`
          : `no desktop-v* release in ${RELEASE_REPO}`,
      },
      desktop: null,
    };
  }

  const find = (re: RegExp) => published.assets.find((a) => re.test(a.name));
  const x64 = find(/^SDODS-Setup-.*-win-x64\.exe$/);
  const arm64 = find(/^SDODS-Setup-.*-win-arm64\.exe$/);
  const debs = published.assets.filter((a) => a.name.endsWith('.deb'));
  if (!x64 || !arm64 || debs.length === 0) {
    return {
      probe: {
        live: false,
        detail: `${published.tag_name} is missing a Windows installer or a .deb — cannot render manifests`,
      },
      desktop: null,
    };
  }

  const [hx, ha] = await Promise.all([
    sha256(x64.browser_download_url),
    sha256(arm64.browser_download_url),
  ]);
  return {
    probe: { live: true, detail: published.tag_name },
    desktop: {
      version: published.tag_name.replace(/^desktop-v/, ''),
      releaseDate: (published.published_at ?? new Date().toISOString()).slice(0, 10),
      winX64: { url: x64.browser_download_url, sha256: hx.hash },
      winArm64: { url: arm64.browser_download_url, sha256: ha.hash },
      debs: debs.map((d) => d.name),
    },
  };
}

/** Is the manifest actually in the tap/bucket a user would add? Rendering it here is not shipping it. */
async function probeRepoFile(repo: string, path: string, what: string): Promise<Probe> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: ghHeaders(),
  });
  return res.ok
    ? { live: true, detail: `${repo}/${path}` }
    : {
        live: false,
        detail: `${what} not in ${repo} (${res.status}) — push the rendered manifest`,
      };
}

// ── rendering ──────────────────────────────────────────────────────────────────────────────────

function render(tmpl: string, values: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in values)) throw new Error(`template placeholder {{${k}}} has no value`);
    return values[k]!;
  });
}

function writeRendered(tmplPath: string, values: Record<string, string>): string {
  const outPath = tmplPath.replace(/\.tmpl$/, '');
  const rendered = render(readFileSync(tmplPath, 'utf8'), values);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered);
  return outPath.replace(`${ROOT}/`, '');
}

/**
 * Rewrite the `live:` flag and the version-bearing commands in the site manifest. Only these
 * fields are generated — the labels, notes and ordering are editorial and stay hand-written, so
 * this edits in place rather than regenerating the array.
 */
function patchChannels(
  source: string,
  live: Record<string, boolean>,
  npm: Npm | null,
  desktop: Desktop | null,
): string {
  let out = source;
  for (const [id, isLive] of Object.entries(live)) {
    // Anchored on the four-space indent: every channel's own `live` sits at that depth, and
    // matching a bare `live:` would let one channel's flag be written into the next object.
    const block = new RegExp(`(id: '${id}',[\\s\\S]*?\\n    )live: (?:true|false),`);
    if (!block.test(out)) throw new Error(`no channel block for '${id}' in install-channels.ts`);
    out = out.replace(block, `$1live: ${isLive},`);
  }

  // The Linux command names a real file, so it has to name the one the release actually has.
  if (desktop) {
    const amd64 = desktop.debs.find((d) => /amd64|x64|x86_64/.test(d)) ?? desktop.debs[0];
    if (amd64) {
      out = out.replace(
        /command: 'sudo apt install \.\/SDODS[^']*\.deb',/,
        `command: 'sudo apt install ./${amd64}',`,
      );
    }
  }
  if (npm) {
    out = out.replace(
      /(id: 'npm',[\s\S]*?)note: '[^']*',/,
      `$1note: 'Needs Node 22+. Currently @sdods/cli@${npm.version} — the same package the installer script fetches.',`,
    );
  }
  return out;
}

async function main() {
  console.log('Probing each channel against the registry that serves it.\n');

  const [{ probe: npmProbe, npm }, dockerProbe, { probe: desktopProbe, desktop }] =
    await Promise.all([probeNpm(), probeDocker(), resolveDesktop()]);

  // The tap and the bucket are separate publishes: a rendered manifest in this repository is not
  // an installable formula until it is pushed there.
  const [tapProbe, bucketProbe] = await Promise.all([
    probeRepoFile(TAP_REPO, 'Formula/sdods.rb', 'formula'),
    probeRepoFile(BUCKET_REPO, 'bucket/sdods.json', 'manifest'),
  ]);
  // winget is the one channel this repository cannot publish: the manifest is merged by
  // Microsoft's reviewers into microsoft/winget-pkgs. Its presence there is the only truth.
  const wingetProbe = await probeRepoFile(
    'microsoft/winget-pkgs',
    'manifests/s/SDODS/SDODS',
    'manifest',
  );
  const aptProbe: Probe = (await head(`${APT_URL}/InRelease`))
    ? { live: true, detail: `${APT_URL} (signed)` }
    : { live: false, detail: `${APT_URL}/InRelease is not served — repo not deployed or unsigned` };

  const written: string[] = [];

  if (npm) {
    written.push(
      writeRendered(join(PACKAGING, 'homebrew', 'sdods.rb.tmpl'), {
        VERSION: npm.version,
        TARBALL_URL: npm.tarball,
        TARBALL_SHA256: npm.sha256,
      }),
    );
  }

  if (desktop) {
    const values = {
      VERSION: desktop.version,
      RELEASE_DATE: desktop.releaseDate,
      WIN_X64_URL: desktop.winX64.url,
      WIN_X64_SHA256: desktop.winX64.sha256,
      WIN_ARM64_URL: desktop.winArm64.url,
      WIN_ARM64_SHA256: desktop.winArm64.sha256,
    };
    written.push(writeRendered(join(PACKAGING, 'scoop', 'sdods.json.tmpl'), values));
    for (const f of [
      'SDODS.SDODS.yaml.tmpl',
      'SDODS.SDODS.locale.en-US.yaml.tmpl',
      'SDODS.SDODS.installer.yaml.tmpl',
    ]) {
      written.push(writeRendered(join(PACKAGING, 'winget', f), values));
    }
  }

  // Homebrew needs BOTH a published tarball and the formula in the tap; Scoop and winget need
  // both a published release and the manifest in its bucket. A channel is the weakest of its
  // parts, which is the whole reason each one is probed separately.
  const live: Record<string, boolean> = {
    'script-unix': true,
    'script-windows': true,
    homebrew: npmProbe.live && tapProbe.live,
    npm: npmProbe.live,
    docker: dockerProbe.live,
    'linux-packages': desktopProbe.live,
    scoop: desktopProbe.live && bucketProbe.live,
    // winget's manifest lives in Microsoft's repository, so "published" is their merge, not ours.
    winget: wingetProbe.live,
    apt: aptProbe.live,
  };

  const rows: Array<[string, Probe]> = [
    ['npm', npmProbe],
    ['docker', dockerProbe],
    ['desktop release', desktopProbe],
    ['homebrew tap', tapProbe],
    ['scoop bucket', bucketProbe],
    ['winget', wingetProbe],
    ['apt repo', aptProbe],
  ];
  for (const [name, p] of rows) {
    console.log(`  ${p.live ? '✔' : '·'} ${name.padEnd(16)} ${p.detail}`);
  }

  const before = readFileSync(CHANNELS_TS, 'utf8');
  const after = patchChannels(before, live, npm, desktop);

  if (CHECK_ONLY) {
    if (after !== before) {
      console.error(
        '\n✖ install-channels.ts is out of date with what the registries actually serve.\n' +
          '  Run `bun run channels:sync` and commit the result.',
      );
      process.exit(1);
    }
    console.log('\n✔ install-channels.ts matches what is published.');
    return;
  }

  writeFileSync(CHANNELS_TS, after);
  console.log(`\n✔ apps/www/lib/install-channels.ts`);
  for (const w of written) console.log(`✔ ${w}`);

  const blocked = rows.filter(([, p]) => !p.live);
  if (blocked.length) {
    console.log('\nStill needs a person:');
    for (const [name, p] of blocked) console.log(`  ${name.padEnd(16)} ${p.detail}`);
  }
}

await main();
