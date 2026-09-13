import { relative } from 'node:path';
import type { Command } from 'commander';
import {
  listFeatureFiles,
  normalizeTagExpr,
  parseFeatureFile,
  parseTagExpr,
  scenariosOf,
} from '@sdods/core';
import { createContext } from '../context.js';
import { json, table } from '../ui.js';

export function register(program: Command) {
  const features = program.command('features').description('Inspect feature files and scenarios');
  features
    .command('list')
    .description('List features with module, layer, suite, scenario count and tags')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('--tags <expr>', 'only scenarios matching this tag expression (as in `sdods run`)')
    .option('--scenarios', 'one row per scenario instead of per feature')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const cfg = ctx.registry.resolve(opts.project);
      const tagExpr = normalizeTagExpr(opts.tags);
      const selector = tagExpr ? parseTagExpr(tagExpr) : undefined;
      const rows: Array<Record<string, unknown>> = [];
      for (const file of listFeatureFiles(cfg.project.root)) {
        const rel = relative(cfg.project.root, file).replace(/\\/g, '/');
        const parsed = parseFeatureFile(file);
        const mod = ctx.registry.moduleOfFeature(opts.project, rel)?.name ?? '';
        const scenarios = scenariosOf(parsed).filter((s) => !selector || selector.evaluate(s.tags));
        if (!scenarios.length && selector) continue;
        if (opts.scenarios) {
          for (const s of scenarios) {
            rows.push({
              feature: rel,
              module: mod,
              line: s.line,
              scenario: s.name,
              layer: s.tags.find((t) => ['@ui', '@api', '@hybrid'].includes(t)) ?? '',
              suite:
                s.tags.find((t) => cfg.project.tags.suites.map((x) => `@${x}`).includes(t)) ?? '',
              tags: s.tags.join(' '),
            });
          }
        } else {
          const tags = [...new Set(scenarios.flatMap((s) => s.tags))];
          rows.push({
            feature: rel,
            module: mod,
            name: parsed.document.feature?.name ?? '',
            scenarios: scenarios.length,
            layers: [
              ...new Set(
                scenarios.map(
                  (s) => s.tags.find((t) => ['@ui', '@api', '@hybrid'].includes(t)) ?? '?',
                ),
              ),
            ].join(','),
            tags: tags.join(' '),
            errors: parsed.errors.length,
          });
        }
      }
      if (ctx.opts.json) return json(rows);
      table(rows);
    });
}
