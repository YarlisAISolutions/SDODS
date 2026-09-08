'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { QaBody } from '@/components/qa/qa-body';
import { AnswerForm } from '@/components/qa/answer-form';
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

      <div className="mt-6 border-t border-[var(--line)] pt-6">
        <QaBody body={q.body} />
      </div>

      <h2 className="mt-10 text-lg font-bold">
        {q.answers.length === 0
          ? 'No answers yet'
          : `${q.answers.length} ${q.answers.length === 1 ? 'answer' : 'answers'}`}
      </h2>
      <ul className="mt-4 space-y-6">
        {q.answers.map((a) => (
          <li key={a.id} className="rounded-lg border border-[var(--line)] p-4">
            <QaBody body={a.body} />
            <p className="muted mt-2 text-xs">
              {a.name}
              {a.createdAt && ` · ${formatDate(a.createdAt.toISOString().slice(0, 10))}`}
            </p>
          </li>
        ))}
      </ul>

      <AnswerForm questionId={q.id} />
    </article>
  );
}
