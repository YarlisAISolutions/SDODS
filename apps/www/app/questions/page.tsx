import type { Metadata } from 'next';
import Link from 'next/link';
import { PEOPLE, SUMMARIES, TAG_COUNTS, TAG_NAMES, avatarHue, initials } from '@sdods/qa-archive';
import { ExampleNotice } from '@/components/qa/bits';
import { QaBrowser } from '@/components/qa/qa-browser';
import type { ListItem, PersonChip } from '@/lib/qa-list';

export const metadata: Metadata = {
  title: 'Questions',
  description:
    'Ask a question about SDODS, and search worked examples of common problems: scenarios, running suites, test data, locators and wiring it into CI.',
};

/**
 * The list is rendered on the server from the archive, so the newest questions are in the HTML for
 * anyone arriving from a search engine. The browser island takes over from there for search,
 * filtering and the live questions, and fetches what it needs rather than being handed it.
 */
export default function QuestionsPage() {
  const initial: ListItem[] = SUMMARIES.slice(0, 30).map((s) => ({
    key: `archive:${s.slug}`,
    source: 'archive',
    href: `/questions/${s.slug}/`,
    slug: s.slug,
    title: s.title,
    excerpt: s.excerpt,
    author: s.askedBy,
    date: s.askedOn,
    tags: s.tags,
    votes: s.votes,
    answers: s.answers,
    accepted: s.accepted,
    views: s.views,
  }));

  // Only what a row needs to draw a byline: 44 small records, not the cast.
  const people: Record<string, PersonChip> = Object.fromEntries(
    PEOPLE.map((p) => [
      p.handle,
      {
        handle: p.handle,
        display: p.display,
        maintainer: p.role === 'maintainer',
        hue: avatarHue(p.handle),
        initials: initials(p.display),
      },
    ]),
  );

  const tags = [...TAG_NAMES].sort((a, b) => (TAG_COUNTS[b] ?? 0) - (TAG_COUNTS[a] ?? 0));

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Questions</h1>
          <p className="muted mt-3 max-w-2xl">
            Anything about writing scenarios, running suites, test data, locators or wiring SDODS
            into CI. Search it before you ask — most errors have been hit before.
          </p>
        </div>
        <Link href="/questions/ask/" className="btn btn-primary shrink-0">
          Ask a question
        </Link>
      </div>

      <nav className="muted mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/questions/tags/" className="underline">
          Browse {TAG_NAMES.length} tags
        </Link>
        <Link href="/questions/users/" className="underline">
          People
        </Link>
        <Link href="/questions/use-cases/" className="underline">
          Use cases
        </Link>
      </nav>

      <div className="mt-6">
        <ExampleNotice />
      </div>

      <QaBrowser initial={initial} total={SUMMARIES.length} tags={tags} people={people} />

      <p className="muted mt-10 text-sm">
        New questions are reviewed before they appear. Found a bug or want a feature instead?{' '}
        <Link href="/feedback/" className="underline">
          Send feedback
        </Link>
        .
      </p>
    </div>
  );
}
