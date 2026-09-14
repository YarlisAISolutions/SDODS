import type {
  GitHubIntegrationConfig,
  JiraIntegrationConfig,
  RunRecord,
  RunTotals,
  SuiteStatus,
} from '@sdods/contracts';

export type ProviderName = 'github' | 'jira' | (string & {});

export interface IssueRef {
  provider: ProviderName;
  key: string;
  url: string;
  status: 'open' | 'closed' | 'unknown';
}

export interface IssueLink {
  id: string;
  projectSlug: string;
  provider: ProviderName;
  fingerprint: string;
  scenarioName: string;
  externalKey: string;
  externalUrl: string;
  status: 'open' | 'closed' | 'unknown';
  source: 'auto' | 'tag' | 'manual';
  lastRunId?: string;
  lastSyncedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Narrow persistence contract; the CLI uses a JSON file, the server can plug the DB. */
export interface IssueLinkStore {
  findOpen(
    projectSlug: string,
    provider: ProviderName,
    fingerprint: string,
  ): Promise<IssueLink | undefined>;
  findByKey(
    projectSlug: string,
    provider: ProviderName,
    externalKey: string,
  ): Promise<IssueLink | undefined>;
  save(
    link: Omit<IssueLink, 'id' | 'createdAt' | 'updatedAt'> &
      Partial<Pick<IssueLink, 'id' | 'createdAt'>>,
  ): Promise<IssueLink>;
  list(projectSlug: string, provider?: ProviderName): Promise<IssueLink[]>;
}

export interface StepSummary {
  index: number;
  keyword?: string;
  text: string;
  status: SuiteStatus;
  errorMessage?: string;
  durationMs?: number;
}

export interface ScreenshotRef {
  /** path relative to the run directory */
  relPath: string;
  absPath?: string;
  phase?: string;
  stepIndex?: number | null;
  name?: string;
}

export interface ScenarioSummary {
  fingerprint: string;
  featureUri: string;
  featureName: string;
  scenarioName: string;
  line?: number;
  exampleIndex?: number | null;
  runnerProject: string;
  layer: string;
  browser?: string;
  suiteTag?: string;
  tags: string[];
  status: SuiteStatus;
  flaky: boolean;
  attemptsCount: number;
  durationMs?: number;
  errorMessage?: string;
  errorStack?: string;
  steps: StepSummary[];
  screenshots: ScreenshotRef[];
  jiraKeys: string[];
  githubIssues: string[];
  /** runner trace (`trace.zip`), relative to the run directory */
  tracePath?: string;
  /** runner video (`video.webm`), relative to the run directory */
  videoPath?: string;
}

export interface RunSummaryInput {
  run: RunRecord;
  totals: RunTotals;
  scenarios: ScenarioSummary[];
  failed: ScenarioSummary[];
  flaky: ScenarioSummary[];
  passed: ScenarioSummary[];
  runDir?: string;
  reportUrl?: string;
}

export interface CiInfo {
  provider?: 'github' | 'gitlab' | 'other';
  isPullRequest: boolean;
  prNumber?: number;
  sha?: string;
  branch?: string;
  runUrl?: string;
  artifactUrl?: string;
  eventName?: string;
  repository?: string;
}

export interface IntegrationLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

export interface IntegrationContext {
  store: IssueLinkStore;
  logger: IntegrationLogger;
  publicUrl?: string;
  ci: CiInfo;
  dryRun?: boolean;
  /** Resolve a screenshot to a URL viewers can open (public server first, then CI artifact page). */
  artifactUrl(artifact: ScreenshotRef, run: RunRecord): string | null;
  /** Resolve a screenshot to a local file for upload. */
  artifactPath(artifact: ScreenshotRef, run: RunRecord): string | null;
}

export interface CreateIssueInput {
  projectSlug: string;
  run: RunRecord;
  scenario: ScenarioSummary;
  screenshots: ScreenshotRef[];
  diffUrl?: string;
  reportUrl?: string;
  /** files already committed to the evidence branch for this run (`integrations.github.evidence`) */
  evidence?: PublishedEvidence;
}

/** One local file offered to an evidence host. */
export interface EvidenceFile {
  /** lookup key for the issue body: `evidenceKey(fingerprint, relPath)` */
  key: string;
  fingerprint: string;
  /** directory under `runs/<runId>/` */
  scenarioDir: string;
  name: string;
  localPath: string;
  kind: 'screenshot' | 'preview' | 'video';
  bytes: number;
}

export interface SkippedEvidence {
  key: string;
  fingerprint: string;
  name: string;
  bytes: number;
  reason: string;
}

export interface PublishedEvidence {
  /** evidence key → link that renders inline for readers of the evidence repository */
  urls: Map<string, string>;
  skipped: SkippedEvidence[];
  commitSha?: string;
}

export interface NotifyAction {
  provider: ProviderName;
  kind:
    | 'check-run'
    | 'pr-comment'
    | 'issue-created'
    | 'issue-commented'
    | 'issue-closed'
    | 'transition'
    | 'skipped';
  target?: string;
  url?: string;
  detail?: string;
  fingerprint?: string;
}

export interface NotifyResult {
  provider: ProviderName;
  actions: NotifyAction[];
}

export interface ProviderTestResult {
  ok: boolean;
  detail: string;
  /** configured labels the target is missing, and the ones this call created */
  labels?: { missing: string[]; created: string[] };
  /** the evidence host, when `integrations.github.evidence.host` is `branch` */
  evidence?: { ok: boolean; detail: string };
}

export interface ProviderTestOptions {
  /** create configured labels the target is missing (GitHub) */
  createMissingLabels?: boolean;
}

export interface IntegrationSecrets {
  token?: string;
  email?: string;
  /** token for `integrations.github.evidence.tokenEnv`, when set */
  evidenceToken?: string;
}

export interface IntegrationProvider<C = unknown> {
  readonly name: ProviderName;
  init(config: C, secrets: IntegrationSecrets): Promise<void>;
  test(opts?: ProviderTestOptions): Promise<ProviderTestResult>;
  onRunFinished(summary: RunSummaryInput, ctx: IntegrationContext): Promise<NotifyResult>;
  createIssue(input: CreateIssueInput, ctx: IntegrationContext): Promise<IssueRef>;
  linkIssue(fingerprint: string, key: string): Promise<IssueRef>;
  syncStatuses(links: IssueLink[]): Promise<IssueRef[]>;
  onScenarioPassed?(
    link: IssueLink,
    run: RunRecord,
    ctx: IntegrationContext,
  ): Promise<NotifyAction | null>;
}

export type GitHubConfig = GitHubIntegrationConfig;
export type JiraConfig = JiraIntegrationConfig;

export interface CustomProviderModule {
  default?: new (options?: Record<string, unknown>) => IntegrationProvider;
  createProvider?: (options?: Record<string, unknown>) => IntegrationProvider;
}
