import type { Metadata } from 'next';
import Link from 'next/link';
import { TAGS, TAG_COUNTS } from '@sdods/qa-archive';

export const metadata: Metadata = {
  title: 'Tags',
  description: 'Every subject questions here are filed under, and how many there are of each.',
};

export default function TagsPage() {
  const sorted = [...TAGS].sort((a, b) => (TAG_COUNTS[b.name] ?? 0) - (TAG_COUNTS[a.name] ?? 0));
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/" className="underline">
          ← All questions
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Tags</h1>
      <p className="muted mt-3 max-w-2xl">
        A tag is either one a scenario carries — <code>@ui</code>, <code>@smoke</code>,{' '}
        <code>@har</code> — or the subject a question is about. Both live in the same list, so the
        filter reads in the vocabulary you already write in.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((t) => (
          <li key={t.name} className="card p-4">
            <Link
              href={`/questions/tags/${t.name}/`}
              className="inline-block rounded bg-[var(--brand)]/10 px-2 py-0.5 text-sm font-medium text-[var(--brand)] hover:bg-[var(--brand)]/20"
            >
              {t.name}
            </Link>
            <p className="muted mt-2 text-xs leading-relaxed">{t.blurb}</p>
            <p className="muted mt-2 text-xs tabular-nums">
              {TAG_COUNTS[t.name] ?? 0} question{(TAG_COUNTS[t.name] ?? 0) === 1 ? '' : 's'}
              {t.scenarioTag && <span className="ml-2">· written @{t.name} in Gherkin</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
