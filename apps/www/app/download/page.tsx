import type { Metadata } from 'next';
import Link from 'next/link';
import { DownloadPicker } from '@/components/download-picker';
import { DOCS_URL } from '@/lib/links';

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

export default function DownloadPage() {
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
