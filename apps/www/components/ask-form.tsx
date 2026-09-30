'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CATEGORIES, type Category } from '@/lib/questions';
import { COMMUNITY_ENABLED, postQuestion, type PostResult } from '@/lib/community';
import { ReviewOutcome, SignInGate, useUser } from '@/components/qa/community';

const MAX_TITLE = 200;

/**
 * Questions are posted signed in, through the community service, and reviewed on arrival. A build
 * without the service has nowhere to post to. Chosen at build time.
 */
export const AskForm = COMMUNITY_ENABLED ? CommunityAskForm : AskUnavailable;

const MIN_TITLE = 10;
const MIN_BODY = 20;
const MAX_REVIEWED_BODY = 10_000;

/** Signed-in posting: the review publishes, rejects with a reason, or passes it to an editor. */
function CommunityAskForm() {
  const user = useUser();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('ui');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PostResult | null>(null);

  if (result) {
    return (
      <div className="card grid gap-4 p-6">
        <ReviewOutcome
          result={result}
          kind="question"
          publishedHref={`/questions/live/?id=${result.id}`}
        />
        <div className="flex flex-wrap gap-3">
          <Link href="/questions/" className="btn btn-secondary">
            Back to questions
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              // A rejected question keeps its text so the author can fix it and try again.
              if (result.status !== 'rejected') {
                setTitle('');
                setBody('');
              }
              setResult(null);
              setState('idle');
            }}
          >
            {result.status === 'rejected' ? 'Edit and try again' : 'Ask another'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <SignInGate user={user}>
        <form
          className="grid gap-4"
          aria-label="Ask a question"
          aria-busy={state === 'sending'}
          onSubmit={async (e) => {
            e.preventDefault();
            setState('sending');
            try {
              setResult(await postQuestion({ title, body, category }));
              setState('idle');
            } catch (err) {
              setError((err as Error).message);
              setState('error');
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Question</span>
              <input
                required
                minLength={MIN_TITLE}
                maxLength={MAX_TITLE}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="One line — what are you trying to do with SDODS?"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">About</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Details</span>
            <textarea
              required
              rows={10}
              minLength={MIN_BODY}
              maxLength={MAX_REVIEWED_BODY}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="The sdods command you ran, what happened, and what you expected. Paste the error. Keys and passwords are masked automatically, but leave them out if you can."
            />
            <span className="muted mt-1 block text-xs tabular-nums">
              {body.length} / {MAX_REVIEWED_BODY.toLocaleString('en')}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Reviewing…' : 'Post question'}
            </button>
            <span className="muted text-xs">
              Checked on arrival: questions about SDODS are published straight away.
            </span>
          </div>
          {state === 'error' && (
            <p className="text-sm" role="alert">
              {error}
            </p>
          )}
        </form>
      </SignInGate>
    </div>
  );
}

/** A build with no community service configured: nowhere to post to. */
function AskUnavailable() {
  return (
    <div className="card p-6" role="status">
      <p className="text-sm">
        Posting questions is not available on this build of the site. Browse the{' '}
        <Link href="/questions/" className="underline">
          answered questions
        </Link>
        , or open a discussion on GitHub.
      </p>
    </div>
  );
}
