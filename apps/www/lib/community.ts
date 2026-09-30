/**
 * The community service (packages/community): signed-in posting with an AI review, the editor
 * queue, and the public reads in questions.ts.
 *
 * Off until `NEXT_PUBLIC_COMMUNITY_URL` is set at build time (the COMMUNITY_URL repository
 * variable). Without it the Q&A shows only the static archive and posting is unavailable.
 *
 * Sign-in goes through the site's Identity (lib/identity.ts), whichever provider the deployment
 * wired in; this module only needs its ID token.
 */
import type { SignInProvider, SiteUser } from '@sdods/site-kit/identity';
import { identity } from '@/lib/identity';
import type { AnswerTarget } from '@/lib/questions';

export const COMMUNITY_URL = (process.env.NEXT_PUBLIC_COMMUNITY_URL ?? '').replace(/\/+$/, '');
export const COMMUNITY_ENABLED = COMMUNITY_URL !== '';

export type Provider = SignInProvider;

export interface Me {
  uid: string;
  name: string;
  role: 'member' | 'editor' | 'admin';
}

/** Calls back with the signed-in user (or null) now and on every change. Returns an unsubscribe. */
export const watchUser = (cb: (u: SiteUser | null) => void) => identity.watch(cb);
export const signIn = (provider: Provider) => identity.signIn(provider);
export const signOutUser = () => identity.signOut();

export class CommunityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  // A fresh token each call: an expiring one is refreshed, so a long-open page still posts.
  const token = await identity.idToken();
  if (!token) throw new CommunityError('Sign in to post.', 401);
  const res = await fetch(`${COMMUNITY_URL}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
  // A rejected edit explains itself in `reason` (422), like a rejected post does in its result.
  if (!res.ok)
    throw new CommunityError(
      data.error ?? data.reason ?? `Request failed (${res.status})`,
      res.status,
    );
  return data as T;
}

export interface PostResult {
  status: 'published' | 'pending' | 'rejected';
  path: string;
  id: string;
  reason?: string;
  notes: string[];
  redacted: boolean;
  similar: Array<{ slug: string; title: string }>;
}

export const me = () => call<Me>('GET', '/me');

export const postQuestion = (q: { title: string; body: string; category: string }) =>
  call<PostResult>('POST', '/questions', q);

export const postAnswer = (target: AnswerTarget, body: string, parentId = '') =>
  call<PostResult>('POST', '/answers', {
    ...(target.kind === 'live' ? { questionId: target.questionId } : { slug: target.slug }),
    parentId,
    body,
  });

export interface QueueItem {
  path: string;
  kind: 'question' | 'answer' | 'threadAnswer';
  title: string | null;
  body: string;
  name: string;
  uid: string | null;
  createdAt: string | null;
  review: {
    decision?: string;
    by?: string;
    relevance?: string | null;
    confidence?: number | null;
    reason?: string;
    notes?: string[];
  } | null;
  parent: string | null;
}

export type VoteValue = -1 | 0 | 1;

export const vote = (path: string, value: VoteValue) =>
  call<{ ok: true; score: number; value: VoteValue }>('POST', '/votes', { path, value });

export const myVotes = (paths: string[]) =>
  call<{ votes: Record<string, VoteValue>; rep: number }>(
    'GET',
    `/votes/mine?paths=${paths.map(encodeURIComponent).join(',')}`,
  );

export const acceptAnswer = (questionId: string, answerId: string | null) =>
  call<{ ok: true; acceptedAnswerId: string | null }>('POST', '/accept', { questionId, answerId });

/** A post's reference (its document path), as the service names it. */
export const postPath = (target: AnswerTarget, id: string) =>
  target.kind === 'live' ? `questions/${target.questionId}/answers/${id}` : `threadAnswers/${id}`;

export type EditResult =
  { status: 'applied'; revision: number } | { status: 'pending'; id: string; reason: string };

export const editPost = (e: {
  path: string;
  title?: string;
  body: string;
  comment: string;
  baseRevision: number;
}) => call<EditResult>('POST', '/edits', e);

export interface PendingEdit {
  id: string;
  post: string;
  baseRevision: number;
  title: string | null;
  body: string;
  by: string;
  byName: string;
  comment: string;
  createdAt: string | null;
}

export const pendingEdits = () => call<{ items: PendingEdit[] }>('GET', '/review/edits');

export const resolveEdit = (id: string, action: 'approve' | 'reject', reason: string) =>
  call<{ ok: true; applied: boolean }>('POST', '/review/edits/resolve', { id, action, reason });

export const reviewQueue = () => call<{ items: QueueItem[] }>('GET', '/review/queue');

export const resolvePost = (path: string, action: 'approve' | 'reject', reason: string) =>
  call<{ ok: true }>('POST', '/review/resolve', { path, action, reason });

export const setRole = (uid: string, role: Me['role']) =>
  call<{ ok: true; note: string }>('POST', '/admin/role', { uid, role });
