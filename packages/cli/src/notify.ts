import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectConfig } from '@sdods/contracts';
import { SdodsError, Logger, type ProjectRegistry } from '@sdods/core';
import type { RunSummaryInput } from '@sdods/integrations';

export const LINKS_FILE = ['.sdods', 'issue-links.json'] as const;

export interface NotifyRow {
  provider: string;
  kind: string;
  target?: string;
  url?: string;
  detail?: string;
}

export interface NotifyRunOptions {
  rootDir: string;
  registry: Pick<ProjectRegistry, 'entry'>;
  /** absolute artifacts root (the directory holding `<runId>/`) */
  artifactsRoot: string;
  runId: string;
  projectSlug?: string;
  reportUrl?: string;
  dryRun?: boolean;
  only?: string[];
}

/**
 * Publish a finished run to the project's enabled providers. Shared by
 * `sdods integrations notify` and the notify step at the end of `sdods run`.
 */
export async function notifyRun(
  opts: NotifyRunOptions,
): Promise<{ summary: RunSummaryInput; slug: string; actions: NotifyRow[] }> {
  const { buildRunSummaryFromFiles, getProviders, createIntegrationContext, FileIssueLinkStore } =
    await import('@sdods/integrations');
  const runDir = join(opts.artifactsRoot, opts.runId);
  if (!existsSync(runDir)) {
    throw new SdodsError('RUN_FAILED', `Run directory not found: ${runDir}`, {
      hint: 'Pass --artifacts-dir or check the run id (sdods report --last).',
      exitCode: 2,
    });
  }
  const summary = buildRunSummaryFromFiles(runDir, {
    projectSlug: opts.projectSlug,
    reportUrl: opts.reportUrl,
  });
  const slug = summary.run.projectSlug;
  const entry = opts.registry.entry(slug);
  const providers = await getProviders(entry.config, { only: opts.only, projectRoot: entry.root });
  const ictx = createIntegrationContext({
    store: new FileIssueLinkStore(join(opts.rootDir, ...LINKS_FILE)),
    logger: new Logger('integrations'),
    dryRun: Boolean(opts.dryRun),
    artifactsRoot: opts.artifactsRoot,
  });
  const actions: NotifyRow[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    if (p.initError) {
      actions.push({ provider: p.name, kind: 'skipped', detail: p.initError });
      continue;
    }
    try {
      const res = await p.provider.onRunFinished(summary, ictx);
      actions.push(...res.actions);
    } catch (e) {
      actions.push({ provider: p.name, kind: 'error', detail: (e as Error).message });
    }
  }
  return { summary, slug, actions };
}

/** Names of the integrations that act on a finished run. */
export function enabledIntegrations(integrations: ProjectConfig['integrations']): string[] {
  return [
    ...(integrations.github?.enabled ? ['github'] : []),
    ...(integrations.jira?.enabled ? ['jira'] : []),
    ...integrations.custom.map((c) => c.module),
  ];
}

export type AutoNotifyOutcome =
  { ran: true; actions: NotifyRow[]; errors: string[] } | { ran: false; reason: string };

export interface MaybeNotifyInput {
  flags: { notify?: boolean };
  integrations: ProjectConfig['integrations'];
  totals?: { total: number };
  exitCode: number;
  shardTotal?: number;
  notify: () => Promise<{ actions: NotifyRow[] }>;
  warn: (message: string) => void;
}

/**
 * The notify step at the end of `sdods run`. `integrations.github.createIssueOnFailure` and friends
 * used to do nothing unless a separate `sdods integrations notify` step existed.
 * A notify failure is reported, never thrown: it must not change the run's exit code.
 */
export async function maybeNotify(input: MaybeNotifyInput): Promise<AutoNotifyOutcome> {
  if (input.flags.notify === false) return { ran: false, reason: 'disabled by --no-notify' };
  if (!enabledIntegrations(input.integrations).length)
    return { ran: false, reason: 'no integration enabled' };
  if (input.exitCode === 130) return { ran: false, reason: 'run cancelled' };
  if (!input.totals || input.totals.total === 0)
    return { ran: false, reason: 'no scenario results to report' };
  if ((input.shardTotal ?? 1) > 1)
    return {
      ran: false,
      reason: 'sharded run: notify once after merging (sdods integrations notify --run-id <id>)',
    };
  try {
    const { actions } = await input.notify();
    const errors = actions
      .filter((a) => a.kind === 'error')
      .map((a) => `${a.provider}: ${a.detail ?? 'failed'}`);
    for (const e of errors) input.warn(`integrations notify: ${e}`);
    return { ran: true, actions, errors };
  } catch (e) {
    const message = (e as Error).message;
    input.warn(`integrations notify failed: ${message}`);
    return { ran: true, actions: [], errors: [message] };
  }
}
