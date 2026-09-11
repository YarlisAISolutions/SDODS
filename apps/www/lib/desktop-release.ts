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
  /** Signed builds skip the Gatekeeper/SmartScreen instructions. */
  signed: boolean;
  assets: DesktopAsset[];
}

/**
 * Generated. Do not edit by hand — run `bun run desktop:sync-release <tag>` from the repo root
 * after the desktop workflow publishes a release.
 */
export const DESKTOP_RELEASE: DesktopRelease = {
  tag: 'desktop-v0.1.0',
  assetBaseUrl: 'https://github.com/siri1410/sdods-releases/releases/download/desktop-v0.1.0',
  version: '0.1.0',
  published: '2026-09-07',
  signed: false,
  assets: [
    {
      platform: 'linux',
      label: '.deb (64-bit)',
      file: 'SDODS-0.1.0-linux-amd64.deb',
      size: '127 MB',
      arch: 'x64',
      secondary: true,
    },
    {
      platform: 'linux',
      label: 'AppImage (ARM64)',
      file: 'SDODS-0.1.0-linux-arm64.AppImage',
      size: '166 MB',
      arch: 'arm64',
    },
    {
      platform: 'linux',
      label: '.deb (ARM64)',
      file: 'SDODS-0.1.0-linux-arm64.deb',
      size: '122 MB',
      arch: 'arm64',
      secondary: true,
    },
    {
      platform: 'linux',
      label: 'AppImage (64-bit)',
      file: 'SDODS-0.1.0-linux-x86_64.AppImage',
      size: '164 MB',
      arch: 'x64',
    },
    {
      platform: 'macos',
      label: 'Apple silicon',
      file: 'SDODS-0.1.0-mac-arm64.dmg',
      size: '160 MB',
      arch: 'arm64',
    },
    {
      platform: 'macos',
      label: 'Zip (Apple silicon)',
      file: 'SDODS-0.1.0-mac-arm64.zip',
      size: '161 MB',
      arch: 'arm64',
      secondary: true,
    },
    {
      platform: 'macos',
      label: 'Intel',
      file: 'SDODS-0.1.0-mac-x64.dmg',
      size: '164 MB',
      arch: 'x64',
    },
    {
      platform: 'macos',
      label: 'Zip (Intel)',
      file: 'SDODS-0.1.0-mac-x64.zip',
      size: '165 MB',
      arch: 'x64',
      secondary: true,
    },
    {
      platform: 'windows',
      label: 'ARM64',
      file: 'SDODS-Setup-0.1.0-win-arm64.exe',
      size: '117 MB',
      arch: 'arm64',
    },
    {
      platform: 'windows',
      label: '64-bit',
      file: 'SDODS-Setup-0.1.0-win-x64.exe',
      size: '126 MB',
      arch: 'x64',
    },
    {
      platform: 'windows',
      label: '64-bit',
      file: 'SDODS-Setup-0.1.0-win.exe',
      size: '243 MB',
      arch: 'universal',
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
