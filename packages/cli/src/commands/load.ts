import { relative } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { SdodsError } from '@sdods/core';
import { createContext } from '../context.js';
import { heading, json, ok, out, table, warn } from '../ui.js';

export function register(program: Command) {
  program
    .command('load')
    .description(
      'Load test an API with k6: generate a script from load/<profile>.yaml and run it (opt-in per environment)',
    )
    .argument('[profile]', 'profile name: projects/<slug>/load/<profile>.yaml')
    .option('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment (must set load.allowed: true)')
    .option('--dry-run', 'write the k6 script and stop; k6 is not needed')
    .option('--out <dir>', 'output directory (default .sdods/runs/<id>/load/<profile>)')
    .option('--runner <runner>', 'auto | k6 | docker (auto uses k6 on PATH)', 'auto')
    .option('--image <image>', 'k6 image for --runner docker', 'grafana/k6:latest')
    .option('--list', 'list the load profiles of the project')
    .action(async (profile: string | undefined, opts, cmd: Command) => {
      const ctx = createContext(cmd);
      const entry = ctx.registry.pick(opts.project);
      const load = await import('@sdods/core/load');

      if (opts.list) {
        const rows = load.listLoadProfiles(entry.root).map((name) => ({ profile: name }));
        if (ctx.opts.json) return json(rows);
        if (!rows.length)
          return out(pc.dim(`no profiles in ${relative(ctx.rootDir, entry.root)}/load`));
        return table(rows, ['profile']);
      }
      if (!profile) {
        throw new SdodsError('CONFIG_INVALID', 'Name a load profile, or pass --list.', {
          hint: `sdods load -p ${entry.slug} -e <env> <profile> --dry-run`,
          exitCode: 2,
        });
      }
      if (!['auto', 'k6', 'docker'].includes(opts.runner)) {
        throw new SdodsError('CONFIG_INVALID', `--runner must be auto, k6 or docker.`, {
          exitCode: 2,
        });
      }

      const quiet = Boolean(ctx.opts.json || ctx.opts.quiet);
      if (!quiet) heading(`load · ${entry.slug} · ${profile}${opts.dryRun ? ' · dry run' : ''}`);
      const res = await load.runLoad({
        rootDir: ctx.rootDir,
        projectRoot: entry.root,
        profile,
        env: opts.env,
        outDir: opts.out,
        dryRun: Boolean(opts.dryRun),
        runner: opts.runner,
        image: opts.image,
        // --json keeps stdout for the result; k6's own output goes to stderr.
        stdio: ctx.opts.json ? 'stderr' : 'inherit',
        log: (line) => {
          if (quiet) return;
          if (line.startsWith('warning: ')) warn(line.slice('warning: '.length));
          else out(line);
        },
      });

      process.exitCode = res.exitCode;
      if (ctx.opts.json) return json(res);
      const script = relative(ctx.rootDir, res.scriptFile);
      if (res.dryRun) {
        ok(`script written: ${script}`);
        if (res.requiredEnv.length)
          out(pc.dim(`reads from the environment: ${res.requiredEnv.join(', ')}`));
        return;
      }
      const s = res.summary;
      if (s) {
        table(
          [
            {
              requests: s.requests ?? '',
              'p95 ms': s.p95Ms === undefined ? '' : Math.round(s.p95Ms),
              failed: s.failedRate === undefined ? '' : `${(s.failedRate * 100).toFixed(2)}%`,
              checks: s.checksRate === undefined ? '' : `${(s.checksRate * 100).toFixed(2)}%`,
            },
          ],
          ['requests', 'p95 ms', 'failed', 'checks'],
        );
      }
      if (res.summaryFile) out(pc.dim(`summary: ${relative(ctx.rootDir, res.summaryFile)}`));
      if (res.exitCode === 0) ok('thresholds passed');
      else if (res.thresholdsFailed) warn('thresholds failed (k6 exit 99)');
      else warn(`k6 exited with ${res.k6ExitCode}`);
    });
}
