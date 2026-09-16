import type { Metadata } from 'next';
import { Moderation } from '@/components/qa/moderation';

/**
 * Where pending questions, answers and replies are approved or rejected.
 *
 * Not linked from anywhere, not in the sitemap, and not indexed — but none of that is the protection.
 * The page is a static shell anyone can load; what it can read and change is decided by
 * `firestore.rules`, which only let the moderator account see pending posts or publish them.
 */
export const metadata: Metadata = {
  title: 'Moderate questions',
  robots: { index: false, follow: false },
};

export default function ModeratePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Moderate questions</h1>
      <p className="muted mt-2 text-sm">
        Everything posted on the site waits here until it is approved. Approved posts appear on
        their page straight away; rejected ones are deleted.
      </p>
      <Moderation />
    </div>
  );
}
