import { join } from 'node:path';
import { z } from 'zod';
import { SdodsCliError, sdodsCli, cliOrNote } from '../cli.js';
import { projectRoot, readYaml } from '../fs.js';
import { defineTool, summarize } from '../registry/registry.js';

export const issueTools = [
  defineTool({
    name: 'issue_create',
    title: 'Create an issue for a failed run',
    description:
      'Create (or comment on an existing) GitHub/Jira issue for the failures of a run via `sdods integrations notify`. Use dryRun to preview.',
    shape: {
      runId: z.string(),
      project: z.string().optional(),
      provider: z.enum(['github', 'jira']).optional(),
      dryRun: z.boolean().optional(),
    },
    access: 'write',
    domain: 'integrations',
    capability: 'issues',
    annotations: { openWorldHint: true },
    handler: async (args, ctx) => {
      const cli = ['integrations', 'notify', '--run-id', args.runId, '--from-files'];
      if (args.project) cli.push('-p', args.project);
      if (args.provider) cli.push('--provider', args.provider);
      if (args.dryRun) cli.push('--dry-run');
      const data = await cliOrNote(cli, {
        cwd: ctx.rootDir,
        signal: ctx.signal,
        timeoutMs: 120_000,
      });
      return {
        text: summarize(
          `Issue ${args.dryRun ? 'preview' : 'creation'} for run ${args.runId}`,
          data,
        ),
        data,
      };
    },
  }),
  defineTool({
    name: 'issue_link',
    title: 'List issue links',
    description:
      'Scenario ↔ issue links (@jira:KEY / @github:N tags and auto-created issues) for a project.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'integrations',
    capability: 'issues',
    handler: async (args, ctx) => {
      const data = await cliOrNote(['integrations', 'links', '-p', args.project], {
        cwd: ctx.rootDir,
        signal: ctx.signal,
      });
      return { text: summarize(`Issue links for ${args.project}`, data), data };
    },
  }),
  defineTool({
    name: 'issue_sync',
    title: 'Sync issue statuses',
    description:
      'Scan features for @jira:/@github: tags, create missing links and refresh statuses from the trackers.',
    shape: { project: z.string() },
    access: 'write',
    domain: 'integrations',
    capability: 'issues',
    annotations: { openWorldHint: true },
    handler: async (args, ctx) => {
      try {
        const r = await sdodsCli(['integrations', 'sync', '-p', args.project], {
          cwd: ctx.rootDir,
          signal: ctx.signal,
          timeoutMs: 120_000,
        });
        return { text: summarize(`Synced ${args.project}`, r.json), data: r.json };
      } catch (e) {
        if (e instanceof SdodsCliError)
          return { text: `Sync failed: ${e.message}`, data: e.error, isError: true };
        throw e;
      }
    },
  }),
];

export const scheduleTools = [
  defineTool({
    name: 'schedule_list',
    title: 'List schedules',
    description:
      'Cron schedules declared in a project yaml (and the processes that carry a schedule).',
    shape: { project: z.string() },
    access: 'read',
    domain: 'schedules',
    capability: 'schedules',
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const yaml = readYaml<{
        schedules?: unknown[];
        processes?: Array<{ name: string; schedule?: string; trigger?: string }>;
      }>(join(root, 'sdods.project.yaml'));
      const ws = readYaml<{
        defaults?: { processes?: Array<{ name: string; schedule?: string; trigger?: string }> };
      }>(join(ctx.rootDir, 'sdods.workspace.yaml'));
      const scheduledProcesses = [...(ws?.defaults?.processes ?? []), ...(yaml?.processes ?? [])]
        .filter((p) => p.schedule)
        .map((p) => ({ process: p.name, cron: p.schedule, trigger: p.trigger }));
      const data = { schedules: yaml?.schedules ?? [], scheduledProcesses };
      return { text: summarize(`Schedules of ${args.project}`, data), data };
    },
  }),
  defineTool({
    name: 'schedule_next',
    title: 'Next fire times',
    description: 'Preview the next fire times of a cron expression in a timezone (5-field cron).',
    shape: {
      cron: z.string(),
      timezone: z.string().optional(),
      count: z.number().int().positive().max(20).optional(),
    },
    access: 'read',
    domain: 'schedules',
    capability: 'schedules',
    handler: async (args) => {
      const times = nextCronTimes(args.cron, args.count ?? 5, args.timezone ?? 'UTC');
      return {
        text: summarize(
          `Next ${times.length} fire times for "${args.cron}" (${args.timezone ?? 'UTC'})`,
          times,
        ),
        data: { times },
      };
    },
  }),
];

/** Minimal 5-field cron evaluator (minute hour dom month dow) — good enough for previews. */
export function nextCronTimes(
  expr: string,
  count: number,
  timeZone: string,
  from = new Date(),
): string[] {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5)
    throw Object.assign(new Error(`Expected 5 cron fields, got ${fields.length}`), {
      error: { code: 'INVALID_ARGS' },
    });
  const parse = (f: string, min: number, max: number): Set<number> => {
    const out = new Set<number>();
    for (const part of f.split(',')) {
      const [rangePart, stepPart] = part.split('/');
      const step = stepPart ? Number(stepPart) : 1;
      let lo = min;
      let hi = max;
      if (rangePart !== '*') {
        const [a, b] = rangePart!.split('-').map(Number);
        lo = a!;
        hi = b ?? (stepPart ? max : a!);
      }
      for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return out;
  };
  const [mi, ho, dom, mo, dow] = [
    parse(fields[0]!, 0, 59),
    parse(fields[1]!, 0, 23),
    parse(fields[2]!, 1, 31),
    parse(fields[3]!, 1, 12),
    parse(fields[4]!, 0, 7),
  ];
  if (dow.has(7)) dow.add(0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
  const parts = (d: Date) => {
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!);
    return {
      minute: Number(p.minute),
      hour: Number(p.hour),
      day: Number(p.day),
      month: Number(p.month),
      weekday: wd,
    };
  };
  const out: string[] = [];
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60 && out.length < count; i++) {
    const p = parts(cursor);
    if (
      mi.has(p.minute) &&
      ho.has(p.hour) &&
      dom.has(p.day) &&
      mo.has(p.month) &&
      dow.has(p.weekday)
    )
      out.push(cursor.toISOString());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return out;
}
