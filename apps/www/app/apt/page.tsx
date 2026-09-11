import type { Metadata } from 'next';
import Link from 'next/link';
import { CommandRow } from '@/components/copy-button';
import { DESKTOP_PUBLIC, DOCS_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'SDODS apt repository',
  description:
    'The signed Debian package repository for the SDODS desktop app: add the key, add the source, then apt keeps it current.',
};

/**
 * A page at the apt repository's own address.
 *
 * apt reads /apt/dists/stable/InRelease and the per-architecture Packages beneath it, and never
 * asks for a directory listing — so this address used to 404 for the only visitor who would ever
 * type it: a person checking the repository is real before pointing their machine at it. Adding an
 * index answers that, and changes no path apt fetches.
 */

const SERVED: Array<[string, string]> = [
  [
    'dists/stable/InRelease',
    'The signed index. apt reads this first and verifies it against the key below.',
  ],
  [
    'dists/stable/Release · Release.gpg',
    'The same index with a detached signature, for older apt clients.',
  ],
  [
    'dists/stable/main/binary-{amd64,arm64}/Packages',
    'What is available for each architecture, with the size and SHA-256 of every package.',
  ],
  [
    'sdods-archive-keyring.gpg',
    'The public half of the signing key, in the binary form apt reads.',
  ],
];

/** Shown so a reader can check the key they installed is the one that signs this repository. */
const FINGERPRINT = 'D99D DCC3 AD1C 15D6 E20B  C961 BED3 7DAF 8308 7449';

/** The commands here are long enough to scroll out of view, so each one carries a copy button. */
function Command({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-3">
      <CommandRow command={children} label={label} />
    </div>
  );
}

export default function AptPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-extrabold tracking-tight">SDODS apt repository</h1>
      <p className="muted mt-4 text-lg">
        This address is a Debian package repository rather than a page — it is meant to be read by{' '}
        <code>apt</code>, not a browser. Point a Debian or Ubuntu machine at it and{' '}
        <code>apt upgrade</code> will keep the SDODS desktop app current.
      </p>

      <h2 className="mt-14 text-2xl font-bold tracking-tight">Add it</h2>
      <p className="muted mt-2">
        Three commands, run once. The key is dearmoured on the way in because apt reads binary
        keyrings, and an armoured file in that directory fails with an error that blames the
        signature rather than the format.
      </p>

      <h3 className="mt-8 font-semibold">1. Install the signing key</h3>
      <Command label="Install the SDODS signing key">
        {
          'curl -fsSL https://sdods.com/apt/sdods-archive-keyring.gpg | sudo tee /usr/share/keyrings/sdods-archive-keyring.gpg > /dev/null'
        }
      </Command>

      <h3 className="mt-8 font-semibold">2. Add the source</h3>
      <Command label="Add the SDODS apt source">
        {
          'echo "deb [signed-by=/usr/share/keyrings/sdods-archive-keyring.gpg] https://sdods.com/apt stable main" | sudo tee /etc/apt/sources.list.d/sdods.list'
        }
      </Command>
      <p className="muted mt-3 text-sm">
        One suite, <code>stable</code>, and one component, <code>main</code>. It is deliberately not
        a flat repository: a flat one is addressed with a <code>./</code> distribution, and every
        path apt then builds carries a <code>./</code> segment that this host answers with a
        redirect to nowhere.
      </p>

      <h3 className="mt-8 font-semibold">3. Install</h3>
      <Command label="Install SDODS from apt">
        {'sudo apt update && sudo apt install sdods'}
      </Command>

      <h2 className="mt-14 text-2xl font-bold tracking-tight">What is served here</h2>
      <dl className="mt-6 grid gap-4">
        {SERVED.map(([file, body]) => (
          <div key={file} className="card min-w-0 p-5">
            <dt className="font-semibold">
              <code>{file}</code>
            </dt>
            <dd className="muted mt-2 text-sm">{body}</dd>
          </div>
        ))}
      </dl>
      <p className="muted mt-4 text-sm">
        The <code>.deb</code> files themselves are not stored here. They are over a hundred
        megabytes each, so they stay on the public release and <code>pool/</code> redirects there.
        apt checks every download against the SHA-256 in <code>Packages</code>, so a package fetched
        through the redirect is verified exactly as one served directly would be.
      </p>

      <h2 className="mt-14 text-2xl font-bold tracking-tight">The signing key</h2>
      <p className="muted mt-2">
        Check that the key you installed is this one before trusting the repository:
      </p>
      <Command label="Show the installed key fingerprint">
        {'gpg --show-keys /usr/share/keyrings/sdods-archive-keyring.gpg'}
      </Command>
      <div className="card mt-4 min-w-0 p-5">
        <p className="text-sm font-semibold">SDODS (apt repository signing key)</p>
        <p className="muted mt-1 text-sm">admin@sdods.com · RSA 4096</p>
        <pre
          tabIndex={0}
          role="region"
          aria-label="Signing key fingerprint"
          className="mt-3 overflow-x-auto"
        >
          <code>{FINGERPRINT}</code>
        </pre>
      </div>

      <h2 className="mt-14 text-2xl font-bold tracking-tight">
        If you would rather not add a source
      </h2>
      <p className="muted mt-2">
        A single <code>.deb</code> installs the same application and never updates itself.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {/* Points at the download page only while one is offered -- see DESKTOP_PUBLIC. */}
        <Link className="btn btn-primary" href={DESKTOP_PUBLIC ? '/download' : '/install'}>
          {DESKTOP_PUBLIC ? 'Download the app' : 'Install SDODS'}
        </Link>
        <Link className="btn btn-secondary" href="/install">
          Other install methods
        </Link>
        <a
          className="btn btn-secondary"
          href={`${DOCS_URL}/docs/getting-started/installation/#with-a-package-manager`}
        >
          Package manager docs
        </a>
      </div>
    </div>
  );
}
