'use client';

import { useState } from 'react';
import { submitAnswer } from '@/lib/questions';

const MAX_BODY = 5000;

/**
 * Answer a published question.
 *
 * Only reachable from a question that lives in Firestore: the rules require the parent document to
 * exist and be published before an answer can be created, and an archive thread has no such parent.
 * Like a question, an answer is stored `pending` and is invisible — to this site included — until a
 * moderator publishes it, so nothing here can put text in front of a reader on its own.
 */
export function AnswerForm({ questionId }: { questionId: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  if (state === 'sent') {
    return (
      <div className="card mt-10 p-6" role="status">
        <h2 className="font-semibold">Thanks — that&rsquo;s in.</h2>
        <p className="muted mt-2 text-sm">
          Your answer is waiting to be reviewed. Once it is published it appears on this page.
        </p>
      </div>
    );
  }

  return (
    <form
      className="card mt-10 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('sending');
        try {
          await submitAnswer(questionId, { name, email, body });
          setState('sent');
        } catch {
          setState('error');
        }
      }}
    >
      <h2 className="font-semibold">Know the answer?</h2>
      <p className="muted mt-1 text-sm">
        Reviewed before it appears. Wrap commands and output in triple backticks and they will
        render as a code block.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2"
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
            className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2"
          />
          <span className="muted mt-1 block text-xs">Never shown publicly.</span>
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="mb-1 block font-medium">Answer</span>
        <textarea
          required
          rows={8}
          maxLength={MAX_BODY}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 font-mono text-sm"
        />
        <span className="muted mt-1 block text-xs tabular-nums">
          {body.length} / {MAX_BODY}
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Post answer'}
        </button>
        {state === 'error' && (
          <span role="status" className="muted text-sm">
            That did not go through. Try again in a moment.
          </span>
        )}
      </div>
    </form>
  );
}
