import type { Metadata } from 'next';
import { EditorQueue } from '@/components/qa/editor-queue';
import { COMMUNITY_ENABLED } from '@/lib/community';

/**
 * Where pending questions, answers and replies are approved or rejected.
 *
 * Not linked from anywhere, not in the sitemap, and not indexed — but none of that is the protection.
 * The page is a static shell anyone can load; the community service decides what it can read and
 * change, and only answers editors and admins.
 */
export const metadata: Metadata = {
  title: 'Moderate questions',
  robots: { index: false, follow: false },
};

export default function ModeratePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Moderate questions</h1>
      {COMMUNITY_ENABLED ? (
        <>
          <p className="muted mt-2 text-sm">
            The AI review publishes clear SDODS posts and rejects clearly off-topic ones on arrival.
            What it could not decide waits here for an editor.
          </p>
          <EditorQueue />
        </>
      ) : (
        <p className="muted mt-2 text-sm">
          Moderation needs the community service, which is not configured for this build.
        </p>
      )}
    </div>
  );
}
