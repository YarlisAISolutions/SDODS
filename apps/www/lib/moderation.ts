import { getAuth, type Auth } from 'firebase/auth';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  type DocumentReference,
  type DocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { app, db } from '@/lib/firebase';

/**
 * The moderation page's data access. Kept apart from `questions.ts` so `firebase/auth` is only in
 * the bundle of the one page that signs in.
 *
 * Nothing here decides who is a moderator. The rules do: a signed-in account that is not the
 * moderator gets `permission-denied` on the first query, and the page says so. That is why no
 * address is written into this file.
 */
export function auth(): Auth {
  return getAuth(app());
}

export type PendingKind = 'question' | 'live-answer' | 'thread-answer';

export type PendingItem = {
  kind: PendingKind;
  ref: DocumentReference;
  /** Where the post will appear once published. */
  href: string;
  /** Question title, or the thread slug for an archive answer. */
  context: string;
  isReply: boolean;
  title: string | null;
  name: string;
  body: string;
  email: string | null;
  createdAt: Date | null;
};

function toDate(value: unknown): Date | null {
  const ts = value as Timestamp | undefined;
  return ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
}

/** Posts written before the address moved out carry `email` on the post itself. */
async function contactFor(snap: DocumentSnapshot): Promise<string | null> {
  const legacy = snap.get('email');
  if (typeof legacy === 'string' && legacy) return legacy;
  const contact = await getDoc(doc(snap.ref, 'private', 'contact'));
  return contact.exists() ? String(contact.get('email') ?? '') || null : null;
}

export async function listPending(): Promise<PendingItem[]> {
  const pending = where('status', '==', 'pending');
  const [questions, liveAnswers, threadAnswers] = await Promise.all([
    getDocs(query(collection(db(), 'questions'), pending, orderBy('createdAt', 'desc'))),
    getDocs(query(collectionGroup(db(), 'answers'), pending)),
    getDocs(query(collection(db(), 'threadAnswers'), pending, orderBy('createdAt', 'asc'))),
  ]);

  const items = await Promise.all([
    ...questions.docs.map(async (d): Promise<PendingItem> => ({
      kind: 'question',
      ref: d.ref,
      href: `/questions/live/?id=${encodeURIComponent(d.id)}`,
      context: 'New question',
      isReply: false,
      title: String(d.get('title') ?? ''),
      name: String(d.get('name') ?? ''),
      body: String(d.get('body') ?? ''),
      email: await contactFor(d),
      createdAt: toDate(d.get('createdAt')),
    })),
    ...liveAnswers.docs.map(async (d): Promise<PendingItem> => {
      const question = d.ref.parent.parent!;
      const parent = await getDoc(question).catch(() => null);
      return {
        kind: 'live-answer',
        ref: d.ref,
        href: `/questions/live/?id=${encodeURIComponent(question.id)}`,
        context: parent?.exists() ? String(parent.get('title') ?? question.id) : question.id,
        isReply: Boolean(d.get('parentId')),
        title: null,
        name: String(d.get('name') ?? ''),
        body: String(d.get('body') ?? ''),
        email: await contactFor(d),
        createdAt: toDate(d.get('createdAt')),
      };
    }),
    ...threadAnswers.docs.map(async (d): Promise<PendingItem> => {
      const slug = String(d.get('slug') ?? '');
      return {
        kind: 'thread-answer',
        ref: d.ref,
        href: `/questions/${slug}/`,
        context: slug,
        isReply: Boolean(d.get('parentId')),
        title: null,
        name: String(d.get('name') ?? ''),
        body: String(d.get('body') ?? ''),
        email: await contactFor(d),
        createdAt: toDate(d.get('createdAt')),
      };
    }),
  ]);

  return items.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
}

export async function approve(item: PendingItem): Promise<void> {
  await updateDoc(item.ref, { status: 'published' });
}

/** Deletes the post and its contact document; Firestore does not delete subcollections for us. */
export async function reject(item: PendingItem): Promise<void> {
  await deleteDoc(doc(item.ref, 'private', 'contact'));
  await deleteDoc(item.ref);
}
