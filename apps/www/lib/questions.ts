import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
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
  /** The author's account, for posts made signed in; null for older, anonymous ones. */
  uid: string | null;
  score: number;
  /** The answer the asker accepted, or null. */
  acceptedAnswerId: string | null;
  /** 0 until the first edit. */
  revision: number;
  title: string;
  body: string;
  name: string;
  category: Category;
  createdAt: Date | null;
  answers: Answer[];
};

export type Answer = {
  id: string;
  uid: string | null;
  score: number;
  revision: number;
  body: string;
  name: string;
  /** Empty for an answer to the question; otherwise the id of the answer this replies to. */
  parentId: string;
  createdAt: Date | null;
};

function engagement(data: Record<string, unknown>): {
  uid: string | null;
  score: number;
  revision: number;
} {
  return {
    uid: typeof data.uid === 'string' ? data.uid : null,
    score: typeof data.score === 'number' ? data.score : 0,
    revision: typeof data.revision === 'number' ? data.revision : 0,
  };
}

export type BadgeCounts = { gold: number; silver: number; bronze: number };

export type Profile = {
  rep: number;
  role: string;
  display: string;
  badges: Array<{ id: string; tier: 'gold' | 'silver' | 'bronze'; post?: string; at: string }>;
  counts: BadgeCounts;
};

function toProfile(d: Record<string, unknown>): Profile {
  const badges = (Array.isArray(d.badges) ? d.badges : []).flatMap((b) =>
    b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string'
      ? [b as Profile['badges'][number]]
      : [],
  );
  const counts: BadgeCounts = { gold: 0, silver: 0, bronze: 0 };
  for (const b of badges) if (b.tier in counts) counts[b.tier] += 1;
  return {
    rep: typeof d.rep === 'number' ? d.rep : 1,
    role: typeof d.role === 'string' ? d.role : 'member',
    display: typeof d.display === 'string' ? d.display : 'SDODS user',
    badges,
    counts,
  };
}

export async function profile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db(), 'users', uid));
  return snap.exists() ? toProfile(snap.data()) : null;
}

export type Revision = {
  revision: number;
  title: string | null;
  body: string;
  byName: string;
  comment: string;
  createdAt: Date | null;
};

/** A post's applied revisions, oldest first. Public, as on Stack Overflow. */
export async function revisions(path: string): Promise<Revision[]> {
  const snap = await getDocs(
    query(
      collection(db(), 'revisions'),
      where('post', '==', path),
      where('status', '==', 'applied'),
      orderBy('revision', 'asc'),
    ),
  );
  return snap.docs.map((d) => {
    const r = d.data();
    return {
      revision: typeof r.revision === 'number' ? r.revision : 0,
      title: typeof r.title === 'string' ? r.title : null,
      body: String(r.body ?? ''),
      byName: String(r.byName ?? ''),
      comment: String(r.comment ?? ''),
      createdAt: toDate(r.createdAt),
    };
  });
}

/** Public profile basics for signed-in authors: reputation and role. Missing profiles are skipped. */
export async function profiles(uids: string[]): Promise<Record<string, Profile>> {
  const unique = [...new Set(uids)].slice(0, 50);
  const snaps = await Promise.all(unique.map((uid) => getDoc(doc(db(), 'users', uid))));
  const out: Record<string, Profile> = {};
  for (const s of snaps) if (s.exists()) out[s.id] = toProfile(s.data());
  return out;
}

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
        uid: typeof data.uid === 'string' ? data.uid : null,
        score: typeof data.score === 'number' ? data.score : 0,
        revision: typeof data.revision === 'number' ? data.revision : 0,
        acceptedAnswerId:
          typeof data.acceptedAnswerId === 'string' && data.acceptedAnswerId
            ? data.acceptedAnswerId
            : null,
        title: String(data.title ?? ''),
        body: String(data.body ?? ''),
        name: String(data.name ?? ''),
        category: (data.category ?? 'other') as Category,
        createdAt: toDate(data.createdAt),
        answers: answers.docs.map((a) => ({
          id: a.id,
          ...engagement(a.data()),
          body: String(a.data().body ?? ''),
          name: String(a.data().name ?? ''),
          parentId: String(a.data().parentId ?? ''),
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
 * Write a post and its private contact document in one batch.
 *
 * The email never goes on the post itself: once a post is published anyone can read the whole
 * document with the SDK, so the address sits in `<post>/private/contact`, which only the moderator
 * can read. The rules require both halves to land in the same write.
 */
async function createWithContact(
  post: DocumentReference,
  data: Record<string, unknown>,
  email: string,
): Promise<void> {
  const batch = writeBatch(db());
  batch.set(post, { ...data, status: 'pending', createdAt: serverTimestamp() });
  batch.set(doc(post, 'private', 'contact'), {
    email: email.trim(),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Submit a question. It is stored as `pending` and is invisible to everyone
 * (including this site) until a moderator publishes it — the rules enforce the
 * status, so there is no way for a caller to publish its own post.
 */
export async function submitQuestion(input: Submission): Promise<void> {
  await createWithContact(
    doc(collection(db(), 'questions')),
    {
      name: input.name.trim(),
      title: input.title.trim(),
      body: input.body.trim(),
      category: input.category,
    },
    input.email,
  );
}

export type AnswerInput = { name: string; email: string; body: string; parentId?: string };

/** Answer a published question, or reply to one of its answers. Also pending until moderated. */
export async function submitAnswer(questionId: string, input: AnswerInput): Promise<void> {
  await createWithContact(
    doc(collection(db(), 'questions', questionId, 'answers')),
    { name: input.name.trim(), body: input.body.trim(), parentId: input.parentId ?? '' },
    input.email,
  );
}

/**
 * Answers and replies on a static archive thread, keyed by its slug. Archive threads are not
 * Firestore documents, so these live in their own collection rather than under a parent.
 */
export async function listThreadAnswers(slug: string): Promise<Answer[]> {
  const snap = await getDocs(
    query(
      collection(db(), 'threadAnswers'),
      where('slug', '==', slug),
      where('status', '==', 'published'),
      orderBy('createdAt', 'asc'),
    ),
  );
  return snap.docs.map((d) => ({
    id: d.id,
    ...engagement(d.data()),
    body: String(d.data().body ?? ''),
    name: String(d.data().name ?? ''),
    parentId: String(d.data().parentId ?? ''),
    createdAt: toDate(d.data().createdAt),
  }));
}

export async function submitThreadAnswer(slug: string, input: AnswerInput): Promise<void> {
  await createWithContact(
    doc(collection(db(), 'threadAnswers')),
    {
      slug,
      parentId: input.parentId ?? '',
      name: input.name.trim(),
      body: input.body.trim(),
    },
    input.email,
  );
}

/** Where a post goes: a live Firestore question, or an archive thread by slug. */
export type AnswerTarget = { kind: 'live'; questionId: string } | { kind: 'thread'; slug: string };

export function submitTo(target: AnswerTarget, input: AnswerInput): Promise<void> {
  return target.kind === 'live'
    ? submitAnswer(target.questionId, input)
    : submitThreadAnswer(target.slug, input);
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
