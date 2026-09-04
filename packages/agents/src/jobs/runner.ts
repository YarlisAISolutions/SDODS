import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '@sdods/contracts';
import {
  ProposalStore,
  buildToolContext,
  createRegistry,
  findRepoRoot,
  readYaml,
  type ToolContext,
  type ToolRegistry,
} from '@sdods/mcp';
import {
  createAdapter,
  type AgentEvent,
  type LlmAdapter,
  type Provider,
} from '../adapter/index.js';
import {
  ROLES,
  roleSystemPrompt,
  roleTools,
  type RoleInput,
  type RoleName,
} from '../roles/index.js';

export type JobStatus =
  'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';

export interface AgentJob {
  id: string;
  role: RoleName;
  project?: string;
  env?: string;
  status: JobStatus;
  provider: Provider;
  model: string;
  input: RoleInput;
  startedAt: string;
  finishedAt?: string;
  costUsd?: number;
  turns?: number;
  toolCalls?: number;
  proposalIds: string[];
  error?: string;
  resultText?: string;
  budgetUsd: number;
  maxTurns: number;
  dryRun?: boolean;
  events?: AgentEvent[];
}

export interface RunJobOptions {
  role: RoleName;
  input: RoleInput;
  rootDir?: string;
  provider?: string;
  model?: string;
  /** Model server endpoint, for a provider you host yourself. */
  baseUrl?: string;
  /** Context window to load a local model with. */
  contextTokens?: number;
  maxTurns?: number;
  budgetUsd?: number;
  dryRun?: boolean;
  adapter?: LlmAdapter;
  registry?: ToolRegistry;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  keepEvents?: boolean;
}

export const JOBS_DIR = '.sdods/agent-jobs';

export class JobJournal {
  readonly dir: string;
  constructor(rootDir: string) {
    this.dir = join(rootDir, JOBS_DIR);
  }
  save(job: AgentJob) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${job.id}.json`), JSON.stringify(job, null, 2));
  }
  get(id: string): AgentJob | undefined {
    const f = join(this.dir, `${id}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as AgentJob) : undefined;
  }
  list(limit = 50): AgentJob[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as AgentJob)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }
}

interface ProjectAgentsYaml {
  agents?: {
    provider?: string;
    models?: Record<string, string>;
    maxTurns?: Record<string, number>;
    budgetUsd?: Record<string, number>;
    maxRunsPerJob?: number;
    /** Settings for a model server the team runs itself (ollama, vLLM, LM Studio …). */
    local?: {
      baseUrl?: string;
      contextTokens?: number;
      temperature?: number;
      requestTimeoutMs?: number;
    };
  };
  mcp?: {
    servers?: Record<
      string,
      {
        transport?: 'stdio' | 'http';
        command?: string;
        args?: string[];
        url?: string;
        enabled?: boolean;
        envFrom?: Record<string, string>;
        headersFrom?: Record<string, string>;
        allowedTools?: string[];
      }
    >;
  };
}

/** Build the prompt/tool set for a role without running (used by --dry-run and tests). */
export function prepareJob(o: RunJobOptions): {
  job: AgentJob;
  ctx: ToolContext;
  registry: ToolRegistry;
  system: string;
  prompt: string;
  tools: ReturnType<typeof roleTools>;
  adapter: LlmAdapter;
  mcpServers: Record<string, any>;
  /** True for the roles whose work is looking at the application. */
  needsBrowser: boolean;
} {
  const rootDir = o.rootDir ?? findRepoRoot();
  const yaml = o.input.project
    ? readYaml<ProjectAgentsYaml>(
        join(
          rootDir,
          process.env.SDODS_PROJECTS_DIR ?? 'projects',
          o.input.project,
          'sdods.project.yaml',
        ),
      )
    : undefined;
  const def = ROLES[o.role];
  const provider = o.dryRun ? 'fake' : o.provider;
  const adapter =
    o.adapter ??
    createAdapter(
      {
        provider,
        model: o.model ?? yaml?.agents?.models?.[o.role] ?? yaml?.agents?.models?.default,
        baseUrl: o.baseUrl ?? yaml?.agents?.local?.baseUrl,
        contextTokens: o.contextTokens ?? yaml?.agents?.local?.contextTokens,
        temperature: yaml?.agents?.local?.temperature,
        timeoutMs: yaml?.agents?.local?.requestTimeoutMs,
        rootDir,
        project: o.input.project,
        env: o.input.env,
        onAutoDetect: (p, reason) =>
          o.onEvent?.({ type: 'status', message: `adapter auto-selected: ${p} (${reason})` }),
      },
      yaml?.agents?.provider,
    );
  const registry = o.registry ?? createRegistry();
  const ctx = buildToolContext({
    rootDir,
    caps: 'all',
    project: o.input.project,
    env: o.input.env,
    onProgress: (p) => o.onEvent?.({ type: 'status', message: p.message ?? '' }),
  });
  const tools = roleTools(o.role, registry, ctx);
  const system = roleSystemPrompt(o.role, o.input);
  const prompt = def.buildPrompt(o.input);
  const mcpServers: Record<string, any> = {};
  for (const [name, s] of Object.entries(yaml?.mcp?.servers ?? {})) {
    if (s.enabled === false || name === 'playwright') continue;
    const env = Object.fromEntries(
      Object.entries(s.envFrom ?? {}).map(([k, v]) => [k, process.env[v] ?? '']),
    );
    const headers = Object.fromEntries(
      Object.entries(s.headersFrom ?? {}).map(([k, v]) => [k, process.env[v] ?? '']),
    );
    mcpServers[name] = {
      transport: s.transport ?? 'stdio',
      command: s.command,
      args: s.args,
      url: s.url,
      env,
      headers,
      allowedTools: s.allowedTools,
    };
  }
  const job: AgentJob = {
    id: `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${o.role}-${newId().slice(-6)}`,
    role: o.role,
    project: o.input.project,
    env: o.input.env,
    status: 'queued',
    provider: adapter.provider,
    model:
      o.model ??
      yaml?.agents?.models?.[o.role] ??
      yaml?.agents?.models?.default ??
      adapter.defaultModel,
    input: o.input,
    startedAt: new Date().toISOString(),
    proposalIds: [],
    budgetUsd:
      o.budgetUsd ??
      yaml?.agents?.budgetUsd?.[o.role] ??
      yaml?.agents?.budgetUsd?.default ??
      def.defaults.budgetUsd,
    maxTurns: o.maxTurns ?? yaml?.agents?.maxTurns?.[o.role] ?? def.defaults.maxTurns,
    dryRun: o.dryRun,
  };
  return {
    job,
    ctx,
    registry,
    system,
    prompt,
    tools,
    adapter,
    mcpServers,
    needsBrowser: def.needsBrowser,
  };
}

export async function runJob(o: RunJobOptions): Promise<AgentJob> {
  const prep = prepareJob(o);
  const { job, ctx, adapter, system, prompt, tools, mcpServers, needsBrowser } = prep;
  const journal = new JobJournal(ctx.rootDir);
  const before = new Set(new ProposalStore(ctx.rootDir).list().map((p) => p.id));
  const events: AgentEvent[] = [];
  job.status = 'running';
  journal.save(job);
  try {
    const result = await adapter.runAgent({
      system,
      prompt,
      tools,
      mcpServers,
      needsBrowser,
      model: job.model,
      maxTurns: job.maxTurns,
      maxBudgetUsd: job.budgetUsd,
      cwd: ctx.rootDir,
      signal: o.signal,
      onEvent: (e) => {
        if (o.keepEvents) events.push(e);
        o.onEvent?.(e);
      },
    });
    job.costUsd = result.costUsd;
    job.turns = result.turns;
    job.toolCalls = result.toolCalls;
    job.resultText = result.text;
    job.proposalIds = new ProposalStore(ctx.rootDir)
      .list()
      .map((p) => p.id)
      .filter((id) => !before.has(id));
    job.status = result.isError
      ? 'failed'
      : job.proposalIds.length
        ? 'awaiting_review'
        : 'completed';
    if (result.isError) job.error = result.stopReason;
  } catch (e) {
    job.status = o.signal?.aborted ? 'cancelled' : 'failed';
    job.error = (e as Error).message;
  }
  job.finishedAt = new Date().toISOString();
  if (o.keepEvents) job.events = events;
  journal.save(job);
  return job;
}
