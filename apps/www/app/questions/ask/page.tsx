import type { Metadata } from 'next';
import Link from 'next/link';
import { AskForm } from '@/components/ask-form';

export const metadata: Metadata = {
  title: 'Ask a question',
  description: 'Ask the SDODS maintainers a question. Reviewed before it appears publicly.',
};

export default function AskPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <p className="muted mb-3 text-sm">
        <Link href="/questions/" className="underline">
          ← All questions
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Ask a question</h1>
      <p className="muted mb-8 mt-3 max-w-2xl">
        The more concrete the better: the command you ran, what you expected and what actually
        happened. Your question is reviewed before it appears publicly, and your email is only used
        to reply.
      </p>
      <AskForm />
    </div>
  );
}
