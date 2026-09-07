/**
 * The roadmap as data.
 *
 * One shape, read by the documentation site, the marketing site and the README, so the three
 * cannot drift apart the way they did when each kept its own copy of the table.
 */

/** Where a checkpoint sits in time: a delivered chapter, a month ahead, or a year of direction. */
export type CheckpointKind = 'chapter' | 'month' | 'year';

/** Delivered, being worked on now, planned with a date, or direction without one. */
export type CheckpointState = 'delivered' | 'now' | 'planned' | 'direction';

export interface RoadmapPhase {
  phase: number;
  scope: string;
  status: 'done' | 'in progress' | 'planned';
  detail?: string;
}

interface CheckpointBase {
  /** Stable slug, also the anchor a reader can link to. */
  id: string;
  /** What the marker says on the road. */
  label: string;
  /** The headline of the card, in a reader's words rather than ours. */
  title: string;
  state: CheckpointState;
  /** Which rung of the ladder this checkpoint climbs. */
  arc: 1 | 2 | 3 | 4 | 5;
  /** What changes for the person using SDODS. */
  goal: string;
  /** The concrete things that land here. */
  ships: string[];
  /** The single fact that proves it landed. */
  proof: string;
  /** What the tutor says when a reader stops here. One sentence, in Maxi's voice. */
  maxi: string;
}

/**
 * Something already delivered. It carries no date field at all: the git history is days old
 * and there is no release record, so a dated past would be invented. The type makes writing
 * one a compile error rather than a matter of discipline.
 */
export interface ChapterCheckpoint extends CheckpointBase {
  kind: 'chapter';
  state: 'delivered';
  /** Position along the road. */
  order: 1 | 2 | 3 | 4 | 5;
  /** The phases this chapter groups. */
  phases: RoadmapPhase[];
}

type Month = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12';

export interface MonthCheckpoint extends CheckpointBase {
  kind: 'month';
  when: `${number}-${Month}`;
}

export interface YearCheckpoint extends CheckpointBase {
  kind: 'year';
  when: `${number}`;
  year: number;
}

export type Checkpoint = ChapterCheckpoint | MonthCheckpoint | YearCheckpoint;

/** One rung of the ladder. Every checkpoint climbs exactly one. */
export interface Arc {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  /** Three words a reader can repeat back. */
  tagline: string;
  state: CheckpointState;
  value: string;
  because: string;
  features: string[];
  milestone: string;
  /** What the tutor says beside this rung. One sentence, in Maxi's voice. */
  maxi: string;
  /** The year the marketing page renders this arc under. */
  displayYear: number;
}

/**
 * One stretch of the road before SDODS existed, named by the problem that defined it.
 */
export interface HistoryEra {
  id: string;
  /** Position along the road. */
  order: 1 | 2 | 3;
  name: string;
  /** Inclusive year range. */
  from: number;
  to: number;
  /** One line a reader can repeat back. */
  tagline: string;
  /** What the tutor says about the whole stretch. */
  maxi: string;
}

/**
 * A year before 2026.
 *
 * It carries no `ships` and no `proof` on purpose. Nothing was released by this project in these
 * years, so the two fields that would imply otherwise do not exist on the type: `shift` records
 * what the industry did, `carried` records the decision that survived into the code. Writing a
 * shipped-in-2017 claim is a compile error rather than a matter of discipline.
 */
export interface HistoryYear {
  year: number;
  /** Which era this year belongs to. */
  era: HistoryEra['order'];
  /** What the marker says on the road. */
  label: string;
  title: string;
  /** What the industry actually did that year, dated against public releases. */
  shift: string;
  /** The design decision it left behind, verifiable in the product today. */
  carried: string;
  /** The tooling that arrived, shown as chips. */
  tech: string[];
}

export interface VerificationRow {
  label: string;
  result: string;
  /** The exact invocation that produced the result, so the next person can repeat it. */
  command: string;
  /** ISO date the result was measured. */
  measuredOn: string;
  note?: string;
}

export const isChapter = (c: Checkpoint): c is ChapterCheckpoint => c.kind === 'chapter';
export const isMonth = (c: Checkpoint): c is MonthCheckpoint => c.kind === 'month';
export const isYear = (c: Checkpoint): c is YearCheckpoint => c.kind === 'year';
