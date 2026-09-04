import type { Metadata } from 'next';
import Link from 'next/link';
import { NEXT_UP, ROADMAP, VERIFICATION } from '@/lib/roadmap';
import { DOCS_URL, REPO_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'SDODS delivery phases, verification numbers and what comes next.',
};

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Roadmap</h1>
      <p className="muted mt-3 max-w-2xl">
        SDODS was delivered in fourteen phases, each ending runnable and verified. The table below
        mirrors the README and the docs; the “next up” list is shaped by your feedback.
      </p>
      <div className="card mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-[var(--line)]">
              <th className="p-3">Phase</th>
              <th className="p-3">Scope</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {ROADMAP.map((r) => (
              <tr key={r.phase} className="border-b border-[var(--line)] last:border-0">
                <td className="p-3 font-mono">{r.phase}</td>
                <td className="p-3">{r.scope}</td>
                <td className="p-3">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-12 text-xl font-bold">Verification</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {VERIFICATION.map(([k, v]) => (
          <li key={k} className="card flex justify-between gap-4 px-4 py-3 text-sm">
            <span className="muted">{k}</span>
            <span className="font-semibold">{v}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-12 text-xl font-bold">Next up</h2>
      <ul className="muted mt-3 list-disc space-y-1 pl-5 text-sm">
        {NEXT_UP.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/feedback/" className="btn btn-primary">
          Request a feature
        </Link>
        <a href={`${DOCS_URL}/docs/roadmap/`} className="btn btn-secondary">
          Roadmap in the docs
        </a>
        <a
          href={`${REPO_URL}/issues?q=is%3Aissue+label%3Aenhancement`}
          className="btn btn-secondary"
          rel="noreferrer"
        >
          Open feature requests
        </a>
      </div>
    </div>
  );
}
