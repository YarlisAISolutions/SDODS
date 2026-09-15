/**
 * Attachment naming convention shared by the runtime (which attaches) and the DB ingest (which parses).
 * Names must never start with "_" (playwright-bdd hides those).
 */
export type ScenarioShotPhase = 'start' | 'end' | 'failure';
export type StepShotPhase = 'before' | 'after';

export const ATTACHMENT_PREFIX = 'sdods/';

/**
 * Minimum length of a web UI password, enforced by the server. Shared so the CLI's help text and
 * the new-user form describe the same rule: they used to say 8, 8 and 10, and the form silently
 * disabled its own Create button for a password the server would have accepted.
 */
export const MIN_PASSWORD_LENGTH = 8;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export const attachmentNames = {
  shotScenario: (phase: ScenarioShotPhase) => `sdods/shot/scenario/${phase}`,
  shotStep: (stepIndex: number, phase: StepShotPhase) =>
    `sdods/shot/step/${pad2(stepIndex)}/${phase}`,
  visual: (stepIndex: number, name: string) => `sdods/visual/${pad2(stepIndex)}/${name}`,
  api: (stepIndex: number, callIndex: number, kind: 'request' | 'response') =>
    `sdods/api/${pad2(stepIndex)}/${callIndex}/${kind}`,
  heal: (stepIndex: number, n: number) => `sdods/heal/${pad2(stepIndex)}/${n}`,
  perf: (stepIndex: number) => `sdods/perf/${pad2(stepIndex)}`,
  a11y: (stepIndex: number) => `sdods/a11y/${pad2(stepIndex)}`,
  /**
   * The end-of-scenario audit an `@a11y` tag runs, and the budget verdict an `@perf` tag produces.
   * Deliberately NOT `sdods/a11y/<NN>` / `sdods/perf/<NN>`: those are keyed by step index (the perf
   * one is ingested into `steps.perf_json` as `PerformanceMetrics`), and a scenario-level report
   * parked at a step index would overwrite the explicit step that ran there.
   */
  a11yScenario: 'sdods/a11y-scenario',
  perfScenario: 'sdods/perf-scenario',
  cleanupErrors: 'sdods/cleanup-errors',
  meta: 'sdods/meta',
} as const;

export type ParsedAttachment =
  | { kind: 'shot-scenario'; phase: ScenarioShotPhase }
  | { kind: 'shot-step'; stepIndex: number; phase: StepShotPhase }
  | { kind: 'visual'; stepIndex: number; name: string }
  | { kind: 'api'; stepIndex: number; callIndex: number; part: 'request' | 'response' }
  | { kind: 'heal'; stepIndex: number; n: number }
  | { kind: 'perf'; stepIndex: number }
  | { kind: 'a11y'; stepIndex: number }
  | { kind: 'a11y-scenario' }
  | { kind: 'perf-scenario' }
  | { kind: 'cleanup-errors' }
  | { kind: 'meta' }
  | { kind: 'visual-baseline'; phase: 'expected' | 'actual' | 'diff'; name: string }
  | { kind: 'runner-builtin'; name: 'trace' | 'screenshot' | 'video' }
  | { kind: 'other'; name: string };

export function parseAttachmentName(name: string): ParsedAttachment {
  if (name.startsWith(ATTACHMENT_PREFIX)) {
    const segs = name.slice(ATTACHMENT_PREFIX.length).split('/');
    switch (segs[0]) {
      case 'shot': {
        if (segs[1] === 'scenario' && isScenarioPhase(segs[2]))
          return { kind: 'shot-scenario', phase: segs[2] };
        if (segs[1] === 'step' && segs[2] !== undefined && isStepPhase(segs[3]))
          return { kind: 'shot-step', stepIndex: Number(segs[2]), phase: segs[3] };
        break;
      }
      case 'visual':
        if (segs[1] !== undefined && segs[2] !== undefined)
          return { kind: 'visual', stepIndex: Number(segs[1]), name: segs.slice(2).join('/') };
        break;
      case 'api':
        if (
          segs[1] !== undefined &&
          segs[2] !== undefined &&
          (segs[3] === 'request' || segs[3] === 'response')
        )
          return {
            kind: 'api',
            stepIndex: Number(segs[1]),
            callIndex: Number(segs[2]),
            part: segs[3],
          };
        break;
      case 'heal':
        if (segs[1] !== undefined && segs[2] !== undefined)
          return { kind: 'heal', stepIndex: Number(segs[1]), n: Number(segs[2]) };
        break;
      case 'perf':
        if (segs[1] !== undefined) return { kind: 'perf', stepIndex: Number(segs[1]) };
        break;
      case 'a11y':
        if (segs[1] !== undefined) return { kind: 'a11y', stepIndex: Number(segs[1]) };
        break;
      case 'a11y-scenario':
        return { kind: 'a11y-scenario' };
      case 'perf-scenario':
        return { kind: 'perf-scenario' };
      case 'cleanup-errors':
        return { kind: 'cleanup-errors' };
      case 'meta':
        return { kind: 'meta' };
    }
    return { kind: 'other', name };
  }
  const visual = /^(.*)-(expected|actual|diff)\.png$/.exec(name);
  if (visual)
    return {
      kind: 'visual-baseline',
      phase: visual[2] as 'expected' | 'actual' | 'diff',
      name: visual[1]!,
    };
  if (name === 'trace' || name === 'screenshot' || name === 'video')
    return { kind: 'runner-builtin', name };
  return { kind: 'other', name };
}

function isScenarioPhase(v: string | undefined): v is ScenarioShotPhase {
  return v === 'start' || v === 'end' || v === 'failure';
}
function isStepPhase(v: string | undefined): v is StepShotPhase {
  return v === 'before' || v === 'after';
}

/** File names inside a scenario attempt directory (`<runDir>/<slug>/<fingerprint>/r<retry>/`). */
export const scenarioFiles = {
  meta: 'meta.json',
  scenarioShot: (phase: ScenarioShotPhase) => `scenario-${phase}.png`,
  stepShot: (stepIndex: number, phase: StepShotPhase) => `${pad2(stepIndex)}-${phase}.png`,
  apiJson: (stepIndex: number, callIndex: number, part: 'request' | 'response') =>
    `api/${pad2(stepIndex)}-${callIndex}-${part}.json`,
  healLog: 'heal.jsonl',
  perfJson: (stepIndex: number) => `perf/${pad2(stepIndex)}.json`,
  a11yJson: (stepIndex: number) => `a11y/${pad2(stepIndex)}.json`,
  /**
   * Images of a failed visual baseline check. Keyed by run target as well as name: one scenario
   * directory is shared by every browser that ran it.
   */
  visualImage: (runnerProject: string, name: string, phase: 'expected' | 'actual' | 'diff') =>
    `visual/${fileSafeName(runnerProject)}/${fileSafeName(name)}-${phase}.png`,
  /** The `VisualFailure` record `sdods baselines` reads. */
  visualFailure: (runnerProject: string, name: string) =>
    `visual/${fileSafeName(runnerProject)}/${fileSafeName(name)}.failure.json`,
  /** Written when the check passes, so a failure on an earlier retry is not offered for accept. */
  visualPassed: (runnerProject: string, name: string) =>
    `visual/${fileSafeName(runnerProject)}/${fileSafeName(name)}.passed.json`,
  /**
   * Scenario-level reports. The attempt directory is shared by every browser (the fingerprint
   * leaves the browser out), so the runner project name is part of the file name.
   */
  a11yScenarioJson: (runnerProject: string) => `a11y/scenario--${fileSafeName(runnerProject)}.json`,
  perfScenarioJson: (runnerProject: string) => `perf/scenario--${fileSafeName(runnerProject)}.json`,
} as const;

/** File-name-safe form of an attachment or baseline name (matches the DB ingest's `safeName`). */
export function fileSafeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '') || 'attachment';
}

export const runFiles = {
  manifest: 'run.json',
  messages: 'messages.ndjson',
  messagesShard: (shard: number) => `messages.shard-${shard}.ndjson`,
  results: 'runner-results.json',
  htmlReport: 'html-report',
  dashboard: 'dashboard',
  output: 'runner-output',
  junit: 'junit.xml',
  log: 'run.log',
  summary: 'summary.json',
  /** Process gate verdict, written by `sdods run --process` after the run. */
  gates: 'gates.json',
  shardReports: 'shard-reports',
} as const;

/**
 * Names these files carried before the engine-neutral rename. Run directories are long-lived —
 * ingest and the report route still read them so history recorded by an older version keeps working.
 */
export const legacyRunFiles = {
  results: 'pw-results.json',
  htmlReport: 'playwright-report',
  output: 'pw-output',
  shardReports: 'blob-report',
} as const;
