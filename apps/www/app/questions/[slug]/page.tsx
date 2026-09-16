import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { excerpt, person, THREADS, thread } from '@sdods/qa-archive';
import { QaBody } from '@/components/qa/qa-body';
import { Byline, Stat, TagChip, formatDate } from '@/components/qa/bits';
import {
  CommunityAnswerCount,
  CommunityAnswers,
  ReplyThread,
  ThreadCommunityProvider,
} from '@/components/qa/thread-community';

/**
 * One question and its answers, rendered statically, with answers and replies posted on the site
 * layered on top from Firestore (see `ThreadCommunityProvider`).
 *
 * `dynamicParams = false` is what makes a mistyped slug a build error rather than a page that only
 * fails in production: under `output: 'export'` there is no server to fall back to.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return THREADS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const t = thread(slug);
  if (!t) return {};
  return {
    title: t.title,
    description: excerpt(t.body, 155),
    openGraph: { title: t.title, description: excerpt(t.body, 155), type: 'article' },
  };
}

export default async function ThreadPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const t = thread(slug);
  if (!t) notFound();

  const answers = [...t.answers].sort((a, b) => {
    // The accepted answer leads, then the rest oldest first — the order a reader wants, not the
    // order they were written.
    if (a.id === t.acceptedAnswerId) return -1;
    if (b.id === t.acceptedAnswerId) return 1;
    return a.on.localeCompare(b.on);
  });

  const related = THREADS.filter(
    (o) => o.slug !== t.slug && o.tags.some((tag) => t.tags.includes(tag)),
  ).slice(0, 5);

  return (
    <ThreadCommunityProvider slug={t.slug}>
      <div className="mx-auto max-w-4xl px-4 py-12">
        <p className="muted mb-4 text-sm">
          <Link href="/questions/" className="underline">
            ← All questions
          </Link>
        </p>

        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{t.title}</h1>
        <div className="muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>
            Asked <time dateTime={t.askedOn}>{formatDate(t.askedOn)}</time>
          </span>
          <span>{t.views.toLocaleString()} views</span>
          <span>
            {t.answers.length} {t.answers.length === 1 ? 'answer' : 'answers'}
          </span>
        </div>

        <article className="mt-6 flex gap-4 border-t border-[var(--line)] pt-6">
          <div className="muted hidden shrink-0 flex-col items-center gap-3 pt-1 text-xs sm:flex">
            <Stat n={t.votes} label="votes" />
          </div>
          <div className="min-w-0 flex-1">
            <QaBody body={t.body} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {t.tags.map((tag) => (
                  <TagChip key={tag} name={tag} />
                ))}
              </div>
              <Byline handle={t.askedBy} date={t.askedOn} action="asked by" />
            </div>
          </div>
        </article>

        <h2 className="mt-10 text-lg font-bold">
          <CommunityAnswerCount base={answers.length} />
        </h2>

        <ul className="mt-4 space-y-6">
          {answers.map((a) => {
            const accepted = a.id === t.acceptedAnswerId;
            return (
              <li
                key={a.id}
                id={a.id}
                className={`flex gap-4 rounded-lg border p-4 ${
                  accepted
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-[var(--line)] bg-transparent'
                }`}
              >
                <div className="muted hidden shrink-0 flex-col items-center gap-2 pt-1 text-xs sm:flex">
                  <Stat n={a.votes} label="votes" strong={accepted} />
                  {accepted && (
                    <span
                      className="text-emerald-600"
                      title="Accepted answer"
                      aria-label="Accepted"
                    >
                      ✓
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {accepted && (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">
                      Accepted answer
                    </p>
                  )}
                  <QaBody body={a.body} />
                  <div className="mt-3 flex justify-end">
                    <Byline handle={a.by} date={a.on} action="answered by" />
                  </div>
                  <ReplyThread parentId={a.id} parentName={person(a.by)?.display ?? a.by} />
                </div>
              </li>
            );
          })}
        </ul>

        <CommunityAnswers showAskLink />

        {related.length > 0 && (
          <section className="mt-10 border-t border-[var(--line)] pt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide">Related</h2>
            <ul className="mt-3 space-y-2">
              {related.map((r) => (
                <li key={r.slug} className="text-sm">
                  <Link href={`/questions/${r.slug}/`} className="hover:underline">
                    {r.title}
                  </Link>
                  <span className="muted ml-2 text-xs">
                    {r.answers.length} {r.answers.length === 1 ? 'answer' : 'answers'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ThreadCommunityProvider>
  );
}
