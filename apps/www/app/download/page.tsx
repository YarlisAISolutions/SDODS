import type { Metadata } from 'next';
import Link from 'next/link';
import { DownloadPicker } from '@/components/download-picker';
import { DOCS_URL } from '@/lib/links';
import { DESKTOP_PUBLIC } from '@/lib/desktop-release';

export const metadata: Metadata = {
  title: 'Download SDODS',
  description:
    'The SDODS desktop app for macOS, Windows and Linux. It installs its own dependencies on first launch and opens straight to your dashboard.',
};

const STEPS: Array<[string, string]> = [
  [
    'Open it',
    'The app installs SDODS into a workspace it manages for you. Nothing else needs to be on your machine — not even Node.',
  ],
  [
    'Write and run tests',
    'The dashboard is the full SDODS web UI: projects, features, runs and results, all served locally from your own machine.',
  ],
  [
    'Stay current',
    'When a newer SDODS is published, the app offers a one-click update and restarts itself. Your workspace and results are untouched.',
  ],
];

/**
 * The route survives even while the desktop app is hidden.
 *
 * It has been linked from the header, the 404 page, the apt page and the sitemap, and people
 * bookmark download pages. A 404 would punish them for our funding timeline; this says what is
 * true and points at the install that works.
 */
function DesktopHidden() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-4xl font-extrabold tracking-tight">
        The desktop app is not available yet
      </h1>
      <p className="muted mt-4 text-lg">
        It is built and it works — but the installers are not code-signed yet, so macOS reports them
        as malware and Windows blocks them behind SmartScreen. Rather than ask you to click past
        warnings that exist for good reasons, we are holding the download until the builds are
        signed.
      </p>
      <p className="muted mt-4">
        The command-line install is the same SDODS, it is complete, and nothing blocks it. It takes
        one command.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/install/" className="btn btn-primary">
          Install SDODS
        </Link>
        <a className="btn btn-secondary" href={`${DOCS_URL}/docs/getting-started/installation/`}>
          Read the installation docs
        </a>
      </div>
    </div>
  );
}

export default function DownloadPage() {
  if (!DESKTOP_PUBLIC) return <DesktopHidden />;
  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-extrabold tracking-tight">Download SDODS</h1>
      <p className="muted mt-4 text-lg">
        The desktop app installs everything it needs the first time you open it, then opens straight
        to your dashboard. No terminal, no prerequisites.
      </p>

      <div className="mt-8">
        <DownloadPicker />
      </div>

      <h2 className="mt-14 text-2xl font-bold tracking-tight">What happens after you install</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {STEPS.map(([title, body]) => (
          <div key={title} className="card p-5">
            <h3 className="font-semibold">{title}</h3>
            <p className="muted mt-2 text-sm">{body}</p>
          </div>
        ))}
      </div>

      <div className="card mt-10 p-6">
        <h2 className="text-xl font-semibold">Prefer the command line?</h2>
        <p className="muted mt-2">
          The desktop app and the CLI are the same SDODS. If you live in a terminal, or you are
          setting up CI, install it with one command instead — that is still the right answer for
          servers and pipelines.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/install/" className="btn btn-secondary">
            Install from the command line
          </Link>
          <a className="btn btn-secondary" href={`${DOCS_URL}/docs/getting-started/installation/`}>
            Read the installation docs
          </a>
        </div>
      </div>
    </div>
  );
}
