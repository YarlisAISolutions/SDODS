'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  me,
  pendingEdits,
  resolveEdit,
  resolvePost,
  reviewQueue,
  setRole,
  type Me,
  type PendingEdit,
  type QueueItem,
} from '@/lib/community';
import { SignInGate, useUser } from '@/components/qa/community';

/**
 * The editor queue, from the community service: posts the AI review could not decide, and anything
 * posted before the service existed. Editors approve or reject with a reason the author sees;
 * admins can also make someone an editor.
 *
 * Who may act is decided by the service from the signed-in user's role claim, not by this page.
 */
export function EditorQueue() {
  const user = useUser();
  return (
    <div className="mt-6">
      <SignInGate user={user}>{user && <Queue key={user.uid} />}</SignInGate>
    </div>
  );
}

function Queue() {
  const [viewer, setViewer] = useState<Me | null>(null);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const who = await me();
      setViewer(who);
      if (who.role === 'member') return;
      setItems((await reviewQueue()).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <p role="alert" className="text-sm">
        {error}
      </p>
    );
  if (!viewer) return <p className="muted text-sm">Loading…</p>;
  if (viewer.role === 'member')
    return (
      <p className="text-sm">
        You&rsquo;re signed in, but this account isn&rsquo;t an editor. An admin can make it one;
        your user id is <code>{viewer.uid}</code>.
      </p>
    );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {items === null
            ? 'Loading the queue…'
            : items.length === 0
              ? 'Nothing is waiting. The review handled everything.'
              : `${items.length} waiting, oldest first.`}
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {items?.map((item) => (
        <Item
          key={item.path}
          item={item}
          onDone={() => setItems((xs) => xs?.filter((x) => x.path !== item.path) ?? null)}
        />
      ))}
      <SuggestedEdits />
      {viewer.role === 'admin' && <Roles />}
    </div>
  );
}

function Item({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [reason, setReason] = useState(item.review?.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = item.review;

  const act = async (action: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      await resolvePost(item.path, action, action === 'reject' ? reason : '');
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const where =
    item.kind === 'question'
      ? 'Question'
      : item.kind === 'answer'
        ? `Answer to a live question (${item.parent})`
        : `Answer on /questions/${item.parent}/`;

  return (
    <article className="card grid gap-3 p-5">
      <p className="muted text-xs">
        {where} · by {item.name || 'unknown'}
        {item.createdAt && ` · ${new Date(item.createdAt).toLocaleString()}`}
      </p>
      {item.title && <h2 className="font-semibold">{item.title}</h2>}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--brand)]/5 p-3 text-sm">
        {item.body}
      </pre>
      {r ? (
        <p className="muted text-xs">
          Review: {r.relevance ?? 'no verdict'}
          {typeof r.confidence === 'number' && ` (${Math.round(r.confidence * 100)}% sure)`}
          {r.by && ` · ${r.by}`}
          {r.reason && ` · “${r.reason}”`}
        </p>
      ) : (
        <p className="muted text-xs">Posted before the AI review existed.</p>
      )}
      <label className="text-sm">
        <span className="mb-1 block font-medium">Reason (shown to the author if you reject)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void act('approve')}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !reason.trim()}
          onClick={() => void act('reject')}
        >
          Reject
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </article>
  );
}

function Roles() {
  const [uid, setUid] = useState('');
  const [role, setRoleValue] = useState<Me['role']>('editor');
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section className="card grid gap-3 p-5">
      <h2 className="font-semibold">Roles</h2>
      <p className="muted text-sm">
        Paste the user id someone sees on this page when they sign in without a role.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMessage(null);
          try {
            setMessage((await setRole(uid.trim(), role)).note);
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block font-medium">User id</span>
          <input required value={uid} onChange={(e) => setUid(e.target.value)} maxLength={128} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Role</span>
          <select value={role} onChange={(e) => setRoleValue(e.target.value as Me['role'])}>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
            <option value="member">Member (remove role)</option>
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">
          Set role
        </button>
      </form>
      {message && <p className="text-sm">{message}</p>}
    </section>
  );
}

/** Suggested edits from members who cannot edit directly yet. */
function SuggestedEdits() {
  const [items, setItems] = useState<PendingEdit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    pendingEdits()
      .then((r) => setItems(r.items))
      .catch((e) => setError((e as Error).message));
  }, []);
  if (error)
    return (
      <p role="alert" className="text-sm">
        {error}
      </p>
    );
  return (
    <section className="grid gap-4">
      <h2 className="font-semibold">Suggested edits</h2>
      {items === null ? (
        <p className="muted text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted text-sm">No suggested edits waiting.</p>
      ) : (
        items.map((e) => (
          <SuggestedEdit
            key={e.id}
            edit={e}
            onDone={() => setItems((xs) => xs?.filter((x) => x.id !== e.id) ?? null)}
          />
        ))
      )}
    </section>
  );
}

function postHref(path: string): string {
  const q = /^questions\/([^/]+)/.exec(path);
  return q ? `/questions/live/?id=${q[1]}` : '/questions/';
}

function SuggestedEdit({ edit, onDone }: { edit: PendingEdit; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      await resolveEdit(edit.id, action, action === 'reject' ? reason : '');
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <article className="card grid gap-3 p-5">
      <p className="muted text-xs">
        By {edit.byName || edit.by} · on{' '}
        <a href={postHref(edit.post)} className="underline">
          {edit.post}
        </a>{' '}
        (from revision {edit.baseRevision})
        {edit.createdAt && ` · ${new Date(edit.createdAt).toLocaleString()}`}
      </p>
      {edit.comment && <p className="text-sm">“{edit.comment}”</p>}
      {edit.title && <p className="font-semibold">{edit.title}</p>}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--brand)]/5 p-3 text-sm">
        {edit.body}
      </pre>
      <label className="text-sm">
        <span className="mb-1 block font-medium">
          Reason (shown to the suggester if you reject)
        </span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void act('approve')}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !reason.trim()}
          onClick={() => void act('reject')}
        >
          Reject
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </article>
  );
}
