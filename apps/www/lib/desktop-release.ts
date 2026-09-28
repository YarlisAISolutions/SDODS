/**
 * The desktop installers the download page offers.
 *
 * sdods.com is a static export, so it cannot ask the GitHub API at request time — and doing it at
 * build time would make every site deploy depend on GitHub being reachable. So the release is a
 * committed fact, refreshed by `scripts/sync-desktop-release.ts` after a release is published.
 *
 * `tag: null` is a real, supported state, not a placeholder: until the first `desktop-v*` tag
 * exists there are no installers, and the page says so and points at the CLI instead. Shipping a
 * grid of buttons that 404 would be worse than shipping no buttons.
 */
import { REPO_PUBLIC, REPO_URL } from './links';

export type Platform = 'macos' | 'windows' | 'linux';

const ALL_PLATFORMS: readonly Platform[] = ['macos', 'windows', 'linux'];

/**
 * Which platforms' downloads the site offers, as a build-time list.
 *
 * Per-platform rather than one on/off switch, because the reason for hiding is per-platform. The
 * macOS build needs a $99/year Developer ID before macOS stops calling it malware; Windows needs
 * its own certificate before SmartScreen relents; **Linux needs nothing at all** -- no Gatekeeper,
 * no SmartScreen, and the .deb and AppImage install unsigned today. Collapsing those three into a
 * single boolean forced Linux to wait on a macOS invoice, which was never a real constraint.
 *
 *     NEXT_PUBLIC_DESKTOP_PLATFORMS=linux           # only Linux
 *     NEXT_PUBLIC_DESKTOP_PLATFORMS=macos,linux     # after the Apple certificate lands
 *     NEXT_PUBLIC_DESKTOP_PLATFORMS=all             # everything
 *
 * Unset means none, which is the current state: the whole download is hidden.
 */
export const DESKTOP_PLATFORMS: readonly Platform[] = parsePlatforms(
  process.env.NEXT_PUBLIC_DESKTOP_PLATFORMS,
);

function parsePlatforms(raw: string | undefined): readonly Platform[] {
  const tokens = (raw ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return [];
  if (tokens.includes('all')) return ALL_PLATFORMS;

  // A typo must not read as "hide that platform". `NEXT_PUBLIC_DESKTOP_PLATFORMS=mac` silently
  // offering nothing is exactly the kind of quiet wrong answer that gets discovered by a user.
  const unknown = tokens.filter((t) => !ALL_PLATFORMS.includes(t as Platform));
  if (unknown.length) {
    throw new Error(
      `NEXT_PUBLIC_DESKTOP_PLATFORMS: unknown platform(s) ${unknown.join(', ')}. ` +
        `Expected a comma-separated subset of ${ALL_PLATFORMS.join(', ')}, or "all".`,
    );
  }
  return ALL_PLATFORMS.filter((p) => tokens.includes(p));
}

/** Is the desktop app offered at all? False hides every trace of it across the site. */
export const DESKTOP_PUBLIC = DESKTOP_PLATFORMS.length > 0;

export const isOffered = (platform: Platform): boolean => DESKTOP_PLATFORMS.includes(platform);

/** The platforms that have a signing authority to satisfy. Linux has no Gatekeeper or SmartScreen. */
export type SignablePlatform = Exclude<Platform, 'linux'>;

const SIGNABLE: readonly SignablePlatform[] = ['macos', 'windows'];

/**
 * Parse `--signed=<list>` for `scripts/sync-desktop-release.ts`.
 *
 * Per-platform for the same reason as DESKTOP_PLATFORMS: the Apple certificate and the Windows one
 * arrive separately. A single boolean meant signing macOS also deleted the SmartScreen advice for
 * a Windows installer that still triggers it. So there is no "just signed" form -- an empty list,
 * `linux` and typos all throw, and the caller has to name what it actually signed.
 */
export function parseSignedPlatforms(raw: string): SignablePlatform[] {
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const forms = `Expected --signed=macos, --signed=windows, --signed=macos,windows or --signed=all.`;
  if (!tokens.length) throw new Error(`--signed needs the platforms that were signed. ${forms}`);
  if (tokens.includes('all')) return [...SIGNABLE];
  if (tokens.includes('linux')) {
    throw new Error(`--signed: Linux has nothing to sign and never shows a warning. ${forms}`);
  }
  const unknown = tokens.filter((t) => !SIGNABLE.includes(t as SignablePlatform));
  if (unknown.length)
    throw new Error(`--signed: unknown platform(s) ${unknown.join(', ')}. ${forms}`);
  return SIGNABLE.filter((p) => tokens.includes(p));
}

/**
 * Does this platform's installer install without a Gatekeeper or SmartScreen workaround?
 * Always true for Linux, so callers never special-case it.
 */
export const isSigned = (release: DesktopRelease, platform: Platform): boolean =>
  platform === 'linux' || release.signed.includes(platform);

/**
 * The assets the site may actually link to.
 *
 * Everything downstream -- the recommendation, the per-platform grid, the checksum note -- works
 * from this rather than `release.assets`, so a disabled platform cannot leak through one code path
 * that forgot to check.
 */
export const offeredAssets = (release: DesktopRelease): DesktopAsset[] =>
  release.assets.filter((a) => isOffered(a.platform));

export interface DesktopAsset {
  platform: Platform;
  /** Shown on the button, e.g. "Apple silicon". */
  label: string;
  /** Release asset filename. */
  file: string;
  /** Human-readable download size. */
  size: string;
  /** Matched against the user agent to pick the primary button. */
  arch: 'arm64' | 'x64' | 'universal';
  /** Secondary formats (zip, deb) are listed but never the headline choice. */
  secondary?: boolean;
}

export interface DesktopRelease {
  /** Git tag, e.g. "desktop-v0.1.0". Null until the first release is cut. */
  tag: string | null;
  /**
   * Where the installers are actually served from, without a trailing slash.
   *
   * Not derived from REPO_URL on purpose: the repository is private, and **release assets on a
   * private repo are private too** — a GitHub download link would 404 for every visitor. So the
   * host is an explicit fact set by the release process, and can be a public bucket, a CDN, or a
   * separate public releases repo without touching this page.
   */
  assetBaseUrl: string | null;
  version: string | null;
  /** ISO date, for "released on". */
  published: string | null;
  /**
   * Platforms whose installers in this release are signed, so the page drops that platform's
   * Gatekeeper/SmartScreen workaround. Set by `desktop:sync-release --signed=<list>`.
   */
  signed: readonly SignablePlatform[];
  assets: DesktopAsset[];
}

/**
 * Generated. Do not edit by hand — run `bun run desktop:sync-release <tag>` from the repo root
 * after the desktop workflow publishes a release.
 */
/*
 * The ARM64 AppImage is absent on purpose, and will stay absent: the AppImageKit runtime
 * electron-builder embeds for arm64 declares `NEEDED: libz.so` -- the zlib1g-dev symlink --
 * rather than `libz.so.1`, so it cannot start on a stock distro. That target is switched off in
 * apps/desktop/electron-builder.yml, so the release genuinely has ten artifacts, not eleven, and
 * a re-sync will not bring it back. ARM64 Linux users take the .deb.
 */
export const DESKTOP_RELEASE: DesktopRelease = {
  tag: 'desktop-v0.1.2',
  assetBaseUrl:
    'https://github.com/YarlisAISolutions/sdods-releases/releases/download/desktop-v0.1.2',
  version: '0.1.2',
  published: '2026-09-15',
  signed: [],
  assets: [
    {
      platform: 'linux',
      label: '.deb (64-bit)',
      file: 'SDODS-0.1.2-linux-amd64.deb',
      size: '127 MB',
      arch: 'x64',
    },
    {
      platform: 'linux',
      label: '.deb (ARM64)',
      file: 'SDODS-0.1.2-linux-arm64.deb',
      size: '122 MB',
      arch: 'arm64',
    },
    {
      platform: 'linux',
      label: 'AppImage (64-bit)',
      file: 'SDODS-0.1.2-linux-x86_64.AppImage',
      size: '164 MB',
      arch: 'x64',
      secondary: true,
    },
    {
      platform: 'macos',
      label: 'Apple silicon',
      file: 'SDODS-0.1.2-mac-arm64.dmg',
      size: '161 MB',
      arch: 'arm64',
    },
    {
      platform: 'macos',
      label: 'Zip (Apple silicon)',
      file: 'SDODS-0.1.2-mac-arm64.zip',
      size: '157 MB',
      arch: 'arm64',
      secondary: true,
    },
    {
      platform: 'macos',
      label: 'Intel',
      file: 'SDODS-0.1.2-mac-x64.dmg',
      size: '168 MB',
      arch: 'x64',
    },
    {
      platform: 'macos',
      label: 'Zip (Intel)',
      file: 'SDODS-0.1.2-mac-x64.zip',
      size: '164 MB',
      arch: 'x64',
      secondary: true,
    },
    {
      platform: 'windows',
      label: 'ARM64',
      file: 'SDODS-Setup-0.1.2-win-arm64.exe',
      size: '131 MB',
      arch: 'arm64',
    },
    {
      platform: 'windows',
      label: '64-bit',
      file: 'SDODS-Setup-0.1.2-win-x64.exe',
      size: '139 MB',
      arch: 'x64',
    },
    {
      platform: 'windows',
      label: 'Universal (x64 + ARM64)',
      file: 'SDODS-Setup-0.1.2-win.exe',
      size: '269 MB',
      arch: 'universal',
      secondary: true,
    },
  ],
};

export function downloadUrl(release: DesktopRelease, asset: DesktopAsset): string {
  return `${release.assetBaseUrl}/${asset.file}`;
}

/**
 * Where to read release notes and checksums.
 *
 * Derived from `assetBaseUrl`, not from REPO_URL: the source repository is private, so its release
 * pages 404 for visitors, while the repository actually serving the installers is public by
 * definition — a download link could not work otherwise. Turning
 * `…/releases/download/<tag>` into `…/releases/tag/<tag>` therefore always lands somewhere a
 * visitor can open, which is where SHA256SUMS.txt lives.
 */
export const releaseNotesUrl = (release: DesktopRelease): string | null => {
  if (!release.tag) return null;
  if (release.assetBaseUrl?.includes('/releases/download/'))
    return release.assetBaseUrl.replace('/releases/download/', '/releases/tag/');
  // A bucket or CDN has no notes page; the source repo only helps once it is public.
  return REPO_PUBLIC ? `${REPO_URL}/releases/tag/${release.tag}` : null;
};

/** The published checksum list, alongside the installers. Null when they are not on a release. */
export const checksumsUrl = (release: DesktopRelease): string | null =>
  release.assetBaseUrl?.includes('/releases/download/')
    ? `${release.assetBaseUrl}/SHA256SUMS.txt`
    : null;

export const PLATFORM_LABEL: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};

/**
 * Read the CPU architecture, when the browser will tell us.
 *
 * This matters more than it looks: an Apple silicon Mac reports "Intel Mac OS X" in its user
 * agent string, for compatibility. Trusting the UA alone therefore recommends the Intel build to
 * almost every modern Mac — measured on an M-series machine, which is what prompted this.
 *
 * `userAgentData` gives a truthful answer on Chromium browsers. Safari and Firefox expose nothing
 * equivalent, so they fall through to the platform default below.
 */
export async function detectArch(): Promise<'arm64' | 'x64' | null> {
  const uaData = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
      };
    }
  ).userAgentData;
  if (!uaData?.getHighEntropyValues) return null;
  try {
    const { architecture } = await uaData.getHighEntropyValues(['architecture']);
    if (architecture === 'arm') return 'arm64';
    if (architecture === 'x86') return 'x64';
  } catch {
    /* the hint is optional and can be refused */
  }
  return null;
}

/**
 * Pick the artifact a visitor most likely wants.
 *
 * `arch` comes from detectArch() when the browser answered. When it did not, the default per
 * platform is a considered guess rather than a UA parse: macOS defaults to Apple silicon, because
 * every Mac sold since 2020 is one and the UA cannot distinguish them. Guessing wrong costs one
 * click — every other build is listed directly underneath — but guessing Intel would be wrong for
 * the large majority of Mac visitors.
 */
export function detectAsset(
  assets: DesktopAsset[],
  ua: string,
  arch: 'arm64' | 'x64' | null = null,
): DesktopAsset | null {
  const platform: Platform | null = /Windows/i.test(ua)
    ? 'windows'
    : /Mac OS X|Macintosh/i.test(ua)
      ? 'macos'
      : /Linux|X11/i.test(ua)
        ? 'linux'
        : null;
  if (!platform) return null;

  const candidates = assets.filter((a) => a.platform === platform && !a.secondary);
  if (!candidates.length) return null;

  const uaSaysArm = /aarch64|arm64|Windows ARM/i.test(ua);
  const preferred = arch ?? (uaSaysArm ? 'arm64' : platform === 'macos' ? 'arm64' : 'x64');
  return candidates.find((a) => a.arch === preferred) ?? candidates[0] ?? null;
}
