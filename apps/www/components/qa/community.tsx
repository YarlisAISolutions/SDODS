'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { SignInCancelled, type SiteUser } from '@sdods/site-kit/identity';
import { signIn, signOutUser, watchUser, type PostResult, type Provider } from '@/lib/community';
import { identity } from '@/lib/identity';

/** The signed-in user, or null; `undefined` while it is still being worked out. */
export function useUser(): SiteUser | null | undefined {
  const [user, setUser] = useState<SiteUser | null | undefined>(undefined);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let live = true;
    void watchUser((u) => live && setUser(u)).then((unsub) => {
      if (live) stop = unsub;
      else unsub();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return user;
}

const PROVIDER_NAMES: Record<Provider, string> = { github: 'GitHub', google: 'Google' };

/**
 * Shows sign-in buttons until someone is signed in, then the form it wraps with a "posting as"
 * line. Posting needs an account: reputation, the review audit trail and rate limits all hang off it.
 */
export function SignInGate({
  user,
  children,
}: {
  user: SiteUser | null | undefined;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!identity.providers.length)
    return <p className="muted text-sm">Signing in is not available on this build of the site.</p>;

  if (user === undefined)
    return <p className="muted text-sm">Checking whether you&rsquo;re signed in…</p>;

  if (!user) {
    const go = async (p: Provider) => {
      setBusy(p);
      setError(null);
      try {
        await signIn(p);
      } catch (e) {
        // Closing the popup is a choice, not an error worth a message.
        if (!(e instanceof SignInCancelled))
          setError('Sign-in did not complete. Try again, or try the other option.');
      } finally {
        setBusy(null);
      }
    };
    return (
      <div className="grid gap-3">
        <p className="text-sm">Sign in to post. Your name is shown; your email address never is.</p>
        <div className="flex flex-wrap gap-2">
          {identity.providers.map((p, i) => (
            <button
              key={p}
              type="button"
              className={i === 0 ? 'btn btn-primary' : 'btn btn-secondary'}
              disabled={busy !== null}
              onClick={() => go(p)}
            >
              {busy === p ? `Opening ${PROVIDER_NAMES[p]}…` : `Sign in with ${PROVIDER_NAMES[p]}`}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="muted text-xs">
        Posting as <span className="font-medium">{user.name ?? 'you'}</span> ·{' '}
        <button type="button" className="underline" onClick={() => void signOutUser()}>
          Sign out
        </button>
      </p>
      {children}
    </div>
  );
}

/** What the review decided, in the author's terms. */
export function ReviewOutcome({
  result,
  kind,
  publishedHref,
}: {
  result: PostResult;
  kind: 'question' | 'answer' | 'reply';
  publishedHref?: string;
}) {
  const heading =
    result.status === 'published'
      ? `Your ${kind} is live.`
      : result.status === 'pending'
        ? `Your ${kind} is waiting for an editor.`
        : `Your ${kind} was not published.`;

  return (
    <div className="grid gap-3" role="status">
      <h2 className="font-semibold">{heading}</h2>
      {result.status === 'published' && publishedHref && (
        <p className="text-sm">
          <Link href={publishedHref} className="underline">
            View it
          </Link>
        </p>
      )}
      {result.reason && <p className="text-sm">{result.reason}</p>}
      {result.status === 'rejected' && (
        <p className="muted text-sm">
          This Q&amp;A only takes questions and answers about SDODS itself. If yours is, add the
          command, config or error message that shows it and post again.
        </p>
      )}
      {result.redacted && (
        <p className="muted text-sm">
          Something that looked like a key, token or password was replaced with{' '}
          <code>[redacted]</code> before it was saved. If it was real, rotate it anyway.
        </p>
      )}
      {result.notes.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Suggestions</p>
          <ul className="muted mt-1 list-disc pl-5">
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {result.similar.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">These may already answer it</p>
          <ul className="mt-1 list-disc pl-5">
            {result.similar.map((s) => (
              <li key={s.slug}>
                <Link href={`/questions/${s.slug}/`} className="underline">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
