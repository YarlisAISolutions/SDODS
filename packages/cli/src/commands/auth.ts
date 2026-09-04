import type { Command } from 'commander';
import { execa } from 'execa';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, table } from '../ui.js';

/**
 * Login-state commands. Capture/list are thin wrappers over `@automax/core/auth/capture`
 * (the same library `automax record --user` uses) so there is a single implementation.
 */
export function register(program: Command) {
  const auth = program
    .command('auth')
    .description('Capture and inspect login state for pool users');

  auth
    .command('capture')
    .description('Log in as pool user(s) and store storageState under projects/<slug>/.auth/<env>/')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment')
    .option('-u, --user <role>', 'pool role to capture (default: every role)')
    .option('--index <n>', 'pool index within the role', '0')
    .option('--all', 'every user of the role, not only --index')
    .option(
      '--interactive',
      'open a headed browser (SSO/MFA): finish the login by hand, then close the window',
    )
    .option('-b, --browser <name>', 'chromium | firefox | webkit', 'chromium')
    .option('--headed', 'run the login with a visible browser')
    .option('--force', 'recapture even when a fresh state exists')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const cfg = ctx.registry.resolve(opts.project, opts.env);
      const { captureAuth, poolUsers } = await import('@automax/core/auth/capture');
      const roles: string[] = opts.user
        ? [opts.user]
        : [...new Set((await poolUsers(cfg)).map((u) => u.role))];
      const results: Array<{
        user: string;
        role: string;
        index: number;
        strategy: string;
        file?: string;
        tokenFile?: string;
        status: string;
      }> = [];
      for (const role of roles) {
        const captured = await captureAuth({
          config: cfg,
          role,
          index: Number(opts.index),
          all: Boolean(opts.all),
          interactive: Boolean(opts.interactive),
          browserName: opts.browser,
          headed: Boolean(opts.headed || opts.interactive),
          force: Boolean(opts.force),
        });
        for (const r of captured) {
          results.push({
            user: r.user,
            role: r.role,
            index: r.index,
            strategy: r.strategy,
            file: r.file,
            tokenFile: r.tokenFile,
            status: r.skipped ? `skipped: ${r.skipped}` : r.file ? 'captured' : 'no state',
          });
        }
      }
      if (ctx.opts.json) return json(results);
      table(results, ['user', 'role', 'index', 'strategy', 'status', 'file']);
      ok(`states under ${cfg.project.root}/.auth/${cfg.env.name}`);
    });

  auth
    .command('list')
    .description('Show cached login states and their age')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const cfg = ctx.registry.resolve(opts.project, opts.env);
      const { listAuthStates } = await import('@automax/core/auth/capture');
      const rows = listAuthStates(cfg).map((s) => ({
        user: s.user,
        role: s.role,
        ageMinutes: s.ageMinutes,
        fresh: s.fresh ? 'yes' : 'no',
        file: s.file,
        tokenFile: s.tokenFile ?? '',
      }));
      if (ctx.opts.json) return json(rows);
      table(rows, ['user', 'role', 'ageMinutes', 'fresh', 'file']);
    });

  auth
    .command('token')
    .description('Manage API tokens (server feature; delegates to `automax tokens`)')
    .allowUnknownOption()
    .action(async () => {
      const r = await execa('automax', ['tokens', ...process.argv.slice(4)], {
        stdio: 'inherit',
        reject: false,
      });
      if (r.exitCode)
        throw new AutomaxError(
          'NOT_SUPPORTED',
          '`automax tokens` is provided by the server package.',
          { exitCode: 2 },
        );
    });
}
