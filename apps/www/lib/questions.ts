import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

/** The layer tags a scenario carries, so a question can say which one it is about. */
export const CATEGORIES = [
  { value: 'ui', label: 'UI' },
  { value: 'api', label: 'API' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'other', label: 'Something else' },
] as const;

export type Category = (typeof CATEGORIES)[number]['value'];

export type Question = {
  id: string;
  title: string;
  body: string;
  name: string;
  category: Category;
  createdAt: Date | null;
  answers: Answer[];
};

export type Answer = {
  id: string;
  body: string;
  name: string;
  createdAt: Date | null;
};

function toDate(value: unknown): Date | null {
  const ts = value as Timestamp | undefined;
  return ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
}

/**
 * Published questions, newest first, with their published answers. Pending
 * documents are not filtered out here — `firestore.rules` refuses to return
 * them at all, so an unmoderated post cannot reach this code.
 */
export async function listQuestions(): Promise<Question[]> {
  const snap = await getDocs(
    query(
      collection(db(), 'questions'),
      where('status', '==', 'published'),
      orderBy('createdAt', 'desc'),
      limit(50),
    ),
  );

  return Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data();
      const answers = await getDocs(
        query(
          collection(db(), 'questions', doc.id, 'answers'),
          where('status', '==', 'published'),
          orderBy('createdAt', 'asc'),
        ),
      );
      return {
        id: doc.id,
        title: String(data.title ?? ''),
        body: String(data.body ?? ''),
        name: String(data.name ?? ''),
        category: (data.category ?? 'other') as Category,
        createdAt: toDate(data.createdAt),
        answers: answers.docs.map((a) => ({
          id: a.id,
          body: String(a.data().body ?? ''),
          name: String(a.data().name ?? ''),
          createdAt: toDate(a.data().createdAt),
        })),
      };
    }),
  );
}

export type Submission = {
  name: string;
  email: string;
  title: string;
  body: string;
  category: Category;
};

/**
 * Submit a question. It is stored as `pending` and is invisible to everyone
 * (including this site) until a moderator publishes it — the rules enforce the
 * status, so there is no way for a caller to publish its own post.
 */
export async function submitQuestion(input: Submission): Promise<void> {
  await addDoc(collection(db(), 'questions'), {
    name: input.name.trim(),
    email: input.email.trim(),
    title: input.title.trim(),
    body: input.body.trim(),
    category: input.category,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

/** Answer a published question. Also pending until moderated. */
export async function submitAnswer(
  questionId: string,
  input: { name: string; email: string; body: string },
): Promise<void> {
  await addDoc(collection(db(), 'questions', questionId, 'answers'), {
    name: input.name.trim(),
    email: input.email.trim(),
    body: input.body.trim(),
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export type FeedbackKindStored = 'feature' | 'bug' | 'feedback';

/**
 * Store a feature request or bug report. Feedback is never shown on the site —
 * the rules let anyone create one but only the moderator read it back — so
 * there is no pending/published dance here, just a `new` row.
 *
 * This exists because `mailto:` is not a delivery mechanism: a visitor with no
 * mail client configured clicks the button and nothing happens, silently.
 */
export async function submitFeedback(input: {
  kind: FeedbackKindStored;
  title: string;
  body: string;
  name: string;
  email: string;
}): Promise<void> {
  await addDoc(collection(db(), 'feedback'), {
    kind: input.kind,
    title: input.title.trim(),
    body: input.body.trim(),
    name: input.name.trim(),
    email: input.email.trim(),
    status: 'new',
    createdAt: serverTimestamp(),
  });
}
