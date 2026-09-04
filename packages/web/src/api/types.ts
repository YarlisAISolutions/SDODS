/**
 * REST DTOs mirroring the server route table (plan §10). Kept local so the UI builds before
 * `@sdods/server/schemas` exists; keep in sync with the server's zod schemas.
 */
import type {
  BrowserName,
  Layer,
  ModuleConfig,
  ProcessConfig,
  Role,
  OrgRole,
  WorkspaceRole,
  Scope,
  RunStatus,
  RunTotals,
  SuiteStatus,
  ApiSnapshot,
  HealEvent,
  TestingType,
} from '@sdods/contracts';

export type {
  BrowserName,
  Layer,
  ModuleConfig,
  ProcessConfig,
  Role,
  OrgRole,
  WorkspaceRole,
  Scope,
  RunStatus,
  RunTotals,
  SuiteStatus,
  ApiSnapshot,
  HealEvent,
  TestingType,
};

export interface Me {
  user: { id: string; username: string; email?: string; role: Role; active: boolean };
  csrfToken: string;
  scopes: Scope[];
  orgRoles: Record<string, OrgRole>;
  workspaceRoles: Record<string, WorkspaceRole>;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  description?: string;
  url?: string;
  myRole?: OrgRole | null;
}

export interface Workspace {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description?: string;
  projectCount: number;
  myRole: WorkspaceRole | null;
}

export interface Member {
  userId: string;
  username: string;
  role: OrgRole | WorkspaceRole;
}

export interface Project {
  slug: string;
  name: string;
  description?: string;
  workspace: string;
  organization: string;
  layers: Layer[];
  browsers: BrowserName[];
  testIdAttribute: string;
  envs: { default: string; available: string[] };
  tags: { suites: string[]; extra: string[]; roles: string[] };
  routes: Record<string, string>;
  modules: ModuleConfig[];
  processes: ProcessConfig[];
  screenshots: {
    policy: Record<string, string>;
    fullPage: boolean;
    mask: string[];
    viewport: { width: number; height: number };
    onlyOnFailure: boolean;
  };
  integrations: { github?: Record<string, unknown>; jira?: Record<string, unknown> };
  mcp: { servers: Record<string, Record<string, unknown>> };
  root?: string;
}

export interface Environment {
  name: string;
  description?: string;
  ui: { baseUrl: string };
  api: { baseUrl: string; headers?: Record<string, string>; auth?: { type: string } };
  users?: { poolSize?: number };
  vars?: Record<string, string | number | boolean>;
  secretNames: string[];
  secretsPresent: Record<string, boolean>;
  isDefault: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  envKey: string;
  kind: 'csv' | 'json' | 'yaml' | 'table' | 'faker' | 'openapi';
  storage: 'file' | 'db';
  sourcePath?: string;
  columns: string[];
  rowCount: number;
  updatedAt?: string;
}

export interface PoolUser {
  id: string;
  username: string;
  role: string;
  secretRef: string;
  enabled: boolean;
  leased: boolean;
  leaseOwner?: string;
}

export interface ProcessView extends ProcessConfig {
  lastStatus?: RunStatus | null;
  lastRunId?: string | null;
  lastRunAt?: string | null;
  source: 'project' | 'workspace';
}

export interface RunListItem {
  id: string;
  projectSlug: string;
  env: string;
  trigger: 'cli' | 'ui' | 'ci' | 'agent' | 'mcp' | 'schedule';
  status: RunStatus;
  suiteTag?: string;
  tagsExpr?: string;
  process?: string;
  layers: Layer[];
  browsers: BrowserName[];
  gitBranch?: string;
  gitSha?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  totals?: RunTotals;
  startedBy?: string;
}

export interface ScenarioNode {
  id: string;
  fingerprint: string;
  module?: string | null;
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
  healed: number;
  visual: boolean;
  durationMs?: number;
  errorMessage?: string;
}

export interface RunDetail extends RunListItem {
  command?: string;
  artifactsDir?: string;
  exitCode?: number;
  errorText?: string;
  ciUrl?: string;
  reportPaths: { html?: string; junit?: string; messages?: string; dashboard?: string };
  scenarios: ScenarioNode[];
}

export interface ArtifactRef {
  id: string;
  url: string;
  kind: string;
  phase?: string | null;
  stepIndex?: number | null;
  fileName: string;
  width?: number | null;
  height?: number | null;
  mediaType: string;
}

export interface StepView {
  id: string;
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
  before?: ArtifactRef;
  after?: ArtifactRef;
  visual?: { expected?: ArtifactRef; actual?: ArtifactRef; diff?: ArtifactRef; name: string };
  heals: HealEvent[];
}

export interface AttemptView {
  id: string;
  attempt: number;
  status: SuiteStatus;
  durationMs?: number;
  errorMessage?: string;
  steps: StepView[];
  scenarioStart?: ArtifactRef;
  scenarioEnd?: ArtifactRef;
  failure?: ArtifactRef;
  trace?: ArtifactRef;
  video?: ArtifactRef;
}

export interface ScenarioDetail extends ScenarioNode {
  attempts: AttemptView[];
  issueLinks: Array<{ provider: 'github' | 'jira'; key: string; url: string; status: string }>;
}

export interface CompareResult {
  before: { url: string; w: number; h: number };
  after: { url: string; w: number; h: number };
  diff: { url: string; w: number; h: number };
  mismatchRatio: number;
  mismatchPixels: number;
}

export interface FeatureFile {
  path: string;
  module?: string | null;
  name?: string;
  tags: string[];
  scenarios: number;
}

export interface StepDef {
  keyword: 'Given' | 'When' | 'Then' | 'Unknown';
  pattern: string;
  file?: string;
  line?: number;
  source?: 'core' | 'project';
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  line?: number;
  column?: number;
  fix?: { description: string; insertTag?: string };
}

export interface AgentJob {
  id: string;
  projectSlug: string;
  kind: 'plan' | 'generate' | 'heal' | 'upgrade' | 'review' | 'convert-recording';
  goal?: string;
  status:
    'queued' | 'running' | 'awaiting_review' | 'accepted' | 'rejected' | 'failed' | 'cancelled';
  provider?: string;
  model?: string;
  costUsd?: number;
  turns?: number;
  proposalId?: string;
  diffText?: string;
  summary?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Proposal {
  id: string;
  role: string;
  project: string;
  status: 'pending' | 'accepted' | 'rejected';
  summary: string;
  files: Array<{ path: string; op: 'add' | 'modify' | 'delete' }>;
  diffText?: string;
  costUsd?: number;
  createdAt: string;
}

export interface IntegrationView {
  provider: 'github' | 'jira' | `mcp:${string}`;
  enabled: boolean;
  config: Record<string, unknown>;
  secretEnv: Record<string, string>;
  secretsPresent: Record<string, boolean>;
  lastSyncAt?: string | null;
}

export interface Schedule {
  id: string;
  projectSlug: string;
  name: string;
  cron: string;
  timezone: string;
  env?: string;
  tags?: string;
  layers?: Layer[];
  browsers?: BrowserName[];
  workers?: number;
  harMode?: 'off' | 'update' | 'replay';
  overlap: 'skip' | 'queue' | 'cancel-previous';
  jitterSeconds: number;
  catchUp: boolean;
  enabled: boolean;
  notify: Array<'github' | 'jira' | 'webhook'>;
  nextRunAt?: string | null;
  lastRunId?: string | null;
  lastStatus?: RunStatus | null;
  source: 'db' | 'yaml';
}

export interface ScheduleRun {
  id: string;
  runId?: string;
  firedAt: string;
  status: string;
  note?: string;
}

export interface UserRow {
  id: string;
  username: string;
  email?: string;
  role: Role;
  active: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  owner?: string;
}

export interface McpInfo {
  url: string;
  transport: 'streamable-http';
  version: string;
  tools: Array<{ name: string; scope: string; description: string }>;
}

export interface Trends {
  runs: Array<{
    runId: string;
    startedAt: string;
    passRate: number;
    durationMs: number;
    flakyRate: number;
    process?: string;
    env: string;
  }>;
  flaky: Array<{
    fingerprint: string;
    scenarioName: string;
    featureUri: string;
    runnerProject: string;
    flakyRate: number;
    runsCount: number;
    quarantined: boolean;
  }>;
  locators: Array<{
    selector: string;
    pageHint?: string;
    failCount: number;
    healCount: number;
    lastStrategy?: string;
    suggestedSelector?: string;
  }>;
  health: Array<{
    process: string;
    score: number;
    passRate: number;
    flaky: number;
    fragility: number;
  }>;
}

export interface RunEvent {
  event: 'log' | 'status' | 'progress' | 'ingested' | 'done';
  data: unknown;
}

export interface StartRunInput {
  project: string;
  env: string;
  tags?: string;
  layers?: Layer[];
  browsers?: BrowserName[];
  process?: string;
  modules?: string[];
  headed?: boolean;
  workers?: number;
  feature?: string;
  scenario?: string;
  harMode?: 'off' | 'update' | 'replay';
}
