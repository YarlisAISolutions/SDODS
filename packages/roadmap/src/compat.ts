import { CHECKPOINTS } from './checkpoints';
import { TODAY_YEAR } from './calendar';
import { LADDER } from './ladder';
import { isChapter, isMonth, type Checkpoint, type RoadmapPhase } from './types';

/**
 * The shapes the marketing site already renders, derived rather than duplicated.
 *
 * They exist so `apps/www` keeps working unchanged while there is only one place to edit.
 */

export interface HorizonYear {
  year: number;
  level: number;
  name: string;
  state: (typeof LADDER)[number]['state'];
  value: string;
  because: string;
  features: string[];
  milestone: string;
  maxi: string;
}

export const HORIZON: HorizonYear[] = LADDER.map((arc) => ({
  year: arc.displayYear,
  level: arc.level,
  name: arc.name,
  state: arc.state,
  value: arc.value,
  because: arc.because,
  features: arc.features,
  milestone: arc.milestone,
  maxi: arc.maxi,
}));

/** The fourteen phases, flattened back out of the chapters that group them. */
export const ROADMAP: RoadmapPhase[] = CHECKPOINTS.filter(isChapter)
  .flatMap((chapter) => chapter.phases)
  .sort((a, b) => a.phase - b.phase);

/** Shown under the ladder so a reader can place their own team on it. */
export const LEVELS: ReadonlyArray<readonly [number, string, string]> = LADDER.map(
  (arc) => [arc.level, arc.name, arc.tagline] as const,
);

/** The nearest items, in the order they are likely to land. */
export const NEXT_UP: string[] = [
  ...CHECKPOINTS.filter(isMonth)
    .slice(0, 4)
    .map((month) => month.title),
  'Your idea — open a feature request',
];

/** The checkpoint the traveller is standing on. */
export const CURRENT: Checkpoint = CHECKPOINTS.find((c) => c.state === 'now')!;

/**
 * The calendar year the "today" marker sits on: the year the site was built in.
 *
 * It used to be read from the current checkpoint's date, so while the work ran ahead of the
 * calendar the rail flagged a year that had not started yet. The work marker is `CURRENT`; the
 * calendar is `TODAY_YEAR`, and the sites rebuild monthly so it moves on by itself.
 */
export const CURRENT_YEAR: number = TODAY_YEAR;

/** The rung being climbed right now, which may sit a year ahead of the calendar. */
export const CURRENT_LEVEL_YEAR: number = LADDER.find((a) => a.level === CURRENT.arc)!.displayYear;
