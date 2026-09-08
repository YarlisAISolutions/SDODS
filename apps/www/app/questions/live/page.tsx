import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveQuestion } from '@/components/qa/live-question';

/**
 * A question submitted through the site, rather than one from the archive.
 *
 * These cannot have a page of their own: the site is a static export, and a document that does not
 * exist at build time has no route to generate. So there is one client page and the id travels in
 * the query string — which also means the page is empty at build, and an empty indexed page is a
 * liability, hence `robots: noindex`. It is deliberately absent from the sitemap for the same reason.
 */
export const metadata: Metadata = {
  title: 'Question',
  robots: { index: false, follow: true },
};

export default function LiveQuestionPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/" className="underline">
          ← All questions
        </Link>
      </p>
      {/* useSearchParams needs a Suspense boundary on a prerendered route, or the build fails. */}
      <Suspense fallback={<p className="muted text-sm">Loading…</p>}>
        <LiveQuestion />
      </Suspense>
    </div>
  );
}
