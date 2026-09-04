import type { Command } from 'commander';
import pc from 'picocolors';
import { WORKSPACE_FILE } from '@sdods/core';
import { createContext } from '../context.js';
import { json, out, table } from '../ui.js';

/**
 * Hierarchy commands: organization → workspaces → projects → modules → processes.
 * File-based (no database needed). Membership roles are shown by `sdods users` / the web UI
 * once a database is configured.
 */
export function registerWorkspaceCommands(program: Command) {
  const ws = program
    .command('workspace')
    .description('Organization, workspaces and their projects');

  ws.command('tree')
    .description(`Show the hierarchy from ${WORKSPACE_FILE} and projects/*`)
    .action((_opts, cmd) => {
      const ctx = createContext(cmd);
      const tree = ctx.registry.tree();
      if (ctx.opts.json) return json(tree);
      out(`${pc.bold('org')} ${tree.organization.name} ${pc.dim(`(${tree.organization.slug})`)}`);
      for (const w of tree.workspaces) {
        out(`  ${pc.cyan('workspace')} ${w.workspace.name} ${pc.dim(`(${w.workspace.slug})`)}`);
        if (w.projects.length === 0) out(pc.dim('    (no projects)'));
        for (const p of w.projects) {
          out(`    ${pc.green('project')} ${p.name} ${pc.dim(`(${p.slug})`)}`);
          for (const m of p.modules) {
            out(
              `      ${pc.magenta('module')} ${m.name} ${pc.dim(`[${m.testingTypes.join(', ')}]`)}${m.tags.length ? pc.dim(` tags ${m.tags.join(' ')}`) : ''}`,
            );
          }
          if (p.processes.length) out(`      ${pc.yellow('processes')} ${p.processes.join(', ')}`);
        }
      }
      if (!ctx.registry.workspaceFilePath) {
        out(
          pc.dim(
            `\nNo ${WORKSPACE_FILE} found; showing the built-in default organization/workspace.`,
          ),
        );
      }
    });

  ws.command('list')
    .description('List workspaces of the organization with project counts')
    .action((_opts, cmd) => {
      const ctx = createContext(cmd);
      const rows = ctx.registry.workspaces().map((w) => ({
        slug: w.slug,
        name: w.name,
        default: w.slug === ctx.registry.workspaceFile.defaultWorkspace ? '*' : '',
        projects: ctx.registry
          .projectsInWorkspace(w.slug)
          .map((p) => p.slug)
          .join(', '),
      }));
      if (ctx.opts.json) return json(rows);
      table(rows);
    });

  const processes = program
    .command('processes')
    .description('Named run recipes (pr-check, nightly-regression, release-gate …)');
  processes
    .command('list')
    .description('List processes visible to a project (workspace defaults + project overrides)')
    .requiredOption('-p, --project <slug>', 'project slug')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const rows = ctx.registry.processesOf(opts.project).map((p) => ({
        name: p.name,
        trigger: p.trigger,
        tags: p.tags ?? '',
        layers: p.layers?.join(',') ?? '(all)',
        browsers: p.browsers?.join(',') ?? '(project)',
        env: p.env ?? '(default)',
        gates: Object.entries(p.gates)
          .filter(([, v]) => v !== undefined && v !== false)
          .map(([k, v]) => `${k}=${v}`)
          .join(' '),
        schedule: p.schedule ?? '',
      }));
      if (ctx.opts.json) return json(ctx.registry.processesOf(opts.project));
      table(rows);
    });
}
