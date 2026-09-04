import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import { formatFindings, lintProject } from '@automax/core';
import { createContext } from '../context.js';
import { collect, json, ok, out } from '../ui.js';

export function register(program: Command) {
  program
    .command('lint [paths...]')
    .description('Validate feature files: Gherkin syntax, tag taxonomy, modules, undefined steps')
    .option('-p, --project <slug>', 'project slug (default: all projects)')
    .option('--undefined-steps', 'also detect undefined steps via bddgen (slower)')
    .option('--fix-tags', 'insert the layer/module tag suggested by a finding')
    .option('--strict', 'treat warnings as errors')
    .option('--file <path>', 'lint only this feature file (repeatable)', collect, [])
    .action(async (paths: string[], opts, cmd) => {
      const ctx = createContext(cmd);
      const entries = opts.project
        ? [ctx.registry.entry(opts.project)]
        : ctx.registry.entriesList();
      const all = { errors: [] as any[], warnings: [] as any[], filesChecked: 0 };
      for (const e of entries) {
        const cfg = ctx.registry.resolve(e.slug);
        const files = [...paths, ...(opts.file as string[])].map((f) => resolvePath(f));
        const result = await lintProject({
          project: cfg.project,
          files: files.length ? files : undefined,
          undefinedSteps: opts.undefinedSteps,
          repoRoot: ctx.rootDir,
        });
        if (opts.fixTags) applyTagFixes(cfg.project.root, result);
        all.errors.push(...result.errors.map((x) => ({ ...x, project: e.slug })));
        all.warnings.push(...result.warnings.map((x) => ({ ...x, project: e.slug })));
        all.filesChecked += result.filesChecked;
      }
      const failed = all.errors.length > 0 || (opts.strict && all.warnings.length > 0);
      if (ctx.opts.json) json({ ok: !failed, ...all });
      else if (all.errors.length || all.warnings.length) out(formatFindings(all));
      else ok(`${all.filesChecked} feature file(s) linted, no findings`);
      if (failed) process.exitCode = 3;
    });
}

function applyTagFixes(projectRoot: string, result: { errors: any[]; warnings: any[] }) {
  const byFile = new Map<string, Array<{ line: number; tag: string }>>();
  for (const f of [...result.errors, ...result.warnings]) {
    if (!f.fix?.insertTag || !f.line) continue;
    const list = byFile.get(f.file) ?? [];
    list.push({ line: f.line, tag: f.fix.insertTag });
    byFile.set(f.file, list);
  }
  for (const [rel, fixes] of byFile) {
    const file = join(projectRoot, rel);
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const { line, tag } of fixes.sort((a, b) => b.line - a.line)) {
      // tags live on the line above the Scenario keyword
      const idx = line - 2;
      if (idx >= 0 && lines[idx]!.trim().startsWith('@')) {
        if (!lines[idx]!.includes(tag)) lines[idx] = `${lines[idx]} ${tag}`;
      } else {
        const indent = /^\s*/.exec(lines[line - 1] ?? '')?.[0] ?? '';
        lines.splice(line - 1, 0, `${indent}${tag}`);
      }
    }
    writeFileSync(file, lines.join('\n'));
  }
}
