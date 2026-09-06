'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CATEGORIES, listQuestions, type Question } from '@/lib/questions';

const categoryLabel = (value: string) =>
  CATEGORIES.find((c) => c.value === value)?.label ?? 'Something else';

function when(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Reads published questions in the browser. The site is a static export, so
 * there is no server render of this list; it fetches on mount.
 */
export function QuestionList() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; questions: Question[] } | { kind: 'error' }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    listQuestions()
      .then((questions) => !cancelled && setState({ kind: 'ready', questions }))
      .catch(() => !cancelled && setState({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <p role="status" className="muted mt-8 text-sm">
        Loading questions…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <p role="status" className="muted mt-8 text-sm">
        Questions could not be loaded right now. You can still{' '}
        <Link href="/questions/ask/" className="underline">
          ask one
        </Link>
        .
      </p>
    );
  }

  if (state.questions.length === 0) {
    return (
      <div className="card mt-8 p-6 text-center">
        <p className="font-medium">No questions yet.</p>
        <p className="muted mt-1 text-sm">
          Be the first — anything about writing scenarios, running suites or wiring SDODS into CI.
        </p>
        <Link href="/questions/ask/" className="btn btn-primary mt-4">
          Ask the first question
        </Link>
      </div>
    );
  }

  return (
    <ul className="mt-8 space-y-4">
      {state.questions.map((q) => (
        <li key={q.id} className="card p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-semibold">{q.title}</h2>
            <span className="muted text-xs">
              {categoryLabel(q.category)}
              {q.createdAt ? ` · ${when(q.createdAt)}` : ''}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{q.body}</p>
          <p className="muted mt-2 text-xs">Asked by {q.name}</p>

          {q.answers.length > 0 && (
            <ul className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
              {q.answers.map((a) => (
                <li key={a.id}>
                  <p className="whitespace-pre-wrap text-sm">{a.body}</p>
                  <p className="muted mt-1 text-xs">
                    {a.name}
                    {a.createdAt ? ` · ${when(a.createdAt)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
