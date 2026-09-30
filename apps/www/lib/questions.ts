import { COMMUNITY_ENABLED, COMMUNITY_URL } from '@/lib/community';

/**
 * What the Q&A pages read, from the community service's public routes (packages/community). Only
 * published posts and public profile fields come back, so nothing here needs a sign-in.
 *
 * With no service configured (`NEXT_PUBLIC_COMMUNITY_URL` unset, as in a fork's build), reads come
 * back empty and the pages show only the static archive.
 */

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

export type BadgeCounts = { gold: number; silver: number; bronze: number };

export type Profile = {
  rep: number;
  role: string;
  display: string;
  badges: Array<{ id: string; tier: 'gold' | 'silver' | 'bronze'; post?: string; at: string }>;
  counts: BadgeCounts;
};

export type Revision = {
  revision: number;
  title: string | null;
  body: string;
  byName: string;
  comment: string;
  createdAt: Date | null;
};

/** Where a post goes: a live question, or an archive thread by slug. */
export type AnswerTarget = { kind: 'live'; questionId: string } | { kind: 'thread'; slug: string };

// The service's JSON, dates as ISO strings.
type Dated<T> = Omit<T, 'createdAt'> & { createdAt: string | null };
type WireAnswer = Dated<Answer>;
type WireQuestion = Omit<Dated<Question>, 'answers' | 'category'> & {
  category: string;
  answers: WireAnswer[];
};

const toDate = (iso: string | null) => (iso ? new Date(iso) : null);
const isCategory = (c: string): c is Category => CATEGORIES.some((x) => x.value === c);

const toAnswer = (a: WireAnswer): Answer => ({ ...a, createdAt: toDate(a.createdAt) });
const toQuestion = (q: WireQuestion): Question => ({
  ...q,
  category: isCategory(q.category) ? q.category : 'other',
  createdAt: toDate(q.createdAt),
  answers: q.answers.map(toAnswer),
});

function toProfile(p: Omit<Profile, 'counts'>): Profile {
  const counts: BadgeCounts = { gold: 0, silver: 0, bronze: 0 };
  for (const b of p.badges) if (b.tier in counts) counts[b.tier] += 1;
  return { ...p, counts };
}

async function read<T>(route: string): Promise<T | null> {
  if (!COMMUNITY_ENABLED) return null;
  const res = await fetch(`${COMMUNITY_URL}${route}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load ${route} (${res.status})`);
  return (await res.json()) as T;
}

/** Published questions, newest first, with their published answers. */
export async function listQuestions(): Promise<Question[]> {
  const data = await read<{ items: WireQuestion[] }>('/questions?limit=50');
  return (data?.items ?? []).map(toQuestion);
}

/** One published question with its answers, or null when there is none. */
export async function getQuestion(id: string): Promise<Question | null> {
  const q = await read<WireQuestion>(`/questions/${encodeURIComponent(id)}`);
  return q ? toQuestion(q) : null;
}

/** Answers and replies on a static archive thread, keyed by its slug. */
export async function listThreadAnswers(slug: string): Promise<Answer[]> {
  const data = await read<{ items: WireAnswer[] }>(`/threads/${encodeURIComponent(slug)}/answers`);
  return (data?.items ?? []).map(toAnswer);
}

/** Public profile basics for signed-in authors: reputation and role. Missing profiles are skipped. */
export async function profiles(uids: string[]): Promise<Record<string, Profile>> {
  const unique = [...new Set(uids)].slice(0, 50);
  if (!unique.length) return {};
  const data = await read<{ profiles: Record<string, Omit<Profile, 'counts'>> }>(
    `/profiles?uids=${unique.map(encodeURIComponent).join(',')}`,
  );
  return Object.fromEntries(
    Object.entries(data?.profiles ?? {}).map(([uid, p]) => [uid, toProfile(p)]),
  );
}

export async function profile(uid: string): Promise<Profile | null> {
  return (await profiles([uid]))[uid] ?? null;
}

/** A post's applied revisions, oldest first. Public, as on Stack Overflow. */
export async function revisions(path: string): Promise<Revision[]> {
  const data = await read<{ items: Dated<Revision>[] }>(
    `/revisions?path=${encodeURIComponent(path)}`,
  );
  return (data?.items ?? []).map((r) => ({ ...r, createdAt: toDate(r.createdAt) }));
}

export type FeedbackKindStored = 'feature' | 'bug' | 'feedback';

/**
 * Store a feature request or bug report. Feedback is never shown on the site; only the moderator
 * reads it.
 *
 * This exists because `mailto:` is not a delivery mechanism: a visitor with no mail client
 * configured clicks the button and nothing happens, silently.
 */
export async function submitFeedback(input: {
  kind: FeedbackKindStored;
  title: string;
  body: string;
  name: string;
  email: string;
}): Promise<void> {
  if (!COMMUNITY_ENABLED) throw new Error('Feedback is not available on this build of the site.');
  const res = await fetch(`${COMMUNITY_URL}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'site',
      kind: input.kind,
      title: input.title.trim(),
      body: input.body.trim(),
      name: input.name.trim(),
      email: input.email.trim(),
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Could not send feedback (${res.status})`);
  }
}
