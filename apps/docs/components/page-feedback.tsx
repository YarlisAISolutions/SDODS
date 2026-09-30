'use client';

import { useState } from 'react';
import { FEEDBACK_URL } from '@/lib/links';
import { PAGE_FEEDBACK_ENABLED, recordPageFeedback, type Verdict } from '@/lib/page-feedback';

const BTN = 'rounded-md border border-fd-border px-3 py-1 text-sm hover:bg-fd-accent';

/**
 * Per-page footer: "Was this page helpful?" plus a link to the full feedback
 * form. A vote is stored directly — this used to open a prefilled email, which
 * silently reached nobody when the reader had no mail client configured.
 *
 * Saying No opens a small box for what was missing, because a bare downvote
 * tells you a page is wrong but never why.
 */
export function PageFeedback({ path, title }: { path: string; title: string }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(v: Verdict, text: string) {
    setBusy(true);
    try {
      await recordPageFeedback({ path, title, verdict: v, note: text });
      setDone(true);
    } catch {
      // A failed vote is not worth interrupting the reader over; the link to
      // the full feedback form is right there.
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  function choose(v: Verdict) {
    setVerdict(v);
    if (v === 'helpful') void send(v, '');
  }

  return (
    <aside
      aria-label="Page feedback"
      className="mt-12 rounded-lg border border-fd-border bg-fd-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        {!PAGE_FEEDBACK_ENABLED ? null : done ? (
          <span role="status" className="font-medium">
            Thanks — noted.
          </span>
        ) : (
          <>
            <span className="font-medium">Was this page helpful?</span>
            <button
              type="button"
              className={BTN}
              onClick={() => choose('helpful')}
              disabled={busy}
              aria-pressed={verdict === 'helpful'}
            >
              Yes
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => choose('not-helpful')}
              disabled={busy}
              aria-pressed={verdict === 'not-helpful'}
            >
              No
            </button>
          </>
        )}
        <a className="ml-auto text-fd-muted-foreground underline" href={FEEDBACK_URL}>
          Request a feature
        </a>
      </div>

      {verdict === 'not-helpful' && !done && (
        <div className="mt-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">What was missing or wrong?</span>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              className="w-full rounded-md border border-fd-border bg-fd-background p-2 text-sm"
              placeholder="Optional, but it is the part that helps."
            />
          </label>
          <button
            type="button"
            className={`${BTN} mt-2`}
            onClick={() => void send('not-helpful', note)}
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
    </aside>
  );
}
