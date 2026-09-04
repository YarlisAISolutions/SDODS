/**
 * Kysely `Database` interface. One schema serves both dialects:
 *  - ids: app-generated UUIDv7 text
 *  - timestamps: ISO-8601 text on sqlite, timestamptz on Postgres (read back as ISO strings)
 *  - json: text on sqlite (parsed by ParseJSONResultsPlugin), jsonb on Postgres
 *  - booleans: integer 0/1 on sqlite, boolean on Postgres (normalise with readBool)
 */
import type { ColumnType } from 'kysely';

/** JSON column: reads come back parsed, writes are JSON strings (enc.json / jsonVal). */
export type Json<T = unknown> = ColumnType<T, string | ReturnType<typeof String>, string>;
export type Bool = ColumnType<boolean | number, boolean | number, boolean | number>;
export type Ts = ColumnType<string, string, string>;

export interface OrganizationsTable {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  url: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface WorkspacesTable {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface OrgMembersTable {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  created_at: Ts;
}

export interface WorkspaceMembersTable {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: Ts;
}

export interface ModulesTable {
  id: string;
  project_id: string;
  name: string;
  title: string | null;
  description: string | null;
  path: string | null;
  layers_json: Json<string[]>;
  testing_types_json: Json<string[]>;
  tags_json: Json<string[]>;
  owner: string | null;
  jira_component: string | null;
  routes_json: Json<string[]>;
  endpoints_json: Json<string[]>;
  created_at: Ts;
  updated_at: Ts;
}

export interface ProcessesTable {
  id: string;
  project_id: string | null;
  workspace_id: string | null;
  name: string;
  title: string | null;
  description: string | null;
  trigger: string;
  config_json: Json<Record<string, unknown>>;
  enabled: Bool;
  last_run_id: string | null;
  last_status: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface ProjectsTable {
  id: string;
  workspace_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  root_path: string | null;
  config_json: Json<Record<string, unknown>>;
  config_hash: string | null;
  layers_json: Json<string[]>;
  browsers_json: Json<string[]>;
  tags_policy_json: Json<Record<string, unknown>>;
  screenshot_policy_json: Json<Record<string, unknown>>;
  archived: Bool;
  created_at: Ts;
  updated_at: Ts;
}

export interface EnvironmentsTable {
  id: string;
  project_id: string;
  name: string;
  base_url: string | null;
  api_base_url: string | null;
  config_json: Json<Record<string, unknown>>;
  secret_keys_json: Json<string[]>;
  is_default: Bool;
  created_at: Ts;
  updated_at: Ts;
}

export interface RunsTable {
  id: string;
  project_id: string;
  workspace_id: string | null;
  environment_id: string | null;
  env_name: string;
  process: string | null;
  trigger: string;
  status: string;
  suite_tag: string | null;
  tags_expr: string | null;
  layers_json: Json<string[]>;
  browsers_json: Json<string[]>;
  shard_total: number | null;
  shards_ingested: number;
  git_sha: string | null;
  git_branch: string | null;
  ci_provider: string | null;
  ci_run_id: string | null;
  ci_url: string | null;
  started_by: string | null;
  command: string | null;
  started_at: Ts | null;
  finished_at: Ts | null;
  duration_ms: number | null;
  totals_json: Json<Record<string, unknown>>;
  artifacts_dir: string | null;
  pw_report_rel: string | null;
  exit_code: number | null;
  error_text: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface ScenariosTable {
  id: string;
  run_id: string;
  project_id: string;
  natural_key: string;
  fingerprint: string;
  source: string;
  feature_uri: string;
  feature_name: string | null;
  scenario_name: string;
  module: string | null;
  examples_row: number | null;
  pw_project: string;
  layer: string;
  browser: string | null;
  suite_tag: string | null;
  tags_json: Json<string[]>;
  jira_keys_json: Json<string[]>;
  status: string;
  attempts_count: number;
  flaky: Bool;
  duration_ms: number | null;
  error_message: string | null;
  error_stack: string | null;
  started_at: Ts | null;
  finished_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface ScenarioAttemptsTable {
  id: string;
  scenario_id: string;
  run_id: string;
  attempt: number;
  test_case_started_id: string;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  error_stack: string | null;
  will_be_retried: Bool;
  worker_index: number | null;
  started_at: Ts | null;
  finished_at: Ts | null;
  created_at: Ts;
}

export interface StepsTable {
  id: string;
  attempt_id: string;
  scenario_id: string;
  run_id: string;
  step_index: number;
  kind: string;
  hook_type: string | null;
  keyword: string | null;
  text: string;
  argument_json: Json<unknown> | null;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  error_stack: string | null;
  definition_location: string | null;
  test_step_id: string;
  pickle_step_id: string | null;
  layer_hint: string | null;
  api_snapshot_json: Json<unknown> | null;
  perf_json: Json<unknown> | null;
  started_at: Ts | null;
  finished_at: Ts | null;
  created_at: Ts;
}

export interface ArtifactsTable {
  id: string;
  run_id: string;
  scenario_id: string | null;
  attempt_id: string | null;
  step_id: string | null;
  step_index: number | null;
  kind: string;
  phase: string | null;
  media_type: string;
  file_name: string;
  rel_path: string;
  size_bytes: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  meta_json: Json<Record<string, unknown>> | null;
  created_at: Ts;
}

export interface HealEventsTable {
  id: string;
  project_id: string;
  run_id: string;
  scenario_id: string | null;
  attempt_id: string | null;
  step_id: string | null;
  page_url: string | null;
  original_selector: string;
  context_json: Json<Record<string, unknown>>;
  strategy_used: string | null;
  healed_selector: string | null;
  candidates_json: Json<unknown[]>;
  succeeded: Bool;
  duration_ms: number | null;
  source: string;
  accepted: Bool | null;
  accepted_by: string | null;
  created_at: Ts;
}

export interface LocatorStatsTable {
  id: string;
  project_id: string;
  selector: string;
  page_hint: string | null;
  fail_count: number;
  heal_count: number;
  use_count: number;
  last_failed_at: Ts | null;
  last_healed_at: Ts | null;
  last_strategy: string | null;
  suggested_selector: string | null;
  updated_at: Ts;
}

export interface FlakyStatsTable {
  id: string;
  project_id: string;
  fingerprint: string;
  pw_project: string;
  feature_uri: string | null;
  scenario_name: string | null;
  window_size: number;
  runs_count: number;
  pass_count: number;
  fail_count: number;
  flaky_count: number;
  flaky_rate: number;
  fail_streak: number;
  last_status: string | null;
  last_run_id: string | null;
  last_failed_at: Ts | null;
  quarantined: Bool;
  updated_at: Ts;
}

export interface DatasetsTable {
  id: string;
  project_id: string;
  env_key: string;
  name: string;
  kind: string;
  storage: string;
  source_path: string | null;
  columns_json: Json<string[]>;
  row_count: number;
  content_hash: string | null;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface DatasetRowsTable {
  id: string;
  dataset_id: string;
  row_index: number;
  data_json: Json<Record<string, unknown>>;
  tags_json: Json<string[]>;
  created_at: Ts;
}

export interface UserPoolTable {
  id: string;
  project_id: string;
  environment_id: string | null;
  env_name: string;
  pool_name: string;
  username: string;
  secret_ref: string | null;
  role: string;
  storage_state_rel: string | null;
  attributes_json: Json<Record<string, unknown>>;
  enabled: Bool;
  created_at: Ts;
  updated_at: Ts;
}

export interface UserLeasesTable {
  id: string;
  pool_user_id: string;
  run_id: string | null;
  worker_index: number | null;
  holder: string;
  leased_at: Ts;
  expires_at: Ts;
  released_at: Ts | null;
}

export interface RolesTable {
  id: string;
  name: string;
  permissions_json: Json<string[]>;
  created_at: Ts;
}

export interface UsersTable {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role_id: string;
  active: Bool;
  auth_provider: string;
  external_id: string | null;
  last_login_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  csrf_token: string;
  ip: string | null;
  user_agent: string | null;
  created_at: Ts;
  expires_at: Ts;
  last_seen_at: Ts;
}

export interface ApiTokensTable {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  hash: string;
  scopes_json: Json<string[]>;
  expires_at: Ts | null;
  last_used_at: Ts | null;
  revoked_at: Ts | null;
  created_at: Ts;
}

export interface IntegrationsTable {
  id: string;
  project_id: string;
  provider: string;
  config_json: Json<Record<string, unknown>>;
  secret_env_json: Json<Record<string, string>>;
  enabled: Bool;
  last_sync_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface IssueLinksTable {
  id: string;
  project_id: string;
  integration_id: string | null;
  provider: string;
  fingerprint: string;
  scenario_name: string | null;
  external_key: string;
  external_url: string | null;
  status: string;
  source: string;
  last_run_id: string | null;
  last_synced_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface AgentJobsTable {
  id: string;
  project_id: string;
  kind: string;
  goal: string | null;
  status: string;
  input_json: Json<Record<string, unknown>>;
  output_json: Json<Record<string, unknown>> | null;
  diff_text: string | null;
  log_rel: string | null;
  provider: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  turns: number | null;
  proposal_id: string | null;
  started_by: string | null;
  reviewed_by: string | null;
  started_at: Ts | null;
  finished_at: Ts | null;
  reviewed_at: Ts | null;
  error: string | null;
  created_at: Ts;
}

export interface ProposalsTable {
  id: string;
  project_id: string;
  role: string;
  status: string;
  summary: string | null;
  manifest_json: Json<Record<string, unknown>>;
  cost_usd: number | null;
  model: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  created_at: Ts;
  reviewed_at: Ts | null;
}

export interface SchedulesTable {
  id: string;
  project_id: string;
  environment_id: string | null;
  name: string;
  cron_expr: string;
  timezone: string;
  run_input_json: Json<Record<string, unknown>>;
  overlap_policy: string;
  jitter_seconds: number;
  catch_up: Bool;
  enabled: Bool;
  notify_json: Json<unknown>;
  retention_runs: number | null;
  next_run_at: Ts | null;
  last_run_id: string | null;
  last_status: string | null;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface ScheduleRunsTable {
  id: string;
  schedule_id: string;
  run_id: string | null;
  fired_at: Ts;
  status: string;
  note: string | null;
}

export interface AuditLogTable {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: Json<Record<string, unknown>> | null;
  ip: string | null;
  created_at: Ts;
}

export interface Database {
  organizations: OrganizationsTable;
  workspaces: WorkspacesTable;
  org_members: OrgMembersTable;
  workspace_members: WorkspaceMembersTable;
  projects: ProjectsTable;
  modules: ModulesTable;
  processes: ProcessesTable;
  environments: EnvironmentsTable;
  runs: RunsTable;
  scenarios: ScenariosTable;
  scenario_attempts: ScenarioAttemptsTable;
  steps: StepsTable;
  artifacts: ArtifactsTable;
  heal_events: HealEventsTable;
  locator_stats: LocatorStatsTable;
  flaky_stats: FlakyStatsTable;
  datasets: DatasetsTable;
  dataset_rows: DatasetRowsTable;
  user_pool: UserPoolTable;
  user_leases: UserLeasesTable;
  roles: RolesTable;
  users: UsersTable;
  sessions: SessionsTable;
  api_tokens: ApiTokensTable;
  integrations: IntegrationsTable;
  issue_links: IssueLinksTable;
  agent_jobs: AgentJobsTable;
  proposals: ProposalsTable;
  schedules: SchedulesTable;
  schedule_runs: ScheduleRunsTable;
  audit_log: AuditLogTable;
}

/** Platform tables in foreign-key order (parents first). Used by export/import/switch/prune. */
export const TABLES_IN_FK_ORDER: Array<keyof Database> = [
  'roles',
  'users',
  'sessions',
  'api_tokens',
  'organizations',
  'workspaces',
  'org_members',
  'workspace_members',
  'projects',
  'modules',
  'processes',
  'environments',
  'runs',
  'scenarios',
  'scenario_attempts',
  'steps',
  'artifacts',
  'heal_events',
  'locator_stats',
  'flaky_stats',
  'datasets',
  'dataset_rows',
  'user_pool',
  'user_leases',
  'integrations',
  'issue_links',
  'proposals',
  'agent_jobs',
  'schedules',
  'schedule_runs',
  'audit_log',
];

export const MIGRATION_TABLE = 'automax_migrations';
export const MIGRATION_LOCK_TABLE = 'automax_migrations_lock';
