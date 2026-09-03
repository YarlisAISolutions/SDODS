/** DTOs shared by runtime, ingest, server and web. Keep these plain (JSON-serialisable). */
import type { BrowserName, Layer } from './schemas/project.js';

export type SuiteStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted' | 'unknown';
export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'error';
export type RunTrigger = 'cli' | 'ui' | 'ci' | 'agent' | 'mcp' | 'schedule';

export interface RunManifest {
  runId: string;
  projectSlug: string;
  env: string;
  tagsExpr?: string;
  layers: Layer[];
  browsers: BrowserName[];
  suiteTag?: string;
  trigger: RunTrigger;
  git?: { sha?: string; branch?: string; dirty?: boolean };
  ci?: { provider?: string; runId?: string; url?: string };
  startedAt: string;
  finishedAt?: string;
  command: string;
  shardIndex?: number;
  shardTotal?: number;
  automaxVersion: string;
  playwrightVersion?: string;
  exitCode?: number;
  ingestedAt?: string;
}

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  flaky: number;
  healed: number;
  durationMs: number;
}

export interface RunRecord {
  id: string;
  projectSlug: string;
  env: string;
  trigger: RunTrigger;
  status: RunStatus;
  suiteTag?: string;
  tagsExpr?: string;
  layers: Layer[];
  browsers: BrowserName[];
  gitSha?: string;
  gitBranch?: string;
  ciProvider?: string;
  ciRunId?: string;
  ciUrl?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  totals?: RunTotals;
  artifactsDir?: string;
  exitCode?: number;
  errorText?: string;
}

export interface ScenarioMeta {
  runId: string;
  fingerprint: string;
  testId: string;
  project: string;
  layer: Layer;
  browser?: BrowserName;
  pwProject: string;
  featureUri: string;
  featureName: string;
  scenarioName: string;
  pickleLine?: number;
  exampleIndex?: number | null;
  tags: string[];
  retry: number;
  workerIndex: number;
  parallelIndex: number;
  status?: SuiteStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  apiCalls?: number;
  heals?: number;
  dir: string;
}

export interface ScenarioResult {
  id: string;
  runId: string;
  fingerprint: string;
  naturalKey: string;
  source: 'gherkin' | 'pw-json';
  featureUri: string;
  featureName: string;
  scenarioName: string;
  exampleIndex?: number | null;
  pwProject: string;
  layer: Layer;
  browser?: BrowserName;
  suiteTag?: string;
  tags: string[];
  jiraKeys: string[];
  status: SuiteStatus;
  attemptsCount: number;
  flaky: boolean;
  durationMs?: number;
  errorMessage?: string;
  errorStack?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface StepResult {
  id: string;
  attemptId: string;
  scenarioId: string;
  runId: string;
  stepIndex: number;
  kind: 'step' | 'hook';
  hookType?: 'before' | 'after';
  keyword?: string;
  text: string;
  argument?: unknown;
  status: SuiteStatus;
  durationMs?: number;
  errorMessage?: string;
  errorStack?: string;
  definitionLocation?: string;
  layerHint?: 'ui' | 'api';
  apiSnapshot?: ApiSnapshot;
  perf?: PerformanceMetrics;
  startedAt?: string;
  finishedAt?: string;
}

export type ArtifactKind =
  'screenshot' | 'trace' | 'video' | 'har' | 'log' | 'report' | 'visual' | 'diff' | 'attachment';
export type ArtifactPhase =
  | 'before'
  | 'after'
  | 'scenario-start'
  | 'scenario-end'
  | 'failure'
  | 'expected'
  | 'actual'
  | 'diff';

export interface ScreenshotArtifact {
  id: string;
  runId: string;
  scenarioId?: string;
  attemptId?: string;
  stepId?: string;
  stepIndex?: number | null;
  kind: ArtifactKind;
  phase?: ArtifactPhase | null;
  mediaType: string;
  fileName: string;
  relPath: string;
  sizeBytes: number;
  sha256?: string;
  width?: number | null;
  height?: number | null;
  meta?: Record<string, unknown>;
}

export interface ApiSnapshot {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
    rawBody?: string;
    responseTime: number;
  };
  startedAt: string;
  replayedFromHar?: boolean;
}

export interface HealCandidate {
  strategy: string;
  selector: string;
  score: number;
  count?: number;
  visible?: boolean;
  enabled?: boolean;
  ms?: number;
}

export interface HealEvent {
  fingerprint: string;
  runId: string;
  stepIndex: number;
  action: 'click' | 'fill' | 'select' | 'assert' | 'hover' | 'check';
  description: string;
  pageUrl: string;
  originalSelector: string;
  context: Record<string, unknown>;
  strategyUsed: string | null;
  healedSelector: string | null;
  candidates: HealCandidate[];
  succeeded: boolean;
  durationMs: number;
  at: string;
}

export interface PerformanceMetrics {
  url: string;
  timestamp: string;
  domContentLoaded: number;
  pageLoadTime: number;
  timeToFirstByte: number;
  totalResources: number;
  totalResourceSizeKB: number;
  firstContentfulPaint: number | null;
  largestContentfulPaint: number | null;
}

export interface StepDef {
  keyword: 'Given' | 'When' | 'Then' | 'Unknown';
  pattern: string;
  file?: string;
  line?: number;
  source?: 'core' | 'project';
}

export interface LintFinding {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  file: string;
  line?: number;
  column?: number;
  fix?: { description: string; insertTag?: string };
}

export interface LintResult {
  errors: LintFinding[];
  warnings: LintFinding[];
  filesChecked: number;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  totals: RunTotals;
  byProject: Record<string, RunTotals>;
  failed: Array<{ fingerprint: string; title: string; pwProject: string; error?: string }>;
  flaky: Array<{ fingerprint: string; title: string; pwProject: string }>;
  reportPaths: { html?: string; dashboard?: string; messages?: string; junit?: string };
}
