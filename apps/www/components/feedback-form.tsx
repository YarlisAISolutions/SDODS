'use client';

import { useState } from 'react';
import { REPO_PUBLIC, issueUrl, mailtoUrl, type FeedbackKind } from '@/lib/links';

/**
 * Client-only form: builds a prefilled URL and opens it. Nothing is sent to us; the browser hands
 * the text to GitHub, or — while the repository is private — to the visitor's own mail client.
 */
export function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>('feature');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [opened, setOpened] = useState<string | null>(null);

  const body = [
    message.trim(),
    name || email ? `\n\n---\nFrom: ${name}${email ? ` <${email}>` : ''}` : '',
  ]
    .join('')
    .trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fields: Record<string, string> = { title };
    if (kind === 'bug') fields.actual = body;
    else fields.problem = body;
    const url = REPO_PUBLIC ? issueUrl(kind, fields) : mailtoUrl(kind, title, body);
    window.open(url, '_blank', 'noopener');
    setOpened(url);
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
        <button type="submit" className="btn btn-primary">
          {REPO_PUBLIC ? 'Open on GitHub' : 'Send by email'}
        </button>
        {REPO_PUBLIC && (
          <a href={mailtoUrl(kind, title, body)} className="btn btn-secondary">
            Send by email instead
          </a>
        )}
        <span className="muted text-xs">
          {REPO_PUBLIC
            ? 'Opens a prefilled GitHub issue in a new tab.'
            : 'Opens a prefilled email in your own mail client.'}
        </span>
      </div>
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
