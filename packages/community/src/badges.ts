/**
 * Badges: what earns them, as pure functions.
 *
 * Like reputation, badges are awarded by the service inside the transaction of the action that
 * earns them (a vote, an accept, an edit), so a badge can never be granted twice by a race or
 * handed out by a browser. A user's badges live on their public profile, `users/{uid}.badges`.
 *
 * The set follows Stack Overflow's shape (bronze, silver and gold; one-off "first time" badges and
 * per-post score badges), trimmed to what this community can actually earn today.
 */

export type Tier = 'bronze' | 'silver' | 'gold';

export interface BadgeDef {
  id: string;
  name: string;
  tier: Tier;
  description: string;
  /** Per-post badges can be earned once per post; the rest once per user. */
  perPost?: boolean;
}

export const BADGES: readonly BadgeDef[] = [
  {
    id: 'student',
    name: 'Student',
    tier: 'bronze',
    description: 'Asked a question that was upvoted',
  },
  {
    id: 'teacher',
    name: 'Teacher',
    tier: 'bronze',
    description: 'Answered a question with an upvoted answer',
  },
  {
    id: 'scholar',
    name: 'Scholar',
    tier: 'bronze',
    description: 'Accepted an answer to their question',
  },
  { id: 'supporter', name: 'Supporter', tier: 'bronze', description: 'Cast a first upvote' },
  { id: 'critic', name: 'Critic', tier: 'bronze', description: 'Cast a first downvote' },
  { id: 'editor', name: 'Editor', tier: 'bronze', description: 'Made a first edit' },
  {
    id: 'nice-question',
    name: 'Nice Question',
    tier: 'bronze',
    description: 'Question score of 10',
    perPost: true,
  },
  {
    id: 'good-question',
    name: 'Good Question',
    tier: 'silver',
    description: 'Question score of 25',
    perPost: true,
  },
  {
    id: 'great-question',
    name: 'Great Question',
    tier: 'gold',
    description: 'Question score of 100',
    perPost: true,
  },
  {
    id: 'nice-answer',
    name: 'Nice Answer',
    tier: 'bronze',
    description: 'Answer score of 10',
    perPost: true,
  },
  {
    id: 'good-answer',
    name: 'Good Answer',
    tier: 'silver',
    description: 'Answer score of 25',
    perPost: true,
  },
  {
    id: 'great-answer',
    name: 'Great Answer',
    tier: 'gold',
    description: 'Answer score of 100',
    perPost: true,
  },
  {
    id: 'accepted-guru',
    name: 'Guru',
    tier: 'silver',
    description: 'Accepted answer with a score of 40',
    perPost: true,
  },
];

const DEF = new Map(BADGES.map((b) => [b.id, b]));

export interface Awarded {
  id: string;
  tier: Tier;
  /** The post that earned it, for per-post badges. */
  post?: string;
  at: string;
}

/** Whether a user already holds this badge (for this post, when it is per-post). */
const holds = (have: Awarded[], id: string, post?: string) =>
  have.some((b) => b.id === id && (!DEF.get(id)?.perPost || b.post === post));

function grant(have: Awarded[], id: string, at: Date, post?: string): Awarded[] {
  const def = DEF.get(id);
  if (!def || holds(have, id, post)) return [];
  return [{ id, tier: def.tier, ...(def.perPost ? { post } : {}), at: at.toISOString() }];
}

/** Badges the post's author earns when its score reaches `score`. */
export function forScore(p: {
  kind: 'question' | 'answer';
  score: number;
  accepted: boolean;
  post: string;
  have: Awarded[];
  at: Date;
}): Awarded[] {
  const out: Awarded[] = [];
  const add = (id: string, perPost = false) =>
    out.push(...grant([...p.have, ...out], id, p.at, perPost ? p.post : undefined));
  if (p.score >= 1) add(p.kind === 'question' ? 'student' : 'teacher');
  const [nice, good, great] =
    p.kind === 'question'
      ? ['nice-question', 'good-question', 'great-question']
      : ['nice-answer', 'good-answer', 'great-answer'];
  if (p.score >= 10) add(nice!, true);
  if (p.score >= 25) add(good!, true);
  if (p.score >= 100) add(great!, true);
  if (p.kind === 'answer' && p.accepted && p.score >= 40) add('accepted-guru', true);
  return out;
}

/** Badges the voter earns for casting a vote. */
export const forVoting = (value: -1 | 0 | 1, have: Awarded[], at: Date): Awarded[] =>
  value === 1 ? grant(have, 'supporter', at) : value === -1 ? grant(have, 'critic', at) : [];

/** Badges the asker earns for accepting someone else's answer. */
export const forAccepting = (have: Awarded[], at: Date): Awarded[] => grant(have, 'scholar', at);

/** Badges an editor earns for an applied edit. */
export const forEditing = (have: Awarded[], at: Date): Awarded[] => grant(have, 'editor', at);

/** Reads a stored badges array defensively: unknown shapes are dropped, not trusted. */
export function readBadges(v: unknown): Awarded[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((b) => {
    if (typeof b !== 'object' || b === null) return [];
    const { id, tier, post, at } = b as Record<string, unknown>;
    if (typeof id !== 'string' || !DEF.has(id)) return [];
    return [
      {
        id,
        tier: (typeof tier === 'string' ? tier : DEF.get(id)!.tier) as Tier,
        ...(typeof post === 'string' ? { post } : {}),
        at: typeof at === 'string' ? at : '',
      },
    ];
  });
}
