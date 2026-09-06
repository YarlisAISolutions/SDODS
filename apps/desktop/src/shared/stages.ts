/**
 * The first-run install, described as stages and steps.
 *
 * Shared by the main process (which reports progress) and the renderer (which draws it), so the
 * two can never disagree about what the steps are or what order they come in.
 *
 * The percentages are weighted by how long each stage actually takes, not by step count — the two
 * npm installs dominate wall-clock time, so giving every stage an equal slice would park the bar
 * at 40% for most of the wait and then jump.
 */

export type StageId = 'prepare' | 'download' | 'workspace' | 'dependencies' | 'launch';

export interface Step {
  id: string;
  label: string;
}

export interface Stage {
  id: StageId;
  title: string;
  /** Share of the overall bar. The weights sum to 100. */
  weight: number;
  steps: Step[];
}

export const STAGES: Stage[] = [
  {
    id: 'prepare',
    title: 'Preparing',
    weight: 4,
    steps: [
      { id: 'check', label: 'Looking for an existing installation' },
      { id: 'folder', label: 'Creating your workspace folder' },
    ],
  },
  {
    id: 'download',
    title: 'Downloading SDODS',
    weight: 40,
    steps: [
      { id: 'resolve', label: 'Resolving the latest version' },
      { id: 'packages', label: 'Fetching packages' },
    ],
  },
  {
    id: 'workspace',
    title: 'Setting up your workspace',
    weight: 12,
    steps: [
      { id: 'scaffold', label: 'Writing project files' },
      { id: 'demo', label: 'Adding the demo project' },
    ],
  },
  {
    id: 'dependencies',
    title: 'Installing the test runner',
    weight: 24,
    steps: [{ id: 'deps', label: 'Playwright, playwright-bdd and TypeScript' }],
  },
  {
    id: 'launch',
    title: 'Starting SDODS',
    weight: 20,
    steps: [
      { id: 'secret', label: 'Generating a session key' },
      { id: 'serve', label: 'Starting the local server' },
      { id: 'health', label: 'Waiting for it to answer' },
      { id: 'account', label: 'Signing you in' },
    ],
  },
];

/**
 * Roughly how many `npm http fetch|cache` lines each install emits, measured against the real
 * registry: ~635 for `@sdods/cli` (322 packages) and ~39 for the reconcile pass (6 packages).
 *
 * Used only to move the bar during an install, and always clamped to the stage's own band — an
 * install that emits more lines than expected saturates rather than overshooting into the next
 * stage. Exact numbers do not matter; the order of magnitude does.
 */
export const EXPECTED_NPM_LINES = { cli: 640, deps: 40 } as const;

export interface Progress {
  stage: StageId;
  step: string;
  /** 0-100 across the whole install. */
  percent: number;
  /** Sentence for the person watching. */
  message: string;
  /** One line of raw child output, for the details panel. */
  detail?: string;
}

const index = (id: StageId) => STAGES.findIndex((s) => s.id === id);

/** Weight of every stage before this one — the floor of the current stage's band. */
export function stageFloor(id: StageId): number {
  return STAGES.slice(0, index(id)).reduce((sum, s) => sum + s.weight, 0);
}

/** Overall percent, given how far through a stage we are (0..1). */
export function percentFor(id: StageId, fraction: number): number {
  const stage = STAGES[index(id)];
  if (!stage) return 0;
  const clamped = Math.max(0, Math.min(1, fraction));
  return Math.round(stageFloor(id) + stage.weight * clamped);
}

/** True once `stage` is behind `current` — used to tick completed stages in the UI. */
export function isStageComplete(stage: StageId, current: StageId): boolean {
  return index(stage) < index(current);
}
