'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CATEGORIES, submitQuestion, type Category } from '@/lib/questions';

const MAX_TITLE = 200;
const MAX_BODY = 5000;

/**
 * Posts a question straight from the browser to Firestore. Nothing here can
 * publish: the rules only accept a `pending` document, so the worst a bad
 * actor achieves is a row the moderator deletes.
 */
export function AskForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('ui');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      await submitQuestion({ name, email, title, category, body });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="card p-6" role="status">
        <h2 className="font-semibold">Thanks — that&rsquo;s in.</h2>
        <p className="muted mt-2 text-sm">
          Your question is waiting to be reviewed. Once it is published it appears on the questions
          page, and we&rsquo;ll reply by email if we need more detail. We only use your address to
          answer you.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/questions/" className="btn btn-secondary">
            Back to questions
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setTitle('');
              setBody('');
              setState('idle');
            }}
          >
            Ask another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="card grid gap-4 p-6"
      aria-label="Ask a question"
      aria-busy={state === 'sending'}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Your name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoComplete="name"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
          />
          <span className="muted mt-1 block text-xs">Never shown publicly.</span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Question</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
            placeholder="One line — what are you trying to do?"
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
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY}
          placeholder="What you tried, what happened, and what you expected. Paste the command and any error."
        />
        <span className="muted mt-1 block text-xs">
          {body.length} / {MAX_BODY}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Posting…' : 'Post question'}
        </button>
        <span className="muted text-xs">Reviewed before it appears, usually within a day.</span>
      </div>

      {state === 'error' && (
        <p className="text-sm" role="alert">
          That didn&rsquo;t go through. Check the fields and try again, or email{' '}
          <a href="mailto:admin@sdods.com" className="underline">
            admin@sdods.com
          </a>
          .
        </p>
      )}
    </form>
  );
}
