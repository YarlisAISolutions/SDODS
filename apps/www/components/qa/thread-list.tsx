import Link from 'next/link';
import type { Thread } from '@sdods/qa-archive';
import { ThreadRow } from '@/components/qa/thread-row';

/** Above this, a page switches to compact lines. A full row is ~5 kB of markup; a line is ~150 B. */
const FULL_ROWS = 25;

/** Splitting to save eight rows is not worth an "Earlier (1)" heading, so the split has a floor. */
const WORTH_SPLITTING = FULL_ROWS + 8;

/**
 * A list of threads that stays a sensible size.
 *
 * The busiest tag carries 117 questions. Rendering all of them as full rows produced a 637 kB HTML
 * page — slow to load, and most of it repeated class attributes rather than content. So the newest
 * are rendered in full and the remainder as titles: every thread is still linked from the page, so
 * a crawler reaches all of them and nothing is hidden behind a control, but the page is a tenth of
 * the size.
 */
export function ThreadList({ threads, activeTag }: { threads: Thread[]; activeTag?: string }) {
  const split = threads.length > WORTH_SPLITTING;
  const full = split ? threads.slice(0, FULL_ROWS) : threads;
  const rest = split ? threads.slice(FULL_ROWS) : [];

  return (
    <>
      <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {full.map((t) => (
          <ThreadRow key={t.slug} thread={t} activeTag={activeTag} />
        ))}
      </ul>

      {rest.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide">Earlier ({rest.length})</h2>
          <ul className="mt-3 space-y-1.5">
            {rest.map((t) => (
              <li key={t.slug} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <Link href={`/questions/${t.slug}/`} className="hover:underline">
                  {t.title}
                </Link>
                <span className="muted text-xs tabular-nums">
                  {t.answers.length} {t.answers.length === 1 ? 'answer' : 'answers'}
                  {t.acceptedAnswerId && <span className="ml-1 text-emerald-600">✓</span>}
                  {' · '}
                  {t.askedOn.slice(0, 4)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
