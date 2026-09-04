import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { SdodsError, DEFAULT_ARTIFACTS_DIR } from '@sdods/core';
import { createContext } from '../context.js';
import { json, out, table } from '../ui.js';

/** Recursively find `trace.zip` files (runner output) below a directory. */
export function findTraceZips(dir: string, depth = 8): string[] {
  const found: string[] = [];
  const walk = (d: string, level: number) => {
    if (level > depth || !existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, level + 1);
      else if (/^trace(-\d+)?\.zip$/.test(name)) found.push(p);
    }
  };
  walk(dir, 0);
  return found.sort();
}

export function listRuns(
  artifactsDir: string,
): Array<{ runId: string; dir: string; mtime: number }> {
  if (!existsSync(artifactsDir)) return [];
  return readdirSync(artifactsDir)
    .map((runId) => {
      const dir = join(artifactsDir, runId);
      try {
        const st = statSync(dir);
        return st.isDirectory() ? { runId, dir, mtime: st.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter((r): r is { runId: string; dir: string; mtime: number } => r !== null)
    .sort((a, b) => b.mtime - a.mtime);
}

export function register(program: Command) {
  program
    .command('trace [zip]')
    .description(
      'Open traces: a zip file, the traces of a run (--run), or of the latest run (--last)',
    )
    .option('--last', 'use the most recent run (default when no zip or --run is given)')
    .option('--run <id>', 'run id under the artifacts directory')
    .option('--artifacts-dir <dir>', `artifacts directory (default: ${DEFAULT_ARTIFACTS_DIR})`)
    .option('--list', 'list trace files instead of opening them')
    .action(async (zip: string | undefined, opts, cmd) => {
      const ctx = createContext(cmd);
      let zips: string[] = [];
      let source = '';
      if (zip) {
        const p = resolvePath(ctx.opts.cwd ?? process.cwd(), zip);
        if (!existsSync(p))
          throw new SdodsError('CONFIG_NOT_FOUND', `No such file: ${p}`, { exitCode: 2 });
        zips = statSync(p).isDirectory() ? findTraceZips(p) : [p];
        source = p;
      } else {
        const artifactsDir = resolvePath(
          ctx.rootDir,
          opts.artifactsDir ?? process.env.SDODS_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR,
        );
        const runs = listRuns(artifactsDir);
        const run = opts.run ? runs.find((r) => r.runId === opts.run) : runs[0];
        if (!run) {
          throw new SdodsError(
            'CONFIG_NOT_FOUND',
            opts.run
              ? `Run ${opts.run} not found under ${artifactsDir}.`
              : `No runs under ${artifactsDir}.`,
            {
              hint: 'Run `sdods run …` first. Traces are kept on the first retry and on failure (trace: on-first-retry).',
              exitCode: 2,
            },
          );
        }
        zips = findTraceZips(run.dir);
        source = run.dir;
      }
      if (!zips.length) {
        throw new SdodsError('CONFIG_NOT_FOUND', `No trace.zip under ${source}.`, {
          hint: 'Traces are recorded on the first retry and for failures. Re-run with `--retries 1` or set trace: on in the project timeouts/use.',
          exitCode: 2,
        });
      }
      if (opts.list || ctx.opts.json) {
        if (ctx.opts.json) return json({ source, traces: zips });
        table(zips.map((z) => ({ trace: z })));
        return;
      }
      out(pc.cyan(`Opening ${zips.length} trace(s) from ${source}`));
      const res = await execa('npx', ['playwright', 'show-trace', ...zips], {
        cwd: ctx.rootDir,
        stdio: 'inherit',
        reject: false,
      });
      process.exitCode = res.exitCode ?? 0;
    });
}
