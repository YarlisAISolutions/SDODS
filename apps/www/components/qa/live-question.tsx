'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { QaBody } from '@/components/qa/qa-body';
import { VoteControl } from '@/components/qa/votes';
import { EditPost, RevisionHistory } from '@/components/qa/phase3';
import {
  CommunityAnswerCount,
  CommunityAnswers,
  PostMeta,
  ThreadCommunityProvider,
} from '@/components/qa/thread-community';
import { formatDate } from '@/lib/qa-list';
import type { Question } from '@/lib/questions';

/**
 * Reads one published question and its published answers straight from Firestore. Pending documents
 * are not filtered out here — the rules refuse to return them at all — so nothing unmoderated can
 * reach this component.
 */
export function LiveQuestion() {
  const id = useSearchParams().get('id');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; question: Question | null } | { kind: 'error' }
  >({ kind: 'loading' });

  useEffect(() => {
    if (!id) {
      setState({ kind: 'ready', question: null });
      return;
    }
    let cancelled = false;
    import('@/lib/questions')
      .then(({ listQuestions }) => listQuestions())
      .then((questions) => {
        if (cancelled) return;
        setState({ kind: 'ready', question: questions.find((q) => q.id === id) ?? null });
      })
      .catch(() => !cancelled && setState({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.kind === 'loading') {
    return (
      <p role="status" className="muted text-sm">
        Loading the question…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <p role="status" className="muted text-sm">
        That question could not be loaded right now.{' '}
        <Link href="/questions/" className="underline">
          Back to all questions
        </Link>
        .
      </p>
    );
  }

  if (!state.question) {
    return (
      <div className="card p-6">
        <p className="font-medium">That question is not here.</p>
        <p className="muted mt-1 text-sm">
          It may still be waiting to be reviewed, or the link may be wrong.
        </p>
        <Link href="/questions/" className="btn btn-secondary mt-4">
          All questions
        </Link>
      </div>
    );
  }

  const q = state.question;
  const asked = q.createdAt ? q.createdAt.toISOString().slice(0, 10) : null;

  return (
    <article>
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{q.title}</h1>
      <p className="muted mt-2 text-xs">
        Asked by {q.name}
        {asked && (
          <>
            {' · '}
            <time dateTime={asked}>{formatDate(asked)}</time>
          </>
        )}
        {' · '}
        <span className="rounded bg-[var(--brand)]/10 px-1.5 py-0.5 text-[var(--brand)]">
          {q.category}
        </span>
      </p>

      <ThreadCommunityProvider
        questionId={q.id}
        answers={q.answers}
        askerUid={q.uid}
        acceptedAnswerId={q.acceptedAnswerId}
      >
        <div className="mt-6 flex gap-4 border-t border-[var(--line)] pt-6">
          <div className="shrink-0 pt-1">
            <VoteControl path={`questions/${q.id}`} score={q.score} />
          </div>
          <div className="min-w-0 flex-1">
            <QaBody body={q.body} />
            <RevisionHistory path={`questions/${q.id}`} revision={q.revision} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <EditPost
                path={`questions/${q.id}`}
                kind="question"
                title={q.title}
                body={q.body}
                revision={q.revision}
              />
              <PostMeta post={{ uid: q.uid, name: q.name, createdAt: q.createdAt }} />
            </div>
          </div>
        </div>

        <h2 className="mt-10 text-lg font-bold">
          <CommunityAnswerCount base={0} />
        </h2>
        <CommunityAnswers />
      </ThreadCommunityProvider>
    </article>
  );
}
