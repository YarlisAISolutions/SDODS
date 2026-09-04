import { join } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import type { StepDef } from '@sdods/contracts';
import { SdodsError, coreStepsDir } from '@sdods/core';
import { createContext } from '../context.js';
import { json, table } from '../ui.js';

/** Parse `bddgen export` output (`* Given ...` lines) into StepDef[]. */
export async function listSteps(
  rootDir: string,
  slug: string,
  opts: { unused?: boolean } = {},
): Promise<StepDef[]> {
  const env = {
    ...process.env,
    SDODS_PROJECT: slug,
    SDODS_ARTIFACTS_DIR: join(rootDir, '.sdods', 'lint'),
    SDODS_LAYERS: '',
  };
  const args = ['bddgen', 'export', '-c', join(rootDir, 'playwright.config.ts')];
  if (opts.unused) args.push('--unused-steps');
  const result = await execa('npx', args, { cwd: rootDir, env, reject: false, all: true });
  if (result.exitCode !== 0) {
    throw new SdodsError('RUN_FAILED', `bddgen export failed for ${slug}.`, {
      details: { output: result.all?.slice(-2000) },
    });
  }
  const steps: StepDef[] = [];
  for (const raw of (result.all ?? '').split('\n')) {
    const line = raw.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '').trim();
    const m = /^\*\s+(Given|When|Then)\s+(.+)$/.exec(line);
    if (m)
      steps.push({ keyword: m[1] as StepDef['keyword'], pattern: m[2]!.trim(), source: 'project' });
    else if (opts.unused) {
      const u = /^\|\s*(.+?)\s*\|\s*(.+?):(\d+)\s*\|$/.exec(line);
      if (u)
        steps.push({
          keyword: 'Unknown',
          pattern: u[1]!,
          file: u[2],
          line: Number(u[3]),
          source: u[2]!.includes(coreStepsDir()) ? 'core' : 'project',
        });
    }
  }
  return steps;
}

export function register(program: Command) {
  const steps = program
    .command('steps')
    .description('Inspect step definitions available to a project');
  steps
    .command('list')
    .description('List all step definitions (core library + project) as seen by bddgen')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('--unused', 'only steps not used by any feature')
    .option('--grep <text>', 'filter by substring')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      let result = await listSteps(ctx.rootDir, opts.project, { unused: opts.unused });
      if (opts.grep)
        result = result.filter((s) =>
          s.pattern.toLowerCase().includes(String(opts.grep).toLowerCase()),
        );
      if (ctx.opts.json) return json(result);
      table(
        result.map((s) => ({
          keyword: s.keyword,
          pattern: s.pattern,
          ...(s.file ? { location: `${s.file}:${s.line}` } : {}),
        })),
      );
    });
}
