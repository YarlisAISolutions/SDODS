import { z } from 'zod';

export const LayerSchema = z.enum(['ui', 'api', 'hybrid', 'recorded']);
export const BrowserSchema = z.enum([
  'chromium',
  // Real Microsoft Edge, launched through Playwright's `msedge` channel. It is a distinct browser
  // name rather than a `channel:` on chromium so that Chromium and Edge can run in one matrix and
  // keep separate run targets, visual baselines, result rows and `@skip:` values.
  'edge',
  'firefox',
  'webkit',
  'mobile-chrome',
  'mobile-safari',
]);
export const ShotPolicySchema = z.enum(['off', 'on-failure', 'scenario', 'step', 'visual']);
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase letters, digits and dashes');

export const DataSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('csv'), path: z.string(), fallback: z.string().optional() }),
  z.object({ type: z.literal('json'), path: z.string(), fallback: z.string().optional() }),
  z.object({ type: z.literal('yaml'), path: z.string(), fallback: z.string().optional() }),
  z.object({ type: z.literal('db'), table: z.string(), envColumn: z.string().default('env') }),
  z.object({ type: z.literal('openapi'), spec: z.string(), schema: z.string() }),
]);
export type DataSource = z.infer<typeof DataSourceSchema>;

export const UserPoolSchema = z.object({
  dataset: z.string(),
  roleColumn: z.string().default('role'),
  leaseStore: z.enum(['file', 'db']).default('file'),
  leaseTtlMs: z
    .number()
    .int()
    .positive()
    .default(10 * 60_000),
  /**
   * How a role's accounts are handed to concurrent workers.
   *
   * `exclusive` (default) — one worker holds an account at a time. Correct when
   * scenarios mutate user-scoped state, because two workers sharing an identity
   * would see each other's writes.
   *
   * `shared` — workers may use the same account concurrently. Correct for a
   * read-only suite, and the difference is not marginal: with one account per
   * role, `exclusive` serialises every scenario of that role behind a single
   * lease, so a suite with four workers and a dozen `@user:viewer` scenarios
   * spends its time waiting and then fails them on the lease timeout. That is
   * not a capacity problem the suite can fix by retrying — it is the pool model
   * being wrong for the work.
   *
   * Choose per role where they differ: a mutating scenario should carry an
   * explicit exclusive lease even in a shared pool.
   */
  mode: z.enum(['exclusive', 'shared']).default('exclusive'),
  /** How long to wait for a free account before failing. Was hard-coded at 30s. */
  waitMs: z.number().int().positive().default(30_000),
});

export const AuthStrategySchema = z.enum([
  'none',
  'form',
  'token',
  'oauth-client-credentials',
  'sso',
  'custom',
]);

export const AuthFormSchema = z.object({
  loginPath: z.string().default('/'),
  usernameSelector: z.string(),
  passwordSelector: z.string(),
  submitSelector: z.string(),
  readySelector: z.string().optional(),
  readyUrl: z.string().optional(),
});

export const ProjectAuthSchema = z.object({
  strategy: AuthStrategySchema.default('none'),
  storageState: z.boolean().default(true),
  maxAgeMinutes: z.number().int().positive().default(60),
  /**
   * Whether `I use a leased user with role {string} for API calls` attaches the user's token.
   * `implicit`: it does. `explicit`: it only leases, and the scenario attaches the token with
   * `I authenticate the API with the leased user's token`. Unset: explicit for `custom` strategies
   * (whose token may be a different credential class than the session), implicit otherwise.
   */
  apiToken: z.enum(['implicit', 'explicit']).optional(),
  form: AuthFormSchema.optional(),
  tokenPlacement: z
    .object({
      kind: z.enum(['localStorage', 'cookie', 'header']).default('header'),
      name: z.string().default('Authorization'),
      prefix: z.string().default('Bearer '),
    })
    .optional(),
});

export const ScreenshotConfigSchema = z.object({
  policy: z.record(z.string(), ShotPolicySchema).default({ default: 'on-failure' }),
  fullPage: z.boolean().default(false),
  mask: z.array(z.string()).default([]),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1280, height: 720 }),
  onlyOnFailure: z.boolean().default(false),
});

export const HealConfigSchema = z.object({
  enabled: z.boolean().default(true),
  primaryTimeoutMs: z.number().int().positive().default(3000),
  probeTimeoutMs: z.number().int().positive().default(1500),
  minScore: z.number().min(0).max(1).default(0.6),
  actions: z
    .array(z.enum(['click', 'fill', 'select', 'assert', 'hover', 'check']))
    .default(['click', 'fill', 'select', 'assert', 'hover', 'check']),
});

export const TimeoutsSchema = z.object({
  test: z.number().int().positive().default(60_000),
  expect: z.number().int().positive().default(10_000),
  action: z.number().int().positive().default(15_000),
  navigation: z.number().int().positive().default(30_000),
  api: z.number().int().positive().default(15_000),
});

/**
 * Playwright's own artifacts per test: its trace, video and screenshot fixtures.
 *
 * Separate from `screenshots:` (SDODS's policy-driven scenario and step shots). Turning
 * `screenshot` on here attaches Playwright's end-of-test screenshot as well, so most projects
 * leave it `off` and set `trace`/`video` instead. The modes are Playwright's, verbatim.
 */
export const ScreenshotModeSchema = z.enum(['off', 'on', 'only-on-failure', 'on-first-failure']);
export const RecordingModeSchema = z.enum([
  'off',
  'on',
  'retain-on-failure',
  'on-first-retry',
  'on-all-retries',
  'retain-on-first-failure',
  'retain-on-failure-and-retries',
]);
export const EvidenceSchema = z.object({
  screenshot: ScreenshotModeSchema.default('off'),
  video: RecordingModeSchema.default('retain-on-failure'),
  trace: RecordingModeSchema.default('on-first-retry'),
});
/**
 * The env-level patch. Not `EvidenceSchema.partial()`: zod still applies the inner defaults to
 * absent keys, so `evidence: { trace: on }` in an env file would reset the project's `video`.
 */
export const EvidencePatchSchema = z.object({
  screenshot: ScreenshotModeSchema.optional(),
  video: RecordingModeSchema.optional(),
  trace: RecordingModeSchema.optional(),
});
export const EVIDENCE_DEFAULTS = {
  screenshot: 'off',
  video: 'retain-on-failure',
  trace: 'on-first-retry',
} as const;

/**
 * Scenarios that must pass before anything else in the run starts: probes, login, seeding.
 *
 * Each run target gets a `<target>--setup` companion that runs the scenarios matching `tags`
 * (a Cucumber tag expression, applied regardless of `--tags`); the target depends on it, so when
 * a setup scenario fails the target's scenarios are reported as skipped instead of failing one
 * by one against a broken environment.
 */
export const SetupSchema = z.object({ tags: z.string().min(1) });

export const RetriesSchema = z.object({
  ci: z.number().int().min(0).default(2),
  local: z.number().int().min(0).default(0),
  byTag: z.record(z.string(), z.number().int().min(0)).default({}),
});

export const PerfBudgetsSchema = z.object({
  pageLoadMs: z.number().positive().optional(),
  lcpMs: z.number().positive().optional(),
  fcpMs: z.number().positive().optional(),
  ttfbMs: z.number().positive().optional(),
  apiP95Ms: z.number().positive().optional(),
});

export const GitHubIntegrationSchema = z.object({
  enabled: z.boolean().default(false),
  owner: z.string().optional(),
  repo: z.string().optional(),
  checkRun: z.boolean().default(true),
  prComment: z.boolean().default(true),
  createIssueOnFailure: z.enum(['never', 'smoke', 'always']).default('never'),
  closeOnPass: z.boolean().default(false),
  labels: z.array(z.string()).default(['sdods']),
  tokenEnv: z.string().default('GITHUB_TOKEN'),
  uploadToRelease: z.string().optional(),
});

export const JiraIntegrationSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url().optional(),
  projectKey: z.string().optional(),
  issueType: z.string().default('Bug'),
  authMode: z.enum(['basic', 'bearer']).default('basic'),
  emailEnv: z.string().default('JIRA_EMAIL'),
  tokenEnv: z.string().default('JIRA_API_TOKEN'),
  createIssueOnFailure: z.enum(['never', 'smoke', 'always']).default('never'),
  transitionOnPass: z.string().optional(),
  linkTaggedScenarios: z.boolean().default(true),
  labels: z.array(z.string()).default(['sdods']),
  maxAttachmentMb: z.number().positive().default(10),
});

export const IntegrationsSchema = z.object({
  github: GitHubIntegrationSchema.optional(),
  jira: JiraIntegrationSchema.optional(),
  custom: z
    .array(z.object({ module: z.string(), options: z.record(z.string(), z.unknown()).optional() }))
    .default([]),
});

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
export const McpServerSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).default([]),
    envFrom: z
      .record(z.string(), z.string().regex(ENV_NAME, 'must be an env var NAME'))
      .default({}),
    allowedTools: z.array(z.string()).optional(),
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().positive().default(60_000),
  }),
  z.object({
    transport: z.literal('http'),
    url: z.string().url(),
    headersFrom: z
      .record(z.string(), z.string().regex(ENV_NAME, 'must be an env var NAME'))
      .default({}),
    allowedTools: z.array(z.string()).optional(),
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().positive().default(60_000),
  }),
]);

export const McpConfigSchema = z.object({
  servers: z.record(z.string(), McpServerSchema).default({}),
});

/** Settings for a model server you run yourself: Ollama, vLLM, LM Studio, llama.cpp. */
export const LocalLlmConfigSchema = z
  .object({
    /** Ollama's native endpoint, or the OpenAI-compatible base URL of another server. */
    baseUrl: z.string().url().optional(),
    /**
     * `options.num_ctx`. Ollama loads a model at 4096 tokens whatever its weights allow, and
     * truncates a longer prompt without saying so, so this is the setting that decides whether
     * an agent job sees its whole prompt.
     */
    contextTokens: z.number().int().min(2048).max(1_048_576).optional(),
    temperature: z.number().min(0).max(2).optional(),
    /** Local generation is minutes, not seconds. */
    requestTimeoutMs: z.number().int().positive().default(300_000),
    /** How long the server keeps the model in memory between turns. */
    keepAlive: z.string().default('10m'),
  })
  .default({ requestTimeoutMs: 300_000, keepAlive: '10m' });

export const AgentsConfigSchema = z.object({
  /**
   * claude/openai-compatible use API keys; claude-code/codex shell out to the logged-in CLI;
   * ollama runs a model on this machine, with no key and no per-token cost.
   */
  provider: z
    .enum(['claude', 'claude-code', 'codex', 'openai-compatible', 'ollama', 'fake'])
    .optional(),
  /**
   * How much of the platform a model is shown. `auto` picks `small` for a local or small model:
   * a handful of tools, one call per turn, and the project's real step patterns in the prompt.
   */
  profile: z.enum(['auto', 'full', 'small']).default('auto'),
  models: z.record(z.string(), z.string()).default({}),
  maxTurns: z.record(z.string(), z.number().int().positive()).default({}),
  budgetUsd: z.record(z.string(), z.number().positive()).default({ default: 2 }),
  maxRunsPerJob: z.number().int().positive().default(3),
  sourceRoots: z.array(z.string()).default([]),
  local: LocalLlmConfigSchema,
});

export const ScheduleSchema = z.object({
  name: z.string(),
  cron: z.string(),
  timezone: z.string().default('UTC'),
  env: z.string().optional(),
  tags: z.string().optional(),
  layers: z.array(LayerSchema).optional(),
  browsers: z.array(BrowserSchema).optional(),
  workers: z.number().int().positive().optional(),
  harMode: z.enum(['off', 'update', 'replay']).optional(),
  overlap: z.enum(['skip', 'queue', 'cancel-previous']).default('skip'),
  jitterSeconds: z.number().int().min(0).default(0),
  catchUp: z.boolean().default(false),
  enabled: z.boolean().default(true),
  notify: z.array(z.enum(['github', 'jira', 'webhook'])).default([]),
  retentionRuns: z.number().int().positive().optional(),
});

/**
 * Hierarchy: organization → workspace → project → module.
 * A module is a feature area of an application (auth, inventory, checkout …) that owns a
 * features directory, default tags and an owner. A process is a named, repeatable run recipe
 * (pr-check, nightly-regression, release-gate …) that pins tags/layers/browsers/env and a trigger.
 */
export const OrganizationSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().url().optional(),
});

export const WorkspaceSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  organization: SlugSchema.optional(),
});

export const TestingTypeSchema = z.enum([
  'functional',
  'smoke',
  'regression',
  'sanity',
  'integration',
  'contract',
  'visual',
  'accessibility',
  'performance',
  'security',
  'data-driven',
  'exploratory',
]);

export const ModuleSchema = z.object({
  name: SlugSchema,
  title: z.string().optional(),
  description: z.string().optional(),
  /** directory under features/ (default: the module name) */
  path: z.string().optional(),
  layers: z.array(LayerSchema).optional(),
  testingTypes: z.array(TestingTypeSchema).default(['functional']),
  /** tags every scenario in this module is expected to carry (lint warns when missing) */
  tags: z.array(z.string()).default([]),
  owner: z.string().optional(),
  jiraComponent: z.string().optional(),
  routes: z.array(z.string()).default([]),
  endpoints: z.array(z.string()).default([]),
});

export const ProcessTriggerSchema = z.enum([
  'manual',
  'pr',
  'merge',
  'nightly',
  'release',
  'schedule',
  'webhook',
]);

export const ProcessSchema = z.object({
  name: SlugSchema,
  title: z.string().optional(),
  description: z.string().optional(),
  trigger: ProcessTriggerSchema.default('manual'),
  env: z.string().optional(),
  tags: z.string().optional(),
  layers: z.array(LayerSchema).optional(),
  browsers: z.array(BrowserSchema).optional(),
  modules: z.array(SlugSchema).optional(),
  workers: z.number().int().positive().optional(),
  retries: z.number().int().min(0).optional(),
  harMode: z.enum(['off', 'update', 'replay']).optional(),
  /** Overrides the project's `fullyParallel` for this process. */
  fullyParallel: z.boolean().optional(),
  /** Overrides the project's `setup` for this process; `false` runs without a setup tier. */
  setup: z.union([SetupSchema, z.literal(false)]).optional(),
  failOnFlaky: z.boolean().default(false),
  gates: z
    .object({
      minPassRate: z.number().min(0).max(100).optional(),
      maxFlaky: z.number().int().min(0).optional(),
      perfBudgets: z.boolean().default(false),
      a11y: z.boolean().default(false),
    })
    .default({ perfBudgets: false, a11y: false }),
  notify: z.array(z.enum(['github', 'jira', 'webhook'])).default([]),
  schedule: z.string().optional(),
});

export const ProjectConfigSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  organization: SlugSchema.optional(),
  workspace: SlugSchema.optional(),
  modules: z.array(ModuleSchema).default([]),
  processes: z.array(ProcessSchema).default([]),
  layers: z.array(LayerSchema).min(1),
  browsers: z.array(BrowserSchema).min(1).default(['chromium']),
  channel: z.enum(['chrome', 'msedge', 'chrome-beta', 'msedge-beta']).optional(),
  testIdAttribute: z.string().default('data-testid'),
  /**
   * Which of the built-in step libraries NOT to load.
   *
   * The core libraries share one step namespace with the project's own steps, and
   * playwright-bdd fails generation outright when two definitions match the same
   * text — it cannot know which one the author meant. So every library added to
   * core is a potential break for a project that already wrote that phrasing, and
   * before this existed the only remedy was to rewrite every colliding step in one
   * commit, unverified, before the suite could run again.
   *
   * This is the migration path: exclude the libraries you have already covered,
   * upgrade, then delete your own steps one library at a time with a green run
   * between each. Names are the file basenames — `a11y` for `a11y.steps.ts`.
   */
  steps: z
    .object({
      core: z.object({ exclude: z.array(z.string()).default([]) }).default({ exclude: [] }),
    })
    .default({ core: { exclude: [] } }),
  routes: z.record(z.string(), z.string()).default({}),
  tags: z
    .object({
      suites: z.array(z.string()).min(1).default(['smoke', 'regression', 'sanity']),
      extra: z.array(z.string()).default([]),
      roles: z.array(z.string()).default([]),
    })
    .default({ suites: ['smoke', 'regression', 'sanity'], extra: [], roles: [] }),
  envs: z.object({ default: z.string(), available: z.array(z.string()).min(1) }),
  data: z
    .object({
      sources: z.record(z.string(), DataSourceSchema).default({}),
      factories: z.string().optional(),
      userPool: UserPoolSchema.optional(),
    })
    .default({ sources: {} }),
  auth: ProjectAuthSchema.default({ strategy: 'none', storageState: true, maxAgeMinutes: 60 }),
  screenshots: ScreenshotConfigSchema.default({
    policy: { default: 'on-failure' },
    fullPage: false,
    mask: [],
    viewport: { width: 1280, height: 720 },
    onlyOnFailure: false,
  }),
  heal: HealConfigSchema.default({
    enabled: true,
    primaryTimeoutMs: 3000,
    probeTimeoutMs: 1500,
    minScore: 0.6,
    actions: ['click', 'fill', 'select', 'assert', 'hover', 'check'],
  }),
  timeouts: TimeoutsSchema.default({
    test: 60_000,
    expect: 10_000,
    action: 15_000,
    navigation: 30_000,
    api: 15_000,
  }),
  retries: RetriesSchema.default({ ci: 2, local: 0, byTag: {} }),
  evidence: EvidenceSchema.default(EVIDENCE_DEFAULTS),
  /**
   * Run the tests inside each feature file in parallel (Playwright `fullyParallel`). `false` keeps
   * scenarios of one file in order on one worker; files still spread across workers.
   */
  fullyParallel: z.boolean().default(true),
  setup: SetupSchema.optional(),
  perf: z.object({ budgets: PerfBudgetsSchema.default({}) }).default({ budgets: {} }),
  integrations: IntegrationsSchema.default({ custom: [] }),
  mcp: McpConfigSchema.default({ servers: {} }),
  agents: AgentsConfigSchema.default({
    models: {},
    maxTurns: {},
    profile: 'auto',
    budgetUsd: { default: 2 },
    maxRunsPerJob: 3,
    sourceRoots: [],
    local: { requestTimeoutMs: 300_000, keepAlive: '10m' },
  }),
  schedules: z.array(ScheduleSchema).default([]),
  reports: z
    .object({
      cucumberHtml: z.boolean().default(false),
      allure: z.boolean().default(false),
      junit: z.boolean().default(false),
    })
    .default({ cucumberHtml: false, allure: false, junit: false }),
  /** How the CI matrix (`sdods project list --matrix`) treats this project. */
  ci: z
    .object({
      /** false = excluded from the generic browser matrix (e.g. a project that needs its own server) */
      enabled: z.boolean().default(true),
      /** environment the matrix runs against (default: envs.default) */
      env: z.string().optional(),
      /** tag expression for the matrix run (default: the workflow's choice) */
      tags: z.string().optional(),
      /** browsers to include in the matrix (default: project browsers) */
      browsers: z.array(BrowserSchema).optional(),
    })
    .default({ enabled: true }),
});

/** Root `sdods.workspace.yaml`: names the organization and workspace every project in the repo belongs to. */
export const WorkspaceFileSchema = z.object({
  organization: OrganizationSchema,
  /** one organization can hold many workspaces; projects pick one via `workspace:` */
  workspaces: z.array(WorkspaceSchema).min(1),
  /** workspace used by projects that do not set `workspace:` */
  defaultWorkspace: SlugSchema,
  defaults: z
    .object({
      browsers: z.array(BrowserSchema).optional(),
      suites: z.array(z.string()).optional(),
      testIdAttribute: z.string().optional(),
      processes: z.array(ProcessSchema).default([]),
    })
    .default({ processes: [] }),
});

export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type ModuleConfig = z.infer<typeof ModuleSchema>;
export type ProcessConfig = z.infer<typeof ProcessSchema>;
export type TestingType = z.infer<typeof TestingTypeSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ProjectConfigInput = z.input<typeof ProjectConfigSchema>;
export type ScreenshotConfig = z.infer<typeof ScreenshotConfigSchema>;
export type EvidenceConfig = z.infer<typeof EvidenceSchema>;
export type SetupConfig = z.infer<typeof SetupSchema>;
export type HealConfig = z.infer<typeof HealConfigSchema>;
export type TimeoutsConfig = z.infer<typeof TimeoutsSchema>;
export type ProjectAuthConfig = z.infer<typeof ProjectAuthSchema>;
export type McpServerConfig = z.infer<typeof McpServerSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleSchema>;
export type GitHubIntegrationConfig = z.infer<typeof GitHubIntegrationSchema>;
export type JiraIntegrationConfig = z.infer<typeof JiraIntegrationSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type BrowserName = z.infer<typeof BrowserSchema>;
export type ShotPolicy = z.infer<typeof ShotPolicySchema>;
