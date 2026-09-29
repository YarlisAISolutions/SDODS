/**
 * The community service (packages/community): signed-in posting with an AI review, and the editor
 * queue.
 *
 * Off until `NEXT_PUBLIC_COMMUNITY_URL` is set at build time (the COMMUNITY_URL repository
 * variable). Until then the forms keep writing straight to Firestore as `pending`, exactly as
 * before, so the site works whether or not the service has been deployed.
 *
 * `firebase/auth` is imported lazily, inside these functions, so a page that only shows the
 * questions list never downloads it.
 */
import type { User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import type { AnswerTarget } from '@/lib/questions';

export const COMMUNITY_URL = (process.env.NEXT_PUBLIC_COMMUNITY_URL ?? '').replace(/\/+$/, '');
export const COMMUNITY_ENABLED = COMMUNITY_URL !== '';

export type Provider = 'github' | 'google';

export interface Me {
  uid: string;
  name: string;
  role: 'member' | 'editor' | 'admin';
}

async function authModule() {
  const mod = await import('firebase/auth');
  return { mod, auth: mod.getAuth(app()) };
}

/** Calls back with the signed-in user (or null) now and on every change. Returns an unsubscribe. */
export async function watchUser(cb: (u: User | null) => void): Promise<() => void> {
  const { mod, auth } = await authModule();
  return mod.onAuthStateChanged(auth, cb);
}

export async function signIn(provider: Provider): Promise<void> {
  const { mod, auth } = await authModule();
  // A popup rather than a redirect: redirects break when the browser blocks third-party cookies
  // on a custom domain, which is now the common case.
  const p = provider === 'github' ? new mod.GithubAuthProvider() : new mod.GoogleAuthProvider();
  await mod.signInWithPopup(auth, p);
}

export async function signOutUser(): Promise<void> {
  const { mod, auth } = await authModule();
  await mod.signOut(auth);
}

export class CommunityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const { auth } = await authModule();
  const user = auth.currentUser;
  if (!user) throw new CommunityError('Sign in to post.', 401);
  // getIdToken refreshes an expiring token, so a long-open page still posts.
  const token = await user.getIdToken();
  const res = await fetch(`${COMMUNITY_URL}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new CommunityError(data.error ?? `Request failed (${res.status})`, res.status);
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

export const reviewQueue = () => call<{ items: QueueItem[] }>('GET', '/review/queue');

export const resolvePost = (path: string, action: 'approve' | 'reject', reason: string) =>
  call<{ ok: true }>('POST', '/review/resolve', { path, action, reason });

export const setRole = (uid: string, role: Me['role']) =>
  call<{ ok: true; note: string }>('POST', '/admin/role', { uid, role });
