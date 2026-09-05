import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { SdodsDb } from '@sdods/db';
import { getProjectBySlug, upsertRun } from '@sdods/db';
import { newRunId, runFiles, type RunRecord, type RunTrigger } from '@sdods/contracts';
import type { ServerConfig } from '../config.js';
import { spawnCli } from './cli.js';
import { LogBuffer } from './log-buffer.js';

export interface StartRunInput {
  project: string;
  env?: string;
  tags?: string;
  layers?: string[];
  browsers?: string[];
  modules?: string[];
  process?: string;
  headed?: boolean;
  workers?: number;
  feature?: string;
  scenario?: string;
  harMode?: 'off' | 'update' | 'replay';
  strict?: boolean;
  projectMatrix?: boolean;
  retries?: number;
  trigger?: RunTrigger;
  scheduleId?: string;
}

export interface RunJob {
  runId: string;
  input: StartRunInput;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'error';
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  log: LogBuffer;
  child?: ChildProcess;
  startedBy?: string | null;
  /** Why the run ended badly, when the CLI never got far enough to record totals itself. */
  errorText?: string;
}

export interface RunnerHooks {
  /** override for tests: return a fake child-like process */
  spawn?: (config: ServerConfig, args: string[], env: NodeJS.ProcessEnv) => ChildProcess;
  onFinished?: (job: RunJob) => void | Promise<void>;
}

/** Spawns `sdods run …`, tracks logs/status, enforces concurrency and supports cancel. */
export class RunManager {
  private readonly jobs = new Map<string, RunJob>();
  private readonly queue: RunJob[] = [];
  private running = 0;

  constructor(
    private readonly config: ServerConfig,
    private readonly adb: SdodsDb,
    private readonly hooks: RunnerHooks = {},
  ) {}

  list(): RunJob[] {
    return [...this.jobs.values()];
  }

  get(runId: string): RunJob | undefined {
    return this.jobs.get(runId);
  }

  isRunningForSchedule(scheduleId: string): boolean {
    return [...this.jobs.values()].some(
      (j) => j.input.scheduleId === scheduleId && (j.status === 'running' || j.status === 'queued'),
    );
  }

  async start(input: StartRunInput, startedBy: string | null = null): Promise<RunJob> {
    const runId = newRunId();
    const runDir = join(this.config.artifactsDir, runId);
    mkdirSync(runDir, { recursive: true });
    const job: RunJob = {
      runId,
      input,
      status: 'queued',
      log: new LogBuffer(5000, join(runDir, runFiles.log)),
      startedBy,
    };
    this.jobs.set(runId, job);
    const project = await getProjectBySlug(this.adb.db, input.project);
    if (project) {
      await upsertRun(this.adb.db, this.adb.driver, {
        id: runId,
        projectId: project.id,
        workspaceId: (project as { workspaceId?: string | null }).workspaceId ?? null,
        envName: input.env ?? 'default',
        process: input.process ?? null,
        trigger: input.trigger ?? 'ui',
        status: 'queued',
        tagsExpr: input.tags ?? null,
        layers: input.layers,
        browsers: input.browsers,
        startedBy,
        artifactsDir: runDir,
        command: this.args(job).join(' '),
      });
    }
    this.queue.push(job);
    this.pump();
    return job;
  }

  cancel(runId: string): boolean {
    const job = this.jobs.get(runId);
    if (!job) return false;
    if (job.status === 'queued') {
      const i = this.queue.indexOf(job);
      if (i >= 0) this.queue.splice(i, 1);
      this.finish(job, 'cancelled', 130);
      return true;
    }
    if (job.status !== 'running' || !job.child) return false;
    job.log.push('sys', 'cancel requested');
    job.child.kill('SIGTERM');
    const t = setTimeout(() => job.child?.kill('SIGKILL'), 10_000);
    t.unref();
    return true;
  }

  private args(job: RunJob): string[] {
    const i = job.input;
    const args = [
      'run',
      '-p',
      i.project,
      '--run-id',
      job.runId,
      '--artifacts-dir',
      this.config.artifactsDir,
      '--trigger',
      i.trigger ?? 'ui',
      '--reporter-mode',
      'server',
    ];
    if (i.env) args.push('-e', i.env);
    if (i.tags) args.push('-t', i.tags);
    for (const l of i.layers ?? []) args.push('-l', l);
    for (const b of i.browsers ?? []) args.push('-b', b);
    for (const m of i.modules ?? []) args.push('-m', m);
    if (i.process) args.push('--process', i.process);
    if (i.headed) args.push('--headed');
    if (i.workers) args.push('-w', String(i.workers));
    if (i.feature) args.push('--feature', i.feature);
    if (i.scenario) args.push('--scenario', i.scenario);
    if (i.harMode === 'replay') args.push('--har-replay');
    if (i.harMode === 'update') args.push('--har-update');
    if (i.strict) args.push('--strict');
    if (i.projectMatrix) args.push('--project-matrix');
    if (i.retries !== undefined) args.push('--retries', String(i.retries));
    args.push('--ingest');
    return args;
  }

  private pump() {
    while (this.running < this.config.maxConcurrentRuns && this.queue.length) {
      const job = this.queue.shift()!;
      this.launch(job);
    }
  }

  private launch(job: RunJob) {
    this.running++;
    job.status = 'running';
    job.startedAt = Date.now();
    const args = this.args(job);
    job.log.push('sys', `sdods ${args.join(' ')}`);
    const spawner = this.hooks.spawn ?? spawnCli;
    const child = spawner(this.config, args, { SDODS_TRIGGER: job.input.trigger ?? 'ui' });
    job.child = child;
    void this.setStatus(job, 'running');
    const onLine = (stream: 'out' | 'err') => {
      let buf = '';
      return (chunk: Buffer) => {
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const p of parts) if (p.trim()) job.log.push(stream, p);
      };
    };
    child.stdout?.on('data', onLine('out'));
    // Keep the tail of stderr: a run that dies before the CLI can ingest totals leaves the
    // database with status failed and nothing to explain it, which is what the UI then shows.
    const stderrTail: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > 20) stderrTail.shift();
      }
      job.errorText = stderrTail.join('\n').slice(-2000);
    });
    child.stderr?.on('data', onLine('err'));
    child.on('error', (e) => {
      job.log.push('sys', `spawn error: ${e.message}`);
      job.errorText = `could not start ${this.config.cliBin}: ${e.message}`;
      this.finish(job, 'error', 1);
    });
    child.on('exit', (code, signal) => {
      const exit = code ?? (signal ? 130 : 1);
      const status: RunJob['status'] =
        signal === 'SIGTERM' || signal === 'SIGKILL' || exit === 130
          ? 'cancelled'
          : exit === 0
            ? 'passed'
            : exit === 1
              ? 'failed'
              : 'error';
      this.finish(job, status, exit);
    });
  }

  private finish(job: RunJob, status: RunJob['status'], exitCode: number) {
    if (job.status === 'running') this.running = Math.max(0, this.running - 1);
    job.status = status;
    job.exitCode = exitCode;
    job.finishedAt = Date.now();
    job.log.push('sys', `finished: ${status} (exit ${exitCode})`);
    job.log.close();
    void this.setStatus(job, status, exitCode).finally(() => {
      void this.hooks.onFinished?.(job);
      this.pump();
    });
  }

  private async setStatus(job: RunJob, status: RunJob['status'], exitCode?: number) {
    try {
      const existing = await this.adb.db
        .selectFrom('runs')
        .select(['id', 'status', 'project_id', 'env_name'])
        .where('id', '=', job.runId)
        .executeTakeFirst();
      if (!existing) return;
      // The CLI ingests the final totals itself; only touch status when it is still ours to set.
      const cliFinal =
        ['passed', 'failed'].includes(existing.status) &&
        status !== 'cancelled' &&
        status !== 'error';
      if (cliFinal) return;
      await upsertRun(this.adb.db, this.adb.driver, {
        id: job.runId,
        projectId: existing.project_id,
        envName: existing.env_name,
        status,
        exitCode: exitCode ?? null,
        startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
        finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : undefined,
        durationMs: job.startedAt && job.finishedAt ? job.finishedAt - job.startedAt : undefined,
        // Only reached when the CLI did not finalise the run itself (see cliFinal above), so this
        // is exactly the case where the operator has nothing else to go on.
        errorText:
          status === 'error' || status === 'failed'
            ? (job.errorText ?? 'run process failed')
            : undefined,
      });
    } catch {
      /* db unavailable */
    }
  }

  /** On boot: any DB run still marked running/queued without a live child is an orphan. */
  async markOrphans(): Promise<number> {
    const rows = await this.adb.db
      .selectFrom('runs')
      .select(['id', 'project_id', 'env_name'])
      .where('status', 'in', ['running', 'queued'])
      .execute();
    let n = 0;
    for (const r of rows) {
      if (this.jobs.has(r.id)) continue;
      await upsertRun(this.adb.db, this.adb.driver, {
        id: r.id,
        projectId: r.project_id,
        envName: r.env_name,
        status: 'error',
        errorText: 'server restarted while the run was active',
        finishedAt: new Date().toISOString(),
      });
      n++;
    }
    return n;
  }

  /** Summary file written by the CLI, when present. */
  readSummary(runId: string): Record<string, unknown> | null {
    const file = join(this.config.artifactsDir, runId, runFiles.summary);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  toRecord(job: RunJob): Partial<RunRecord> & { runId: string; live: true } {
    return {
      runId: job.runId,
      id: job.runId,
      projectSlug: job.input.project,
      env: job.input.env ?? '',
      status: job.status,
      trigger: job.input.trigger ?? 'ui',
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
      finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : undefined,
      exitCode: job.exitCode,
      live: true,
    };
  }
}
