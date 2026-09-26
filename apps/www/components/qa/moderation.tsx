'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { QaBody } from '@/components/qa/qa-body';
import type { PendingItem } from '@/lib/moderation';

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: PendingItem[] }
  | { kind: 'denied' }
  | { kind: 'building' }
  | { kind: 'error'; message: string };

const KIND_LABEL: Record<PendingItem['kind'], string> = {
  question: 'Question',
  'live-answer': 'Answer',
  'thread-answer': 'Answer',
};

function errorCode(err: unknown): string {
  return typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
}

/**
 * Sign in with Google, then approve or reject each pending post.
 *
 * The auth and Firestore SDKs are imported on mount rather than at the top, so this page is the only
 * one that ships `firebase/auth`.
 */
export function Moderation() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    import('@/lib/moderation').then(async ({ auth }) => {
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubscribe = onAuthStateChanged(auth(), setUser);
    });
    return () => unsubscribe?.();
  }, []);

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const { listPending } = await import('@/lib/moderation');
      setLoad({ kind: 'ready', items: await listPending() });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'permission-denied') setLoad({ kind: 'denied' });
      else if (code === 'failed-precondition') setLoad({ kind: 'building' });
      else setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    if (user) void refresh();
    else setLoad({ kind: 'idle' });
  }, [user, refresh]);

  async function signIn() {
    setSignInError(null);
    try {
      const { auth } = await import('@/lib/moderation');
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth(), provider);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setSignInError(
        code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found'
          ? 'Google sign-in is not enabled for this Firebase project yet.'
          : code === 'auth/unauthorized-domain'
            ? `This domain (${window.location.hostname}) is not in Firebase's authorized domains.`
            : `Sign-in failed${code ? ` (${code})` : ''}.`,
      );
    }
  }

  async function signOut() {
    const { auth } = await import('@/lib/moderation');
    await auth().signOut();
  }

  async function act(item: PendingItem, action: 'approve' | 'reject') {
    const key = item.ref.path;
    setBusy(key);
    try {
      const mod = await import('@/lib/moderation');
      await (action === 'approve' ? mod.approve(item) : mod.reject(item));
      setLoad((prev) =>
        prev.kind === 'ready'
          ? { kind: 'ready', items: prev.items.filter((i) => i.ref.path !== key) }
          : prev,
      );
    } catch (err) {
      setLoad({
        kind: 'error',
        message: `Could not ${action}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  if (user === undefined) {
    return (
      <p role="status" className="muted mt-8 text-sm">
        Checking sign-in…
      </p>
    );
  }

  if (!user) {
    return (
      <div className="card mt-8 p-6">
        <p className="font-medium">Sign in as the moderator to see pending posts.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={signIn}>
          Sign in with Google
        </button>
        {signInError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {signInError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
        <p className="muted text-sm">Signed in as {user.email}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={refresh}
            disabled={load.kind === 'loading'}
          >
            Refresh
          </button>
          <button type="button" className="btn btn-secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {load.kind === 'loading' && (
        <p role="status" className="muted mt-6 text-sm">
          Loading pending posts…
        </p>
      )}
      {load.kind === 'denied' && (
        <div role="alert" className="card mt-6 p-5 text-sm">
          This account is not the moderator. Sign out and sign in with the moderator account.
        </div>
      )}
      {load.kind === 'building' && (
        <div role="alert" className="card mt-6 p-5 text-sm">
          Firestore is still building an index this page needs. Try Refresh in a few minutes.
        </div>
      )}
      {load.kind === 'error' && (
        <div role="alert" className="card mt-6 p-5 text-sm">
          {load.message}
        </div>
      )}
      {load.kind === 'ready' && load.items.length === 0 && (
        <p className="muted mt-6 text-sm">Nothing waiting for review.</p>
      )}

      {load.kind === 'ready' && load.items.length > 0 && (
        <ul className="mt-6 space-y-5">
          {load.items.map((item) => {
            const key = item.ref.path;
            const kind = item.isReply ? 'Reply' : KIND_LABEL[item.kind];
            return (
              <li key={key} className="card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
                    {kind}
                    {item.kind !== 'question' && (
                      <>
                        {' on '}
                        <Link href={item.href} className="normal-case underline" target="_blank">
                          {item.context}
                        </Link>
                      </>
                    )}
                  </p>
                  <p className="muted text-xs">
                    {item.createdAt ? item.createdAt.toLocaleString() : ''}
                  </p>
                </div>
                {item.title && <h2 className="mt-2 font-semibold">{item.title}</h2>}
                <div className="mt-3 text-sm">
                  <QaBody body={item.body} />
                </div>
                <p className="muted mt-3 text-xs">
                  {item.name}
                  {item.email ? ` · ${item.email}` : ''}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {confirming === key ? (
                    <>
                      <span className="text-sm">Delete this permanently?</span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy === key}
                        onClick={() => act(item, 'reject')}
                      >
                        {busy === key ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy === key}
                        onClick={() => act(item, 'approve')}
                      >
                        {busy === key ? 'Publishing…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy === key}
                        onClick={() => setConfirming(key)}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
