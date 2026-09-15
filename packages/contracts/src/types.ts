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
  process?: string;
  modules?: string[];
  sdodsVersion: string;
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
  runnerProject: string;
  featureUri: string;
  featureName: string;
  scenarioName: string;
  pickleLine?: number;
  exampleIndex?: number | null;
  tags: string[];
  module?: string;
  process?: string;
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
  source: 'gherkin' | 'runner-json';
  featureUri: string;
  featureName: string;
  scenarioName: string;
  exampleIndex?: number | null;
  runnerProject: string;
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

/**
 * One failed visual baseline check, written next to the scenario's screenshots
 * (`<runDir>/<slug>/<fingerprint>/r<retry>/visual/<name>.failure.json`) so it survives the CI
 * artifact upload and ingest. `sdods baselines` and the server's accept route read it.
 */
export interface VisualFailure {
  /** baseline name without `.png` */
  name: string;
  /** the file name Playwright compared, e.g. `inventory.png` */
  snapshot: string;
  project: string;
  runnerProject: string;
  /** `process.platform` of the machine that ran the check: the baseline belongs to it */
  platform: string;
  fingerprint: string;
  scenarioName: string;
  featureUri: string;
  retry: number;
  stepIndex: number;
  /** `changed`: pixels differ; `size`: dimensions differ; `missing`: no baseline yet */
  reason: 'changed' | 'size' | 'missing';
  /** baseline path, relative to the project root */
  baseline: string;
  /** image paths, relative to the run directory */
  actual: string;
  expected?: string;
  diff?: string;
  diffPixels?: number;
  diffRatio?: number;
  maxDiffPixelRatio: number;
  recordedAt: string;
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
    /** Credential class the request carried (`none`, `bearer`, `basic`, `header:<name>`), never its value. */
    auth?: string;
    /** Sent through an isolated request context with no cookie jar. */
    isolated?: boolean;
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
  failed: Array<{ fingerprint: string; title: string; runnerProject: string; error?: string }>;
  flaky: Array<{ fingerprint: string; title: string; runnerProject: string }>;
  reportPaths: { html?: string; dashboard?: string; messages?: string; junit?: string };
}

// ── Onboarding analysis (`sdods analyze`) and coverage ─────────────────────

export interface Evidence {
  file: string;
  line?: number;
  snippet?: string;
}

export type FrameworkKind = 'frontend' | 'backend' | 'fullstack' | 'mobile';

export interface DetectedFramework {
  name: string;
  kind: FrameworkKind;
  version?: string;
  confidence: number;
  evidence: Evidence[];
}

export interface DetectedRoute {
  path: string;
  kind: 'page' | 'api';
  method?: string;
  source: string;
  file: string;
  line?: number;
  params: string[];
}

export interface DetectedOpenApi {
  file: string;
  version?: string;
  title?: string;
  endpoints: Array<{ method: string; path: string; tag?: string; operationId?: string }>;
}

export interface DetectedTests {
  framework: 'playwright' | 'cypress' | 'cucumber' | 'jest' | 'vitest' | 'other';
  files: number;
  sampleFiles: string[];
  locators: { css: number; xpath: number; role: number; testId: number; text: number };
}

export interface ChecklistItem {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  fix?: string;
}

export interface AnalysisReport {
  appPath: string;
  analyzedAt: string;
  filesScanned: number;
  packageManager: {
    name: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'maven' | 'gradle' | 'unknown';
    monorepo: boolean;
    workspaces: string[];
    evidence: Evidence[];
  };
  frameworks: DetectedFramework[];
  routes: DetectedRoute[];
  openapi: DetectedOpenApi[];
  testIds: { attribute: string | null; counts: Record<string, number>; confidence: number };
  existingTests: DetectedTests[];
  auth: {
    pages: string[];
    libraries: string[];
    strategyGuess: 'none' | 'form' | 'token' | 'sso' | 'oauth-client-credentials';
    confidence: number;
    evidence: Evidence[];
  };
  envs: Array<{
    name: string;
    file: string;
    uiBaseUrl?: string;
    apiBaseUrl?: string;
    vars: string[];
  }>;
  baseUrls: { ui?: string; api?: string; evidence: Evidence[] };
  ci: {
    provider: 'github' | 'gitlab' | 'circleci' | 'azure' | 'jenkins' | 'bitbucket' | 'none';
    files: string[];
  };
  i18n: { libraries: string[]; locales: string[] };
  a11y: { tooling: string[] };
  checklist: ChecklistItem[];
}

export interface CoverageScenarioRef {
  feature: string;
  scenario: string;
  suite?: string;
  tags: string[];
}

export interface CoverageRow {
  kind: 'route' | 'endpoint' | 'role';
  name: string;
  target: string;
  module?: string;
  covered: boolean;
  scenarios: CoverageScenarioRef[];
  bySuite: Record<string, number>;
}

export interface CoverageReport {
  project: string;
  generatedAt: string;
  suites: string[];
  routes: CoverageRow[];
  endpoints: CoverageRow[];
  roles: CoverageRow[];
  summary: {
    routes: { covered: number; total: number };
    endpoints: { covered: number; total: number };
    roles: { covered: number; total: number };
    scenarios: number;
    bySuite: Record<string, number>;
    uncoveredModules: string[];
  };
}

// ── Requirement traceability (`@req:<id>` → `sdods report traceability`) ──

/** Outcome of one requirement in the chosen run. `not-covered` needs a requirements file. */
export type TraceRequirementStatus = 'passed' | 'failed' | 'not-run' | 'not-covered';
/** Outcome of one scenario across every runner project / example row it ran as. */
export type TraceScenarioStatus = 'passed' | 'failed' | 'skipped' | 'not-run';

/** The final attempt of one scenario in one runner project (and one Examples row for outlines). */
export interface TraceResult {
  runnerProject: string;
  layer?: string;
  browser?: string;
  /** 1-based Examples row for a Scenario Outline, null for a plain scenario. */
  exampleIndex: number | null;
  status: SuiteStatus;
  attempts: number;
  /** failed at least once, then passed on a retry */
  flaky: boolean;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface TraceScenario {
  /** feature file, relative to the project root */
  feature: string;
  featureName: string;
  line: number;
  name: string;
  /** effective tags: Feature + Rule + Scenario + Examples */
  tags: string[];
  requirements: string[];
  status: TraceScenarioStatus;
  results: TraceResult[];
}

export interface TraceRequirement {
  id: string;
  title?: string;
  url?: string;
  /**
   * Whether the id is listed in the requirements file: `true`/`false` when one is configured,
   * `null` when the project has none (ids are then whatever the tags say).
   */
  declared: boolean | null;
  status: TraceRequirementStatus;
  scenarios: TraceScenario[];
}

export interface TraceRunInfo {
  id: string;
  env?: string;
  trigger?: string;
  command?: string;
  tagsExpr?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  git?: { sha?: string; branch?: string; dirty?: boolean };
  ci?: { provider?: string; runId?: string; url?: string };
  sdodsVersion?: string;
  playwrightVersion?: string;
  /** where scenario results were read from */
  resultsSource: 'cucumber-messages' | 'scenario-meta' | 'none';
}

/**
 * Filled in by a person, never by SDODS. Sign-off authority is human and not delegable, so the
 * export carries the empty block and every field stays null in what the framework writes.
 */
export interface TraceSignOff {
  signedBy: null;
  role: null;
  date: null;
  decision: null;
  notes: null;
}

export interface TraceabilityReport {
  kind: 'sdods-traceability';
  version: 1;
  project: string;
  projectName: string;
  generatedAt: string;
  /** requirements file, relative to the project root */
  requirementsFile?: string;
  run: TraceRunInfo | null;
  requirements: TraceRequirement[];
  /** scenarios that carry no `@req:` tag */
  untraced: Array<Pick<TraceScenario, 'feature' | 'line' | 'name' | 'status'>>;
  summary: {
    requirements: number;
    covered: number;
    passed: number;
    failed: number;
    notRun: number;
    /** null when no requirements file is configured: uncovered ids cannot be known */
    notCovered: number | null;
    /** ids tagged on scenarios but missing from the requirements file */
    undeclared: number;
    scenarios: number;
    tracedScenarios: number;
    untracedScenarios: number;
  };
  signOff: TraceSignOff;
  notes: string[];
}

export interface ProjectProposal {
  slug: string;
  name: string;
  projectYaml: string;
  envYamls: Record<string, string>;
  starterFeatures: Record<string, string>;
  files: Record<string, string>;
  coverageMap: Array<{
    kind: 'route' | 'endpoint';
    target: string;
    module: string;
    starterFeature?: string;
  }>;
  checklist: ChecklistItem[];
  notes: string[];
}
