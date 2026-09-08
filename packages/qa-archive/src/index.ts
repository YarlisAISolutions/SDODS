export * from './types';
export * from './blocks';
export * from './tags';
export * from './people';
export { USE_CASES } from './use-cases';

import { excerpt } from './blocks';
import { PEOPLE } from './people';
import { TAG_NAMES, type Tag } from './tags';
import { ALL_THREADS } from './threads';
import type { Thread } from './types';

/** Every thread, newest first — the order the list page and the sitemap both want. */
export const THREADS: Thread[] = [...ALL_THREADS].sort((a, b) =>
  b.askedOn.localeCompare(a.askedOn),
);

const BY_SLUG = new Map(THREADS.map((t) => [t.slug, t]));

export function thread(slug: string): Thread | undefined {
  return BY_SLUG.get(slug);
}

export function threadsByTag(tag: Tag): Thread[] {
  return THREADS.filter((t) => t.tags.includes(tag));
}

/** How many threads carry each tag, for the tag index. */
export const TAG_COUNTS: Record<string, number> = Object.fromEntries(
  TAG_NAMES.map((name) => [name, THREADS.filter((t) => t.tags.includes(name)).length]),
);

/** What a person asked and what they answered, for their profile page. */
export function threadsByPerson(handle: string): { asked: Thread[]; answered: Thread[] } {
  return {
    asked: THREADS.filter((t) => t.askedBy === handle),
    answered: THREADS.filter((t) => t.askedBy !== handle && t.answers.some((a) => a.by === handle)),
  };
}

export const PEOPLE_BY_REP = [...PEOPLE].sort((a, b) => b.rep - a.rep);

/** The compact record the list page searches over. Deliberately carries no body. */
export interface ThreadSummary {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  askedBy: string;
  askedOn: string;
  votes: number;
  views: number;
  answers: number;
  accepted: boolean;
}

export function summarise(t: Thread): ThreadSummary {
  return {
    slug: t.slug,
    title: t.title,
    excerpt: excerpt(t.body),
    tags: [...t.tags],
    askedBy: t.askedBy,
    askedOn: t.askedOn,
    votes: t.votes,
    views: t.views,
    answers: t.answers.length,
    accepted: Boolean(t.acceptedAnswerId),
  };
}

export const SUMMARIES: ThreadSummary[] = THREADS.map(summarise);
