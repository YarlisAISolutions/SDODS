'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DESKTOP_RELEASE,
  PLATFORM_LABEL,
  detectArch,
  detectAsset,
  downloadUrl,
  releaseNotesUrl,
  type DesktopAsset,
  type Platform,
} from '@/lib/desktop-release';

const ORDER: Platform[] = ['macos', 'windows', 'linux'];

/** What an unsigned build does on first launch, and the exact way past it. */
const GATEKEEPER: Record<Platform, { title: string; body: string } | null> = {
  macos: {
    title: 'macOS will not open it on a double-click',
    body: 'Right-click (or Control-click) SDODS in Applications and choose Open, then confirm. macOS remembers the choice, so this is a one-time step.',
  },
  windows: {
    title: 'Windows shows a SmartScreen warning',
    body: 'Choose “More info”, then “Run anyway”. The warning appears because the installer is not yet signed, not because anything is wrong with the download.',
  },
  linux: null,
};

export function DownloadPicker() {
  const release = DESKTOP_RELEASE;
  const [detected, setDetected] = useState<DesktopAsset | null>(null);
  // Server-render the full list, then narrow to a recommendation once the UA is readable. Nobody
  // sees an empty page while JavaScript loads, and no-JS visitors keep every download.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    // detectArch is async (getHighEntropyValues returns a promise) and may resolve to null on
    // Safari and Firefox, where detectAsset falls back to the per-platform default.
    void detectArch().then((arch) => {
      if (!live) return;
      setDetected(detectAsset(release.assets, navigator.userAgent || '', arch));
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
  const grouped = ORDER.map((platform) => ({
    platform,
    assets: release.assets.filter((a) => a.platform === platform),
  })).filter((g) => g.assets.length > 0);

  return (
    <div>
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
          </div>
        ))}
      </div>

      <p className="muted mt-6 text-sm">
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
