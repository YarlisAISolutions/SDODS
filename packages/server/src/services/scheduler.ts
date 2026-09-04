import { Cron } from 'croner';
import type { AutomaxDb } from '@automax/db';
import {
  getProjectBySlug,
  listSchedules,
  recordScheduleRun,
  updateScheduleState,
  upsertSchedule,
} from '@automax/db';
import type { ProjectRegistry } from '@automax/core/config';
import type { RunManager, StartRunInput } from './run-manager.js';

export interface ScheduleView {
  id: string;
  projectId: string;
  projectSlug?: string;
  name: string;
  cronExpr: string;
  timezone: string;
  runInput: Record<string, unknown>;
  overlapPolicy: string;
  jitterSeconds: number;
  catchUp: boolean;
  enabled: boolean;
  notify: unknown;
  nextRunAt: string | null;
  lastRunId: string | null;
  lastStatus: string | null;
  nextFireTimes?: string[];
  source?: 'db' | 'yaml';
}

/** Cron scheduler over DB schedules (which mirror project yaml schedules/processes). No catch-up storms. */
export class Scheduler {
  private readonly jobs = new Map<string, Cron>();
  private started = false;

  constructor(
    private readonly adb: AutomaxDb,
    private readonly runManager: RunManager,
    private readonly log: { info(msg: string): void; warn(msg: string): void } = console,
  ) {}

  /** Mirror yaml schedules (project `schedules[]` and processes with a `schedule`) into the DB. */
  async syncFromRegistry(registry: ProjectRegistry): Promise<number> {
    let n = 0;
    for (const e of registry.entriesList()) {
      const project = await getProjectBySlug(this.adb.db, e.slug);
      if (!project) continue;
      const entries: Array<{
        name: string;
        cron: string;
        timezone: string;
        input: Record<string, unknown>;
        overlap: string;
        jitter: number;
        catchUp: boolean;
        enabled: boolean;
        notify: unknown;
      }> = [];
      for (const s of e.config.schedules) {
        entries.push({
          name: s.name,
          cron: s.cron,
          timezone: s.timezone,
          input: {
            env: s.env,
            tags: s.tags,
            layers: s.layers,
            browsers: s.browsers,
            workers: s.workers,
            harMode: s.harMode,
          },
          overlap: s.overlap,
          jitter: s.jitterSeconds,
          catchUp: s.catchUp,
          enabled: s.enabled,
          notify: s.notify,
        });
      }
      for (const p of registry.processesOf(e.slug)) {
        if (!p.schedule) continue;
        entries.push({
          name: `process:${p.name}`,
          cron: p.schedule,
          timezone: 'UTC',
          input: { process: p.name, env: p.env },
          overlap: 'skip',
          jitter: 0,
          catchUp: false,
          enabled: true,
          notify: p.notify,
        });
      }
      for (const s of entries) {
        await upsertSchedule(this.adb.db, this.adb.driver, {
          projectId: project.id,
          name: s.name,
          cronExpr: s.cron,
          timezone: s.timezone,
          runInput: s.input,
          overlapPolicy: s.overlap,
          jitterSeconds: s.jitter,
          catchUp: s.catchUp,
          enabled: s.enabled,
          notify: s.notify,
          nextRunAt: nextTimes(s.cron, s.timezone, 1)[0] ?? null,
        });
        n++;
      }
    }
    return n;
  }

  async list(projectId?: string): Promise<ScheduleView[]> {
    const rows = await listSchedules(this.adb.db, projectId);
    const projects = await this.adb.db.selectFrom('projects').select(['id', 'slug']).execute();
    const slugById = new Map(projects.map((p) => [p.id, p.slug]));
    return rows.map((r) => ({
      ...r,
      projectSlug: slugById.get(r.projectId),
      nextFireTimes: nextTimes(r.cronExpr, r.timezone, 5),
      source: 'db' as const,
    }));
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.reload();
  }

  async reload() {
    for (const c of this.jobs.values()) c.stop();
    this.jobs.clear();
    const schedules = await this.list();
    for (const s of schedules) {
      if (!s.enabled) continue;
      try {
        const cron = new Cron(
          s.cronExpr,
          { timezone: s.timezone, catch: true, protect: s.overlapPolicy === 'skip' },
          () => void this.fire(s.id),
        );
        this.jobs.set(s.id, cron);
      } catch (e) {
        this.log.warn(`schedule ${s.name}: invalid cron "${s.cronExpr}": ${(e as Error).message}`);
      }
    }
    this.log.info(`scheduler: ${this.jobs.size} active schedule(s)`);
  }

  stop() {
    for (const c of this.jobs.values()) c.stop();
    this.jobs.clear();
    this.started = false;
  }

  /** Run a schedule now (used by cron ticks and by "run now"). */
  async fire(
    scheduleId: string,
    opts: { force?: boolean } = {},
  ): Promise<{ runId?: string; skipped?: string }> {
    const s = (await this.list()).find((x) => x.id === scheduleId);
    if (!s) return { skipped: 'unknown schedule' };
    if (!opts.force && s.overlapPolicy === 'skip' && this.runManager.isRunningForSchedule(s.id)) {
      await recordScheduleRun(this.adb.db, {
        scheduleId: s.id,
        status: 'skipped',
        note: 'previous run still active',
      });
      return { skipped: 'overlap' };
    }
    if (!opts.force && s.overlapPolicy === 'cancel-previous') {
      for (const j of this.runManager.list())
        if (j.input.scheduleId === s.id && j.status === 'running') this.runManager.cancel(j.runId);
    }
    if (!opts.force && s.jitterSeconds > 0)
      await sleep(Math.floor(Math.random() * s.jitterSeconds * 1000));
    const input = s.runInput as Partial<StartRunInput>;
    const job = await this.runManager.start(
      {
        ...input,
        project: s.projectSlug ?? String(input.project ?? ''),
        trigger: 'schedule',
        scheduleId: s.id,
        layers: input.layers,
        browsers: input.browsers,
      },
      null,
    );
    await recordScheduleRun(this.adb.db, { scheduleId: s.id, runId: job.runId, status: 'started' });
    await updateScheduleState(
      this.adb.db,
      s.id,
      {
        lastRunId: job.runId,
        lastStatus: 'started',
        nextRunAt: nextTimes(s.cronExpr, s.timezone, 1)[0] ?? null,
      },
      this.adb.driver,
    );
    return { runId: job.runId };
  }
}

export function nextTimes(
  cronExpr: string,
  timezone = 'UTC',
  count = 5,
  from = new Date(),
): string[] {
  try {
    const c = new Cron(cronExpr, { timezone });
    return c.nextRuns(count, from).map((d) => d.toISOString());
  } catch {
    return [];
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
