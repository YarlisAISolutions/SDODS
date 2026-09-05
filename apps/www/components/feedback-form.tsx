'use client';

import { useState } from 'react';
import { REPO_PUBLIC, issueUrl, mailtoUrl, type FeedbackKind } from '@/lib/links';
import { submitFeedback } from '@/lib/questions';

/**
 * Client-only form. While the repository is public it hands the text to GitHub. While it is
 * private the message is stored directly, because `mailto:` is not a delivery mechanism: a
 * visitor with no mail client configured gets nothing at all, silently, and never finds out.
 * The mailto link stays as a secondary route for people who prefer their own mail.
 */
export function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>('feature');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  const body = [
    message.trim(),
    name || email ? `\n\n---\nFrom: ${name}${email ? ` <${email}>` : ''}` : '',
  ]
    .join('')
    .trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (REPO_PUBLIC) {
      const fields: Record<string, string> = { title };
      if (kind === 'bug') fields.actual = body;
      else fields.problem = body;
      const url = issueUrl(kind, fields);
      window.open(url, '_blank', 'noopener');
      setOpened(url);
      return;
    }
    setSending(true);
    setFailed(false);
    try {
      await submitFeedback({ kind, title, body: message.trim(), name, email });
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="card p-6" aria-live="polite">
        <h3 className="font-semibold">Thanks — that reached us.</h3>
        <p className="muted mt-2 text-sm">
          Your {kind === 'bug' ? 'bug report' : kind === 'feature' ? 'feature request' : 'note'} is
          stored and a maintainer will read it.{' '}
          {email
            ? 'We\u2019ll reply to you by email if we need more detail.'
            : 'Add an email next time if you\u2019d like a reply.'}
        </p>
        <button
          type="button"
          className="btn btn-secondary mt-4"
          onClick={() => {
            setTitle('');
            setMessage('');
            setSent(false);
          }}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card grid gap-4 p-6" aria-label="Feedback form">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
            <option value="feature">Feature request</option>
            <option value="bug">Bug report</option>
            <option value="feedback">General feedback</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Title</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary"
            maxLength={120}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Email (optional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
      </div>
      <label className="text-sm">
        <span className="mb-1 block font-medium">
          {kind === 'bug'
            ? 'What happened, and what did you expect?'
            : 'What do you need, and why?'}
        </span>
        <textarea
          required
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            kind === 'feature'
              ? 'The problem you are trying to solve, the workflow it blocks, and what a good solution looks like.'
              : kind === 'bug'
                ? 'Command you ran, expected vs actual, run id if you have one.'
                : 'Anything: what works, what does not, what confused you.'
          }
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {REPO_PUBLIC ? 'Open on GitHub' : sending ? 'Sending\u2026' : 'Send'}
        </button>
        <a href={mailtoUrl(kind, title, body)} className="btn btn-secondary">
          Send by email instead
        </a>
        <span className="muted text-xs">
          {REPO_PUBLIC
            ? 'Opens a prefilled GitHub issue in a new tab.'
            : 'Sent straight to the maintainers. No mail client needed.'}
        </span>
      </div>
      {failed && (
        <p className="text-sm" role="alert">
          That didn&rsquo;t go through. Try again, or email{' '}
          <a href={mailtoUrl(kind, title, body)} className="underline">
            admin@sdods.com
          </a>{' '}
          directly.
        </p>
      )}
      {opened && (
        <p className="text-sm">
          If nothing opened,{' '}
          <a href={opened} className="underline" target="_blank" rel="noreferrer">
            use this link
          </a>
          .
        </p>
      )}
    </form>
  );
}
