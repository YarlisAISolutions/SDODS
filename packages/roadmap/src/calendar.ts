/**
 * Where the calendar stands against the road.
 *
 * `state` is an evidence claim and stays authored: a stop is `delivered` only when its proof can
 * be repeated, never because a date went by. What the clock does decide is whether a stop's time
 * has passed. A month or year that has ended without being delivered is overdue, which the sites
 * show and `scripts/roadmap-issues.ts` turns into a GitHub issue.
 *
 * The sites are static exports, so "today" is the build date. The www and docs workflows rebuild
 * on the first of every month, so the page moves on without anyone editing it. `ROADMAP_TODAY`
 * (YYYY-MM) pins the date for tests and dry runs.
 */
import { CHECKPOINTS } from './checkpoints';
import type { Checkpoint } from './types';
import { isMonth, isYear } from './types';

/** The calendar relative to a stop: its time has ended, is running, or has not started. */
export type Timing = 'past' | 'current' | 'future';

/** `YYYY-MM` in UTC, so a build near midnight does not depend on the runner's timezone. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function resolveToday(): string {
  // Written as the plain member expression on purpose: both Next configs inline
  // `process.env.ROADMAP_TODAY` at build, so client components see the build month too.
  const pinned = process.env.ROADMAP_TODAY;
  if (pinned) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(pinned)) {
      throw new Error(`ROADMAP_TODAY must be YYYY-MM, got "${pinned}"`);
    }
    return pinned;
  }
  return monthOf(new Date());
}

/** The month the site was built in. */
export const TODAY_MONTH: string = resolveToday();

/** The calendar year the site was built in. */
export const TODAY_YEAR: number = Number(TODAY_MONTH.slice(0, 4));

/** Chapters carry no date, so they have no timing. */
export function timing(checkpoint: Checkpoint, today: string = TODAY_MONTH): Timing | undefined {
  if (isMonth(checkpoint)) {
    if (checkpoint.when < today) return 'past';
    return checkpoint.when === today ? 'current' : 'future';
  }
  if (isYear(checkpoint)) {
    const year = Number(today.slice(0, 4));
    if (checkpoint.year < year) return 'past';
    return checkpoint.year === year ? 'current' : 'future';
  }
  return undefined;
}

/** Its time has ended and its proof has not been shown. */
export function isOverdue(checkpoint: Checkpoint, today: string = TODAY_MONTH): boolean {
  return checkpoint.state !== 'delivered' && timing(checkpoint, today) === 'past';
}

/** Every stop whose time has ended undelivered, oldest first. */
export function overdue(today: string = TODAY_MONTH): Checkpoint[] {
  return CHECKPOINTS.filter((c) => isOverdue(c, today));
}
