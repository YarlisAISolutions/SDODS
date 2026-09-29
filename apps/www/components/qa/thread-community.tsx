'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { QaBody } from '@/components/qa/qa-body';
import { AnswerForm } from '@/components/qa/answer-form';
import { formatDate } from '@/lib/qa-list';
import type { Answer, AnswerTarget } from '@/lib/questions';
import { acceptAnswer, COMMUNITY_ENABLED, postPath } from '@/lib/community';
import { useUser } from '@/components/qa/community';
import { useProfile, VoteControl, VotesProvider } from '@/components/qa/votes';
import { BadgeCountsInline, EditPost, RevisionHistory } from '@/components/qa/phase3';

/**
 * Community answers and replies layered over a question page.
 *
 * On an archive thread the question and its archive answers are static HTML; what people post on the
 * site lives in Firestore and is fetched here after paint. One provider fetches once for the whole
 * page, and every reply list reads from it, so a thread with ten answers is still one query.
 *
 * Replies are one level deep. Replying to a reply files it under the same answer and starts the body
 * with `@name`, which keeps the thread readable without an unbounded tree.
 */

type State = {
  target: AnswerTarget;
  posts: Answer[] | null;
  /** Live questions only: who asked (for accepting) and which answer is accepted. */
  question: { uid: string | null; acceptedAnswerId: string | null } | null;
  setAccepted: (id: string | null) => void;
};

const Ctx = createContext<State | null>(null);

function usePosts(): State {
  const state = useContext(Ctx);
  if (!state) throw new Error('ThreadCommunity components need a ThreadCommunityProvider');
  return state;
}

/**
 * For an archive thread, pass `slug` and the provider loads its posts. For a live question the
 * caller already has the answers, so it passes them in with the question id.
 */
export function ThreadCommunityProvider(
  props:
    | { slug: string; children: ReactNode }
    | {
        questionId: string;
        answers: Answer[];
        askerUid?: string | null;
        acceptedAnswerId?: string | null;
        children: ReactNode;
      },
) {
  const slug = 'slug' in props ? props.slug : null;
  const [loaded, setLoaded] = useState<Answer[] | null>(null);
  const [accepted, setAccepted] = useState<string | null>(
    'slug' in props ? null : (props.acceptedAnswerId ?? null),
  );

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    import('@/lib/questions')
      .then(({ listThreadAnswers }) => listThreadAnswers(slug))
      .then((posts) => !cancelled && setLoaded(posts))
      // Offline, or an index still building: the static page stands on its own.
      .catch(() => !cancelled && setLoaded([]));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const value: State =
    'slug' in props
      ? {
          target: { kind: 'thread', slug: props.slug },
          posts: loaded,
          question: null,
          setAccepted,
        }
      : {
          target: { kind: 'live', questionId: props.questionId },
          posts: props.answers,
          question: { uid: props.askerUid ?? null, acceptedAnswerId: accepted },
          setAccepted,
        };

  // Only answers are scored; replies are conversation, as comments are on Stack Overflow.
  const answers = (value.posts ?? []).filter((p) => !p.parentId);
  const paths = answers.map((a) => postPath(value.target, a.id));
  const authors = (value.posts ?? []).flatMap((p) => (p.uid ? [p.uid] : []));
  if (value.target.kind === 'live') {
    // The question itself is votable too, and its asker has a byline.
    paths.unshift(`questions/${value.target.questionId}`);
    if (value.question?.uid) authors.push(value.question.uid);
  }

  return (
    <Ctx.Provider value={value}>
      <VotesProvider paths={paths} authors={authors}>
        {props.children}
      </VotesProvider>
    </Ctx.Provider>
  );
}

export function PostMeta({ post }: { post: Pick<Answer, 'uid' | 'name' | 'createdAt'> }) {
  const profile = useProfile(post.uid);
  return (
    <p className="muted text-xs">
      {post.uid ? (
        <Link href={`/questions/member/?uid=${post.uid}`} className="font-medium hover:underline">
          {post.name}
        </Link>
      ) : (
        <span className="font-medium">{post.name}</span>
      )}
      {profile && (
        <>
          <span className="ml-1.5 tabular-nums" title="Reputation">
            {profile.rep.toLocaleString('en')}
          </span>
          <BadgeCountsInline counts={profile.counts} />
        </>
      )}
      {post.createdAt && (
        <>
          {' · '}
          <time dateTime={post.createdAt.toISOString()}>
            {formatDate(post.createdAt.toISOString().slice(0, 10))}
          </time>
        </>
      )}
    </p>
  );
}

/**
 * The replies under one answer, and the Reply button that opens a form for it. `parentId` is the
 * answer's id — an archive answer id such as `a1`, or a Firestore document id.
 */
export function ReplyThread({ parentId, parentName }: { parentId: string; parentName: string }) {
  const { target, posts } = usePosts();
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const replies = (posts ?? []).filter((p) => p.parentId === parentId);

  return (
    <div className="mt-3">
      {replies.length > 0 && (
        <ul className="space-y-3 border-l-2 border-[var(--line)] pl-4">
          {replies.map((r) => (
            <li key={r.id} id={r.id} className="text-sm">
              <QaBody body={r.body} />
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <PostMeta post={r} />
                <button
                  type="button"
                  className="muted text-xs underline underline-offset-2"
                  onClick={() => setReplyingTo(r.name)}
                >
                  Reply
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {replyingTo === null ? (
        <button
          type="button"
          className="muted mt-2 text-xs underline underline-offset-2"
          onClick={() => setReplyingTo(parentName)}
        >
          Reply
        </button>
      ) : (
        <AnswerForm
          key={replyingTo}
          target={target}
          parentId={parentId}
          replyTo={replyingTo}
          onCancel={() => setReplyingTo(null)}
        />
      )}
    </div>
  );
}

/** Answers posted on the site, each with its replies, followed by the form to post a new answer. */
export function CommunityAnswers({ showAskLink = false }: { showAskLink?: boolean }) {
  const { target, posts, question } = usePosts();
  const acceptedId = question?.acceptedAnswerId ?? null;
  // Accepted first, then by score, then oldest first: the order a reader wants.
  const answers = (posts ?? [])
    .filter((p) => !p.parentId)
    .sort(
      (a, b) =>
        Number(b.id === acceptedId) - Number(a.id === acceptedId) ||
        b.score - a.score ||
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );

  return (
    <>
      {answers.length > 0 && (
        <ul className="mt-6 space-y-6">
          {answers.map((a) => {
            const accepted = a.id === acceptedId;
            return (
              <li
                key={a.id}
                id={a.id}
                className={`flex gap-4 rounded-lg border p-4 ${
                  accepted ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[var(--line)]'
                }`}
              >
                <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
                  <VoteControl path={postPath(target, a.id)} score={a.score} />
                  {accepted && (
                    <span
                      className="text-emerald-600"
                      title="Accepted answer"
                      aria-label="Accepted"
                    >
                      ✓
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {accepted && (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">
                      Accepted answer
                    </p>
                  )}
                  <QaBody body={a.body} />
                  <RevisionHistory path={postPath(target, a.id)} revision={a.revision} />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-3">
                      <AcceptButton answerId={a.id} accepted={accepted} />
                      <EditPost
                        path={postPath(target, a.id)}
                        kind="answer"
                        body={a.body}
                        revision={a.revision}
                      />
                    </span>
                    <PostMeta post={a} />
                  </div>
                  <ReplyThread parentId={a.id} parentName={a.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AnswerForm target={target} />

      {showAskLink && (
        <p className="muted mt-4 text-sm">
          Have a different question?{' '}
          <Link href="/questions/ask/" className="underline">
            Ask it
          </Link>
          .
        </p>
      )}
    </>
  );
}

/** The number of answers posted on the site, for a heading rendered on the server. */
export function CommunityAnswerCount({ base }: { base: number }) {
  const { posts } = usePosts();
  const n = base + (posts ?? []).filter((p) => !p.parentId).length;
  return <>{n === 0 ? 'No answers yet' : `${n} ${n === 1 ? 'answer' : 'answers'}`}</>;
}

/** The asker's accept / un-accept control on a live question. Absent without the service. */
const AcceptButton = COMMUNITY_ENABLED ? LiveAcceptButton : () => null;

function LiveAcceptButton({ answerId, accepted }: { answerId: string; accepted: boolean }) {
  const { target, question, setAccepted } = usePosts();
  const user = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (target.kind !== 'live' || !user || !question?.uid || user.uid !== question.uid)
    return <span />;
  return (
    <span className="text-xs">
      <button
        type="button"
        disabled={busy}
        className="underline underline-offset-2"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await acceptAnswer(target.questionId, accepted ? null : answerId);
            setAccepted(r.acceptedAnswerId);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {accepted ? 'Un-accept' : 'Accept this answer'}
      </button>
      {error && (
        <span role="status" className="muted ml-2">
          {error}
        </span>
      )}
    </span>
  );
}
