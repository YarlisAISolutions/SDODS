import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import pc from 'picocolors';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, out, table } from '../ui.js';

export function register(program: Command) {
  const proposals = program
    .command('proposals')
    .description('Review and apply proposals written by agents and MCP write tools');

  proposals
    .command('list')
    .description('List proposals (newest first)')
    .option('--status <s>', 'pending | accepted | rejected')
    .option('-p, --project <slug>')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const { ProposalStore } = await import('@automax/mcp');
      const rows = new ProposalStore(ctx.rootDir)
        .list({ status: opts.status, project: opts.project })
        .map((m) => ({
          id: m.id,
          role: m.role,
          project: m.project ?? '',
          status: m.status,
          files: m.files.length,
          summary: m.summary.slice(0, 70),
          created: m.createdAt,
        }));
      if (ctx.opts.json) return json(rows);
      table(rows);
    });

  proposals
    .command('show <id>')
    .description('Show a proposal: manifest and diff against the working tree')
    .action(async (id: string, _opts, cmd) => {
      const ctx = createContext(cmd);
      const { ProposalStore } = await import('@automax/mcp');
      const store = new ProposalStore(ctx.rootDir);
      const m = store.get(id);
      if (!m)
        throw new AutomaxError('CONFIG_NOT_FOUND', `Unknown proposal ${id}`, {
          hint: 'Run `automax proposals list`.',
          exitCode: 2,
        });
      const diff = store.diff(id);
      if (ctx.opts.json) return json({ ...m, diff });
      out(`${pc.bold(m.id)} ${pc.dim(`(${m.role}, ${m.status})`)}\n${m.summary}\n`);
      for (const f of m.files)
        out(
          `  ${f.op === 'add' ? pc.green('+') : f.op === 'delete' ? pc.red('-') : pc.yellow('~')} ${f.path}`,
        );
      out('');
      for (const line of diff.split('\n'))
        out(
          line.startsWith('+')
            ? pc.green(line)
            : line.startsWith('-')
              ? pc.red(line)
              : pc.dim(line),
        );
    });

  proposals
    .command('accept <id>')
    .description('Apply a proposal to the working tree (optionally on a new git branch)')
    .option('--branch <name>', 'create/switch to this branch first')
    .option('--reviewed-by <name>')
    .option('--no-lint', 'skip automax lint after applying')
    .action(async (id: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const { ProposalStore } = await import('@automax/mcp');
      const store = new ProposalStore(ctx.rootDir);
      const m = store.get(id);
      if (!m) throw new AutomaxError('CONFIG_NOT_FOUND', `Unknown proposal ${id}`, { exitCode: 2 });
      if (opts.branch) {
        try {
          execFileSync('git', ['checkout', '-B', opts.branch], {
            cwd: ctx.rootDir,
            stdio: 'ignore',
          });
        } catch (e) {
          throw new AutomaxError(
            'RUN_FAILED',
            `Could not switch to branch ${opts.branch}: ${(e as Error).message}`,
          );
        }
      }
      const written = store.accept(id, { reviewedBy: opts.reviewedBy ?? process.env.USER });
      if (ctx.opts.json) return json({ id, written, branch: opts.branch });
      for (const w of written) ok(w);
      if (opts.lint !== false && m.project) {
        out(pc.dim(`Next: automax lint -p ${m.project}`));
      }
    });

  proposals
    .command('reject <id>')
    .description('Reject a proposal')
    .option('--reason <text>')
    .action(async (id: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const { ProposalStore } = await import('@automax/mcp');
      const m = new ProposalStore(ctx.rootDir).reject(id, opts.reason, process.env.USER);
      if (ctx.opts.json) return json(m);
      ok(`Rejected ${m.id}`);
    });
}
