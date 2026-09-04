import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { SdodsError, HealHistory, collectHealEvents, summarizeHealEvents } from '@sdods/core';
import { createContext } from '../context.js';
import { json, out, table } from '../ui.js';

export function latestRunDir(artifactsDir: string): string | undefined {
  if (!existsSync(artifactsDir)) return undefined;
  const dirs = readdirSync(artifactsDir)
    .map((d) => join(artifactsDir, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'run.json')))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dirs[0];
}

export function register(program: Command) {
  const heal = program.command('heal').description('Self-healing locator reports');
  heal
    .command('report')
    .description('Summarise heal events from a run (or every run) and suggest locator updates')
    .option('--run <id>', 'run id')
    .option('--last', 'the most recent run (default)')
    .option('--all', 'aggregate every run under the artifacts dir')
    .option('--write-history', 'persist a heal-history.json used to bias future heals')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const artifacts = join(ctx.rootDir, process.env.SDODS_ARTIFACTS_DIR ?? '.sdods/runs');
      const root = opts.all
        ? artifacts
        : opts.run
          ? join(artifacts, opts.run)
          : latestRunDir(artifacts);
      if (!root || !existsSync(root))
        throw new SdodsError('RUN_FAILED', 'No run found.', {
          hint: 'Run `sdods run` first or pass --run <id>.',
          exitCode: 2,
        });
      const events = collectHealEvents(root);
      const rows = summarizeHealEvents(events);
      if (opts.writeHistory) {
        const history = new HealHistory(join(artifacts, '..', 'heal-history.json'));
        for (const e of events) history.record(e);
        history.save();
      }
      if (ctx.opts.json) return json({ root, events: events.length, rows });
      if (!rows.length) return out(pc.green(`No heal events under ${root}`));
      table(
        rows.map((r) => ({
          description: r.description,
          original: r.originalSelector,
          occurrences: r.occurrences,
          succeeded: r.succeeded,
          strategy: Object.entries(r.strategies)
            .map(([k, v]) => `${k}×${v}`)
            .join(' '),
          suggested: r.suggestedSelector ?? '',
        })),
      );
      out(pc.dim(`${events.length} event(s) from ${root}`));
    });
}
