import type { Command } from 'commander';
import pc from 'picocolors';
import { explainConfig, redact } from '@automax/core';
import { createContext } from '../context.js';
import { json, out, table } from '../ui.js';

export function registerConfigCommands(program: Command) {
  const config = program.command('config').description('Inspect resolved configuration');

  config
    .command('show')
    .description('Print the merged config for a project/env with the winning layer per key')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment name (default: project envs.default)')
    .option('--explain', 'show provenance table instead of the tree')
    .option('--show-secrets', 'do not redact secret-looking values')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const cfg = ctx.registry.resolve(opts.project, opts.env);
      const view = opts.showSecrets ? cfg : redact(cfg);
      if (opts.explain) {
        const rows = explainConfig(cfg).map((r) => ({
          path: r.path,
          layer: r.layer,
          value:
            typeof r.value === 'object'
              ? JSON.stringify(r.value)
              : String(opts.showSecrets ? r.value : redactLeaf(r.path, r.value)),
        }));
        if (ctx.opts.json) return json(rows);
        return table(rows, ['path', 'layer', 'value']);
      }
      if (ctx.opts.json)
        return json({
          project: view.project,
          env: view.env,
          runtime: view.runtime,
          sources: view.sources,
        });
      out(pc.bold(`Project ${cfg.project.slug} · env ${cfg.env.name}`));
      out(
        pc.dim(
          `dotenv files: ${cfg.sources.dotenvFiles.length ? cfg.sources.dotenvFiles.join(', ') : '(none)'}`,
        ),
      );
      out(JSON.stringify({ project: view.project, env: view.env, runtime: view.runtime }, null, 2));
    });

  config
    .command('validate')
    .description('Validate every project and environment file without running anything')
    .action((_opts, cmd) => {
      const ctx = createContext(cmd);
      const results: Array<{ project: string; env: string; ok: boolean; error?: string }> = [];
      for (const e of ctx.registry.entriesList()) {
        for (const env of e.config.envs.available) {
          try {
            ctx.registry.resolve(e.slug, env, {}, { ...process.env });
            results.push({ project: e.slug, env, ok: true });
          } catch (err) {
            results.push({
              project: e.slug,
              env,
              ok: false,
              error: (err as Error).message.split('\n')[0],
            });
          }
        }
      }
      if (ctx.opts.json) return json(results);
      table(
        results.map((r) => ({
          ...r,
          ok: r.ok ? pc.green('ok') : pc.red('FAIL'),
          error: r.error ?? '',
        })),
      );
      if (results.some((r) => !r.ok)) process.exitCode = 2;
    });
}

function redactLeaf(path: string, value: unknown): unknown {
  return /(password|secret|token|apikey|api_key)/i.test(path) && typeof value === 'string' && value
    ? '***'
    : value;
}
