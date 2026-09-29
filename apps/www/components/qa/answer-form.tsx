'use client';

import { useState } from 'react';
import type { AnswerTarget } from '@/lib/questions';
import { COMMUNITY_ENABLED, postAnswer, type PostResult } from '@/lib/community';
import { ReviewOutcome, SignInGate, useUser } from '@/components/qa/community';

const MAX_BODY = 5000;

/**
 * Answer a question, or reply to an answer.
 *
 * Works for both halves of the Q&A: a live Firestore question and a static archive thread (by slug).
 * Whatever is posted is stored `pending` and is invisible — to this site included — until a moderator
 * publishes it, so nothing here can put text in front of a reader on its own. Firestore is imported
 * on submit, so a page that only shows the form does not pay for the SDK up front.
 */
type AnswerFormProps = {
  target: AnswerTarget;
  /** Set for a reply: the answer it belongs under. */
  parentId?: string;
  /** Display name being replied to; the body starts with `@name`. */
  replyTo?: string;
  onCancel?: () => void;
};

/** Signed in and reviewed on arrival when the community service is configured; chosen at build time. */
export const AnswerForm = COMMUNITY_ENABLED ? CommunityAnswerForm : LegacyAnswerForm;

const MAX_REVIEWED_BODY = 10_000;

function CommunityAnswerForm({ target, parentId, replyTo, onCancel }: AnswerFormProps) {
  const reply = parentId !== undefined;
  const user = useUser();
  const [body, setBody] = useState(replyTo ? `@${replyTo} ` : '');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PostResult | null>(null);
  const frame = reply ? 'mt-3 rounded-lg border border-[var(--line)] p-4' : 'card mt-10 p-6';

  if (result) {
    return (
      <div className={frame}>
        <ReviewOutcome result={result} kind={reply ? 'reply' : 'answer'} />
        {result.status === 'published' && (
          <p className="muted mt-2 text-xs">Reload the page to see it in place.</p>
        )}
        {result.status === 'rejected' && (
          <button
            type="button"
            className="btn btn-secondary mt-3"
            onClick={() => {
              setResult(null);
              setState('idle');
            }}
          >
            Edit and try again
          </button>
        )}
      </div>
    );
  }

  const input = 'w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2';
  return (
    <div className={frame}>
      {reply ? (
        <h3 className="text-sm font-semibold">Reply{replyTo ? ` to ${replyTo}` : ''}</h3>
      ) : (
        <>
          <h2 className="font-semibold">Know the answer?</h2>
          <p className="muted mt-1 mb-3 text-sm">
            Wrap commands and output in triple backticks and they will render as a code block.
          </p>
        </>
      )}
      <SignInGate user={user}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setState('sending');
            try {
              setResult(await postAnswer(target, body, parentId ?? ''));
              setState('idle');
            } catch (err) {
              setError((err as Error).message);
              setState('error');
            }
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{reply ? 'Reply' : 'Answer'}</span>
            <textarea
              required
              rows={reply ? 4 : 8}
              minLength={10}
              maxLength={MAX_REVIEWED_BODY}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={`${input} font-mono text-sm`}
            />
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Reviewing…' : reply ? 'Post reply' : 'Post answer'}
            </button>
            {onCancel && (
              <button type="button" className="btn btn-secondary" onClick={onCancel}>
                Cancel
              </button>
            )}
            {state === 'error' && (
              <span role="alert" className="text-sm">
                {error}
              </span>
            )}
          </div>
        </form>
      </SignInGate>
    </div>
  );
}

function LegacyAnswerForm({ target, parentId, replyTo, onCancel }: AnswerFormProps) {
  const reply = parentId !== undefined;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState(replyTo ? `@${replyTo} ` : '');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  if (state === 'sent') {
    return (
      <div className={`card p-5 ${reply ? 'mt-3' : 'mt-10'}`} role="status">
        <h2 className="font-semibold">Thanks — that&rsquo;s in.</h2>
        <p className="muted mt-2 text-sm">
          Your {reply ? 'reply' : 'answer'} is waiting to be reviewed. Once it is published it
          appears on this page.
        </p>
      </div>
    );
  }

  const input = 'w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2';

  return (
    <form
      className={reply ? 'mt-3 rounded-lg border border-[var(--line)] p-4' : 'card mt-10 p-6'}
      onSubmit={async (e) => {
        e.preventDefault();
        setState('sending');
        try {
          const { submitTo } = await import('@/lib/questions');
          await submitTo(target, { name, email, body, parentId });
          setState('sent');
        } catch {
          setState('error');
        }
      }}
    >
      {reply ? (
        <h3 className="text-sm font-semibold">Reply{replyTo ? ` to ${replyTo}` : ''}</h3>
      ) : (
        <>
          <h2 className="font-semibold">Know the answer?</h2>
          <p className="muted mt-1 text-sm">
            Reviewed before it appears. Wrap commands and output in triple backticks and they will
            render as a code block.
          </p>
        </>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <input
            required
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
          />
          <span className="muted mt-1 block text-xs">Never shown publicly.</span>
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="mb-1 block font-medium">{reply ? 'Reply' : 'Answer'}</span>
        <textarea
          required
          rows={reply ? 4 : 8}
          maxLength={MAX_BODY}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={`${input} font-mono text-sm`}
        />
        <span className="muted mt-1 block text-xs tabular-nums">
          {body.length} / {MAX_BODY}
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : reply ? 'Post reply' : 'Post answer'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        {state === 'error' && (
          <span role="status" className="muted text-sm">
            That did not go through. Try again in a moment.
          </span>
        )}
      </div>
    </form>
  );
}
