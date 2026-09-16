'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { QaBody } from '@/components/qa/qa-body';
import { AnswerForm } from '@/components/qa/answer-form';
import { formatDate } from '@/lib/qa-list';
import type { Answer, AnswerTarget } from '@/lib/questions';

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

type State = { target: AnswerTarget; posts: Answer[] | null };

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
    | { questionId: string; answers: Answer[]; children: ReactNode },
) {
  const slug = 'slug' in props ? props.slug : null;
  const [loaded, setLoaded] = useState<Answer[] | null>(null);

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
      ? { target: { kind: 'thread', slug: props.slug }, posts: loaded }
      : { target: { kind: 'live', questionId: props.questionId }, posts: props.answers };

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

function PostMeta({ post }: { post: Answer }) {
  return (
    <p className="muted text-xs">
      <span className="font-medium">{post.name}</span>
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
  const { target, posts } = usePosts();
  const answers = (posts ?? []).filter((p) => !p.parentId);

  return (
    <>
      {answers.length > 0 && (
        <ul className="mt-6 space-y-6">
          {answers.map((a) => (
            <li key={a.id} id={a.id} className="rounded-lg border border-[var(--line)] p-4">
              <QaBody body={a.body} />
              <div className="mt-3 flex justify-end">
                <PostMeta post={a} />
              </div>
              <ReplyThread parentId={a.id} parentName={a.name} />
            </li>
          ))}
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
