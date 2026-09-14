import { writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { ROLES_MATRIX_FILE, listFeatureFiles, planMatrixExpansion } from '@sdods/core';
import { createContext } from '../context.js';
import { collect, json, ok, out } from '../ui.js';

/**
 * `sdods matrix expand` — write the `Examples:` blocks of every `@matrix:<name>` Scenario Outline
 * from `roles.matrix.yaml` (#118). `--check` writes nothing and fails when a feature is out of date,
 * for CI; `--dry-run` writes nothing and, with `--json`, returns the expanded text (the MCP
 * `matrix_expand` tool turns that into a proposal instead of touching the working tree).
 */
export function register(program: Command) {
  const matrix = program
    .command('matrix')
    .description('Role × surface matrices from roles.matrix.yaml');
  matrix
    .command('expand')
    .description('Write the generated Examples of every @matrix:<name> outline')
    .option('-p, --project <slug>', 'project slug (default: all projects)')
    .option('--check', 'write nothing; exit 3 if any feature is out of date or invalid')
    .option('--dry-run', 'write nothing; report what would change (with --json, the new text)')
    .option('--file <path>', 'only this feature file (repeatable)', collect, [])
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const entries = opts.project
        ? [ctx.registry.entry(opts.project)]
        : ctx.registry.entriesList();
      const only = (opts.file as string[]).map((f) => resolvePath(f));
      const write = !opts.check && !opts.dryRun;
      const files: Array<Record<string, unknown>> = [];
      const problems: Array<Record<string, unknown>> = [];
      let configInvalid = false;

      for (const e of entries) {
        // The matrix needs the project file, not an environment: no env is resolved (or required).
        const project = { ...e.config, root: e.root };
        const featureFiles = only.length
          ? only.filter((f) => f.startsWith(project.root))
          : listFeatureFiles(project.root);
        const plan = planMatrixExpansion(project, featureFiles);
        if (plan.loaded?.problems.length) configInvalid = true;
        for (const p of [...plan.problems, ...plan.files.flatMap((f) => f.problems)])
          problems.push({ project: e.slug, ...p });
        for (const f of plan.files) {
          // A template with errors is reported, not rewritten: fix the outline, then expand.
          const blocked = f.problems.some((p) => p.severity === 'error');
          if (write && f.changed && !blocked) writeFileSync(f.file, f.after);
          files.push({
            project: e.slug,
            path: f.path,
            status: !f.changed ? 'unchanged' : write && !blocked ? 'updated' : 'stale',
            examples: f.examples,
            ...(opts.dryRun && ctx.opts.json ? { content: f.after } : {}),
          });
        }
      }

      const errors = problems.filter((p) => p.severity === 'error');
      const stale = files.filter((f) => f.status === 'stale');
      const failed = opts.check ? stale.length > 0 || errors.length > 0 : errors.length > 0;
      if (ctx.opts.json) json({ ok: !failed, files, problems });
      else {
        for (const p of problems)
          out(
            `${p.severity === 'error' ? pc.red('✖') : pc.yellow('⚠')} ${p.project}/${p.file}${p.line ? `:${p.line}` : ''}  ${p.rule}  ${p.message}`,
          );
        for (const f of files) {
          const label =
            f.status === 'updated'
              ? pc.green('updated')
              : f.status === 'stale'
                ? pc.yellow('out of date')
                : pc.dim('up to date');
          out(`${label}  ${f.project}/${f.path}  (${f.examples} generated example(s))`);
        }
        if (!files.length) out(pc.dim(`No @matrix:<name> outlines found (${ROLES_MATRIX_FILE}).`));
        else if (opts.check && !stale.length && !errors.length)
          ok('matrix features are up to date');
        if (opts.check && stale.length)
          out(
            `Run \`sdods matrix expand${opts.project ? ` -p ${opts.project}` : ''}\` and commit the result.`,
          );
      }
      if (opts.dryRun && !opts.check) return;
      if (configInvalid && !opts.check) process.exitCode = 2;
      else if (failed) process.exitCode = 3;
    });
}
