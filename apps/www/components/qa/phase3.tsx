'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { COMMUNITY_ENABLED, editPost, type EditResult } from '@/lib/community';
import { useUser } from '@/components/qa/community';
import { QaBody } from '@/components/qa/qa-body';
import type { BadgeCounts, Profile, Revision } from '@/lib/questions';

/**
 * Badges, edits and revision history for the real (signed-in) community posts. The illustrative
 * archive threads have none of these.
 */

const TIER_COLOR = { gold: '#d4a017', silver: '#9aa4ad', bronze: '#b0703c' } as const;

/** "● 1 ● 3 ● 12" in gold, silver and bronze, as on Stack Overflow; nothing when there are none. */
export function BadgeCountsInline({ counts }: { counts: BadgeCounts }) {
  const tiers = (['gold', 'silver', 'bronze'] as const).filter((t) => counts[t] > 0);
  if (!tiers.length) return null;
  return (
    <span className="ml-1.5 inline-flex gap-1.5 tabular-nums">
      {tiers.map((t) => (
        <span key={t} title={`${counts[t]} ${t} badge${counts[t] === 1 ? '' : 's'}`}>
          <span aria-hidden style={{ color: TIER_COLOR[t] }}>
            ●
          </span>
          {counts[t]}
        </span>
      ))}
    </span>
  );
}

const BADGE_NAMES: Record<string, string> = {
  student: 'Student',
  teacher: 'Teacher',
  scholar: 'Scholar',
  supporter: 'Supporter',
  critic: 'Critic',
  editor: 'Editor',
  'nice-question': 'Nice Question',
  'good-question': 'Good Question',
  'great-question': 'Great Question',
  'nice-answer': 'Nice Answer',
  'good-answer': 'Good Answer',
  'great-answer': 'Great Answer',
  'accepted-guru': 'Guru',
};

/** /questions/member/?uid=… — a member's reputation and badges. */
export function MemberProfile() {
  const uid = useSearchParams().get('uid');
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'done'; p: Profile | null }>({
    kind: 'loading',
  });
  useEffect(() => {
    if (!uid) return setState({ kind: 'done', p: null });
    let live = true;
    import('@/lib/questions')
      .then(({ profile }) => profile(uid))
      .then((p) => live && setState({ kind: 'done', p }))
      .catch(() => live && setState({ kind: 'done', p: null }));
    return () => {
      live = false;
    };
  }, [uid]);

  if (state.kind === 'loading') return <p className="muted text-sm">Loading…</p>;
  const p = state.p;
  if (!p) return <p className="text-sm">That member is not here.</p>;
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{p.display}</h1>
        <p className="muted mt-1 text-sm tabular-nums">
          {p.rep.toLocaleString('en')} reputation
          {p.role !== 'member' && ` · SDODS ${p.role}`}
          <BadgeCountsInline counts={p.counts} />
        </p>
      </header>
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide">Badges</h2>
        {p.badges.length === 0 ? (
          <p className="muted mt-2 text-sm">None yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {p.badges.map((b, i) => (
              <li
                key={`${b.id}-${b.post ?? i}`}
                className="rounded-full border border-[var(--line)] px-3 py-1 text-sm"
              >
                <span aria-hidden style={{ color: TIER_COLOR[b.tier] }}>
                  ●
                </span>{' '}
                {BADGE_NAMES[b.id] ?? b.id}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** "edited · show history" under an edited post, loading the revisions on demand. */
export function RevisionHistory({ path, revision }: { path: string; revision: number }) {
  const [open, setOpen] = useState(false);
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [error, setError] = useState(false);
  if (revision < 1) return null;
  return (
    <div className="mt-2 text-xs">
      <button
        type="button"
        className="muted underline underline-offset-2"
        onClick={async () => {
          setOpen((o) => !o);
          if (revs || error) return;
          try {
            const { revisions } = await import('@/lib/questions');
            setRevs(await revisions(path));
          } catch {
            setError(true);
          }
        }}
      >
        edited {revision} {revision === 1 ? 'time' : 'times'} · {open ? 'hide' : 'show'} history
      </button>
      {open && (
        <ol className="mt-2 space-y-3 border-l-2 border-[var(--line)] pl-3">
          {error && <li className="muted">History could not be loaded.</li>}
          {!revs && !error && <li className="muted">Loading…</li>}
          {revs?.map((r) => (
            <li key={r.revision}>
              <p className="muted">
                Revision {r.revision} · {r.byName || 'unknown'}
                {r.createdAt && ` · ${r.createdAt.toLocaleDateString('en-GB')}`}
                {r.comment && ` · “${r.comment}”`}
              </p>
              {r.title && <p className="mt-1 font-semibold">{r.title}</p>}
              <div className="mt-1 text-sm">
                <QaBody body={r.body} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The Edit control on a post. Signed-in members only; the service decides edit vs suggestion. */
export const EditPost = COMMUNITY_ENABLED ? LiveEditPost : () => null;

function LiveEditPost(props: {
  path: string;
  kind: 'question' | 'answer';
  title?: string;
  body: string;
  revision: number;
}) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.title ?? '');
  const [body, setBody] = useState(props.body);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EditResult | null>(null);
  if (!user) return null;

  if (result)
    return (
      <p role="status" className="mt-2 text-xs">
        {result.status === 'applied'
          ? `Edit saved as revision ${result.revision}. Reload to see it.`
          : result.reason}
      </p>
    );

  if (!open)
    return (
      <button
        type="button"
        className="muted text-xs underline underline-offset-2"
        onClick={() => setOpen(true)}
      >
        Edit
      </button>
    );

  const input = 'w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2';
  return (
    <form
      className="mt-3 grid gap-2 rounded-lg border border-[var(--line)] p-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setResult(
            await editPost({
              path: props.path,
              ...(props.kind === 'question' ? { title } : {}),
              body,
              comment,
              baseRevision: props.revision,
            }),
          );
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {props.kind === 'question' && (
        <label>
          <span className="mb-1 block font-medium">Title</span>
          <input
            className={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={10}
            maxLength={200}
            required
          />
        </label>
      )}
      <label>
        <span className="mb-1 block font-medium">Text</span>
        <textarea
          className={`${input} font-mono text-sm`}
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          minLength={10}
          maxLength={10_000}
          required
        />
      </label>
      <label>
        <span className="mb-1 block font-medium">What did you change?</span>
        <input
          className={input}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={300}
          placeholder="e.g. added the full error output"
          required
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Reviewing…' : 'Save edit'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {error && (
          <span role="alert" className="text-sm">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
