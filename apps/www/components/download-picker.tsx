'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DESKTOP_RELEASE,
  PLATFORM_LABEL,
  detectArch,
  detectAsset,
  detectPlatform,
  downloadUrl,
  releaseNotesUrl,
  checksumsUrl,
  type DesktopAsset,
  type Platform,
} from '@/lib/desktop-release';

const ORDER: Platform[] = ['macos', 'windows', 'linux'];

/**
 * Why a platform has no downloads, when that is a deliberate choice rather than an oversight.
 *
 * An installer that cannot install is worse than no installer: it costs the visitor a 130 MB
 * download and a failed setup before they learn anything. When a build is withdrawn, the page has
 * to say so on the platform it was withdrawn from — a Windows visitor who simply finds no Windows
 * section will reasonably assume the site is broken.
 */
const WITHDRAWN: Partial<Record<Platform, { title: string; body: string }>> = {
  windows: {
    title: 'The Windows installers are temporarily withdrawn',
    body: 'The 0.1.0 installers were packaged without npm, so they could not complete their own first-run setup. Rather than leave a download that always fails, they are pulled until 0.1.1 is published. The command-line install works on Windows today and gives you the same SDODS.',
  },
};

/** What an unsigned build does on first launch, and the exact way past it. */
const GATEKEEPER: Record<Platform, { title: string; body: string; command?: string } | null> = {
  macos: {
    title: 'macOS says SDODS “is damaged and can’t be opened”',
    body: 'It is not damaged — verify the checksum below and you will see the download is intact. The build carries no Developer ID, and macOS reports an unsigned app that arrived with a quarantine flag as damaged rather than untrusted. Drag it to Applications, then run the command below once. Right-click → Open does not clear this particular message.',
    command: 'xattr -dr com.apple.quarantine /Applications/SDODS.app',
  },
  windows: {
    title: 'Windows shows a SmartScreen warning',
    body: 'Choose “More info”, then “Run anyway”. The warning appears because the installer is not yet signed, not because anything is wrong with the download.',
  },
  // Linux has no equivalent gate: neither .deb nor AppImage consults a signing authority, so
  // there is no warning to talk someone past. The install steps below are the whole story.
  linux: null,
};

/**
 * How to actually install what was downloaded, per platform.
 *
 * Shown against every platform, not only the detected one: people download on one machine for
 * another all the time, and the AppImage in particular does nothing on a double-click until it is
 * marked executable — which is not obvious, and is the most common "the download is broken" report.
 */
const INSTALL: Record<Platform, string[]> = {
  macos: [
    'Open the .dmg and drag SDODS to Applications.',
    'Once, in Terminal: xattr -dr com.apple.quarantine /Applications/SDODS.app',
    'Then open it normally. “Damaged” means unsigned-and-quarantined, not corrupt.',
  ],
  windows: ['Run the .exe installer.', 'At the SmartScreen prompt choose More info → Run anyway.'],
  linux: [
    'Debian or Ubuntu: sudo apt install ./SDODS-*.deb — this is the recommended route.',
    'AppImage: chmod +x SDODS-*.AppImage, then run it.',
    'The AppImage runtime needs FUSE 2, which Ubuntu 22.04 and later no longer install by default. If it reports “Cannot mount AppImage”, install libfuse2t64 (Ubuntu 24.04) or libfuse2 (Ubuntu 22.04, Debian) — or just use the .deb, which has no such requirement.',
  ],
};

export function DownloadPicker() {
  const release = DESKTOP_RELEASE;
  const [detected, setDetected] = useState<DesktopAsset | null>(null);
  // Tracked separately from `detected`: a known platform with no matching asset is a withdrawn
  // build, and that visitor gets an explanation rather than an empty page.
  const [detectedPlatform, setDetectedPlatform] = useState<Platform | null>(null);
  // Server-render the full list, then narrow to a recommendation once the UA is readable. Nobody
  // sees an empty page while JavaScript loads, and no-JS visitors keep every download.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    // detectArch is async (getHighEntropyValues returns a promise) and may resolve to null on
    // Safari and Firefox, where detectAsset falls back to the per-platform default.
    void detectArch().then((arch) => {
      if (!live) return;
      const ua = navigator.userAgent || '';
      setDetected(detectAsset(release.assets, ua, arch));
      setDetectedPlatform(detectPlatform(ua));
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [release.assets]);

  // No assetBaseUrl means nothing is downloadable yet, whatever the tag says.
  if (!release.tag || !release.assetBaseUrl || release.assets.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-semibold">The desktop app is not released yet</h2>
        <p className="muted mt-3">
          Installers for macOS, Windows and Linux are built and waiting on their first tagged
          release. Until then, the one-line installer gives you the same SDODS from your terminal.
        </p>
        <div className="mt-5">
          <Link href="/install/" className="btn btn-primary">
            Install from the command line
          </Link>
        </div>
      </div>
    );
  }

  const notesUrl = releaseNotesUrl(release);
  const sums = checksumsUrl(release);
  const grouped = ORDER.map((platform) => ({
    platform,
    assets: release.assets.filter((a) => a.platform === platform),
  })).filter((g) => g.assets.length > 0);

  return (
    <div>
      {ready && !detected && detectedPlatform && WITHDRAWN[detectedPlatform] && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold">{WITHDRAWN[detectedPlatform]!.title}</h2>
          <p className="muted mt-3">{WITHDRAWN[detectedPlatform]!.body}</p>
          <div className="mt-5">
            <Link href="/install/" className="btn btn-primary">
              Install from the command line
            </Link>
          </div>
        </div>
      )}

      {ready && detected && (
        <div className="card p-6">
          <p className="muted text-sm">Recommended for this computer</p>
          <a
            href={downloadUrl(release, detected)}
            className="btn btn-primary mt-3 inline-block px-5 py-3 text-base"
          >
            Download for {PLATFORM_LABEL[detected.platform]} · {detected.label}
          </a>
          <p className="muted mt-3 text-sm">
            {detected.file} · {detected.size} · version {release.version}
          </p>
          {!release.signed && GATEKEEPER[detected.platform] && (
            <div className="mt-5 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="font-semibold">{GATEKEEPER[detected.platform]!.title}</p>
              <p className="muted mt-1">{GATEKEEPER[detected.platform]!.body}</p>
              {GATEKEEPER[detected.platform]!.command && (
                <pre className="mt-3 overflow-x-auto rounded bg-black/80 p-3 text-xs text-white">
                  <code>{GATEKEEPER[detected.platform]!.command}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <h2 className="mt-10 text-xl font-semibold">
        {ready && detected ? 'Every download' : 'Downloads'}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {grouped.map(({ platform, assets }) => (
          <div key={platform} className="card p-5">
            <h3 className="font-semibold">{PLATFORM_LABEL[platform]}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {assets.map((asset) => (
                <li key={asset.file}>
                  <a className="underline" href={downloadUrl(release, asset)}>
                    {asset.label}
                  </a>
                  <span className="muted"> · {asset.size}</span>
                </li>
              ))}
            </ul>
            <ol className="muted mt-4 list-decimal space-y-1 pl-4 text-xs">
              {INSTALL[platform].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {sums && (
        <p className="muted mt-6 text-sm">
          Every installer is listed in{' '}
          <a className="underline" href={sums}>
            SHA256SUMS.txt
          </a>
          . To check one before you run it:{' '}
          <code>shasum -a 256 -c SHA256SUMS.txt --ignore-missing</code> (Windows:{' '}
          <code>certutil -hashfile &lt;file&gt; SHA256</code>).
        </p>
      )}

      <p className="muted mt-3 text-sm">
        Version {release.version}
        {release.published ? `, released ${release.published}` : ''}
        {notesUrl && (
          <>
            {' · '}
            <a className="underline" href={notesUrl}>
              release notes and checksums
            </a>
          </>
        )}
      </p>
    </div>
  );
}
