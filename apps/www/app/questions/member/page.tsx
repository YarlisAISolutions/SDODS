import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MemberProfile } from '@/components/qa/phase3';

/**
 * A community member's reputation and badges. Like a live question, a member who signed up after
 * the build has no route of their own on a static export, so the uid travels in the query string,
 * and an empty-at-build page stays out of search results.
 */
export const metadata: Metadata = {
  title: 'Member',
  robots: { index: false, follow: true },
};

export default function MemberPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/" className="underline">
          ← All questions
        </Link>
      </p>
      {/* useSearchParams needs a Suspense boundary on a prerendered route, or the build fails. */}
      <Suspense fallback={<p className="muted text-sm">Loading…</p>}>
        <MemberProfile />
      </Suspense>
    </div>
  );
}
