import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { newId } from '@sdods/contracts';
import type { ServerConfig } from '../config.js';
import { spawnCli } from './cli.js';
import { LogBuffer } from './log-buffer.js';

export type AgentKind = 'plan' | 'generate' | 'heal' | 'upgrade' | 'review' | 'convert';

export interface AgentJobInput {
  project: string;
  kind: AgentKind;
  env?: string;
  goal?: string;
  plan?: string;
  scenario?: string;
  diff?: string;
  spec?: string;
  adapter?: string;
  model?: string;
  dryRun?: boolean;
  budgetUsd?: number;
  maxTurns?: number;
}

export interface AgentJob {
  id: string;
  input: AgentJobInput;
  status: 'running' | 'awaiting_review' | 'done' | 'failed' | 'cancelled';
  startedBy: string | null;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  proposalId?: string;
  log: LogBuffer;
  child?: ChildProcess;
  result?: unknown;
}

/** Spawns `sdods agent <kind> …` and streams its output; proposals are reviewed through `sdods proposals`. */
export class AgentManager {
  private readonly jobs = new Map<string, AgentJob>();

  constructor(private readonly config: ServerConfig) {}

  list(): AgentJob[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): AgentJob | undefined {
    return this.jobs.get(id);
  }

  start(input: AgentJobInput, startedBy: string | null): AgentJob {
    const id = newId();
    const dir = join(this.config.rootDir, '.sdods', 'agent-jobs');
    mkdirSync(dir, { recursive: true });
    const job: AgentJob = {
      id,
      input,
      status: 'running',
      startedBy,
      startedAt: Date.now(),
      log: new LogBuffer(5000, join(dir, `${id}.log`)),
    };
    this.jobs.set(id, job);
    const kind = input.kind === 'convert' ? 'generate' : input.kind;
    const args = ['--json', 'agent', kind, '-p', input.project];
    if (input.env) args.push('-e', input.env);
    if (input.goal) args.push('--goal', input.goal);
    if (input.plan) args.push('--plan', input.plan);
    if (input.scenario) args.push('--scenario', input.scenario);
    if (input.diff) args.push('--diff', input.diff);
    if (input.spec) args.push('--spec', input.spec);
    if (input.adapter) args.push('--adapter', input.adapter);
    if (input.model) args.push('--model', input.model);
    if (input.dryRun) args.push('--dry-run');
    if (input.budgetUsd !== undefined) args.push('--budget-usd', String(input.budgetUsd));
    if (input.maxTurns !== undefined) args.push('--max-turns', String(input.maxTurns));
    job.log.push('sys', `sdods ${args.join(' ')}`);
    const child = spawnCli(this.config, args);
    job.child = child;
    let stdout = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
      for (const line of c.toString().split('\n')) if (line.trim()) job.log.push('out', line);
    });
    child.stderr?.on('data', (c: Buffer) => {
      for (const line of c.toString().split('\n')) if (line.trim()) job.log.push('err', line);
    });
    child.on('exit', (code) => {
      job.exitCode = code ?? 1;
      job.finishedAt = Date.now();
      try {
        job.result = JSON.parse(
          stdout
            .trim()
            .split('\n')
            .filter((l) => l.startsWith('{'))
            .pop() ?? 'null',
        );
        const proposalId =
          (job.result as { proposalId?: string; proposal?: { id?: string } } | null)?.proposalId ??
          (job.result as any)?.proposal?.id;
        if (proposalId) job.proposalId = proposalId;
      } catch {
        job.result = null;
      }
      job.status = code === 0 ? (job.proposalId ? 'awaiting_review' : 'done') : 'failed';
      job.log.push('sys', `finished: ${job.status}`);
      job.log.close();
    });
    child.on('error', (e) => {
      job.status = 'failed';
      job.log.push('sys', `spawn error: ${e.message}`);
      job.log.close();
    });
    return job;
  }

  /** Spawn an arbitrary CLI command as a tracked job (used for `record`). */
  startRaw(args: string[], startedBy: string | null, meta: AgentJobInput): AgentJob {
    const id = newId();
    const job: AgentJob = {
      id,
      input: meta,
      status: 'running',
      startedBy,
      startedAt: Date.now(),
      log: new LogBuffer(2000),
    };
    this.jobs.set(id, job);
    job.log.push('sys', `sdods ${args.join(' ')}`);
    const child = spawnCli(this.config, args);
    job.child = child;
    child.stdout?.on('data', (c: Buffer) =>
      c
        .toString()
        .split('\n')
        .forEach((l) => l.trim() && job.log.push('out', l)),
    );
    child.stderr?.on('data', (c: Buffer) =>
      c
        .toString()
        .split('\n')
        .forEach((l) => l.trim() && job.log.push('err', l)),
    );
    child.on('exit', (code) => {
      job.exitCode = code ?? 1;
      job.finishedAt = Date.now();
      job.status = code === 0 ? 'done' : 'failed';
      job.log.close();
    });
    child.on('error', (e) => {
      job.status = 'failed';
      job.log.push('sys', e.message);
      job.log.close();
    });
    return job;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    job.child?.kill('SIGTERM');
    job.status = 'cancelled';
    return true;
  }
}
