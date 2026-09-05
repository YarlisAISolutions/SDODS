import type { Metadata } from 'next';
import Link from 'next/link';
import { QuestionList } from '@/components/question-list';

export const metadata: Metadata = {
  title: 'Questions',
  description:
    'Ask a question about SDODS and read what other people have asked. Answers from the maintainers.',
};

export default function QuestionsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Questions</h1>
          <p className="muted mt-3 max-w-2xl">
            Anything about writing scenarios, running suites, test data or wiring SDODS into CI.
            Questions are reviewed before they appear, so the page stays readable.
          </p>
        </div>
        <Link href="/questions/ask/" className="btn btn-primary shrink-0">
          Ask a question
        </Link>
      </div>

      <QuestionList />

      <p className="muted mt-10 text-sm">
        Found a bug or want a feature instead?{' '}
        <Link href="/feedback/" className="underline">
          Send feedback
        </Link>
        .
      </p>
    </div>
  );
}
