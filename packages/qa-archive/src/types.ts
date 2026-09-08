import type { Handle } from './people';
import type { Tag } from './tags';

/**
 * The shapes the questions archive is written in.
 *
 * Bodies are markdown-lite strings, not nested block objects, and parse through the one
 * `parseBody` in `blocks.ts`. That choice is what lets the same renderer serve both halves of the
 * archive: a thread written here and an answer typed into the site by a stranger are the same kind
 * of string, so live moderated answers get code blocks with no schema change and no second
 * pipeline to keep in step.
 *
 * Tags and handles are union types rather than plain strings, so a typo is a compile error where
 * the author is standing rather than a test failure found an hour later.
 */

/** `YYYY-MM-DD`. Loose enough to be ergonomic, tight enough to catch a swapped format. */
export type IsoDate = `${number}-${number}-${number}`;

/** Where a person sits in the forum. Maintainers carry a badge; the rest do not. */
export type Role = 'maintainer' | 'regular' | 'member';

export interface Person {
  /** URL segment and the @mention form. Lowercase, no spaces. */
  handle: Handle;
  display: string;
  role: Role;
  /** Nobody can post before this. */
  joined: IsoDate;
  /** Reputation, shown next to the handle. */
  rep: number;
  /** One line under the name on their profile page. */
  tagline: string;
}

export interface Answer {
  /** Unique within its thread; the accepted answer is named by this. */
  id: string;
  by: Handle;
  /** Never before the question's own date. */
  on: IsoDate;
  votes: number;
  /** Markdown-lite. See `blocks.ts` for what is recognised. */
  body: string;
}

export interface Thread {
  slug: string;
  title: string;
  askedBy: Handle;
  askedOn: IsoDate;
  /**
   * A non-empty tuple on purpose: every thread must be reachable from at least one tag page, and
   * making that a type guarantee is cheaper than discovering an orphan at build time.
   */
  tags: [Tag, ...Tag[]];
  votes: number;
  views: number;
  /** Markdown-lite. */
  body: string;
  answers: Answer[];
  /** Present exactly when `answers` is non-empty and one of them was accepted. */
  acceptedAnswerId?: string;
}

/** A "how would you test this" entry, distinct from a question thread. */
export interface UseCase {
  slug: string;
  title: string;
  /** The product surface under test. */
  surface: string;
  tags: [Tag, ...Tag[]];
  /** Why the surface resists testing. Markdown-lite. */
  problem: string;
  /** The SDODS construct that addresses it. Markdown-lite. */
  approach: string;
  /** A scenario sketch, usually a Gherkin fence. Markdown-lite. */
  sketch: string;
}
