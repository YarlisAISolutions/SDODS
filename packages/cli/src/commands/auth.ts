import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import {
  AuthStateCache,
  AutomaxError,
  CompositeDataProvider,
  FileUserPool,
  defineAuth,
} from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, out, table } from '../ui.js';

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
      'open a headed browser (SSO): finish the login by hand, then close the window',
    )
    .option('--force', 'recapture even when a fresh state exists')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const cfg = ctx.registry.resolve(opts.project, opts.env);
      const cache = new AuthStateCache(cfg);
      const provider = new CompositeDataProvider(cfg);
      const pool = new FileUserPool(cfg, provider, { owner: `auth-capture:${process.pid}` });
      const all = await pool.status();
      const roles = opts.user ? [opts.user] : [...new Set(all.map((u) => u.role))];
      const { chromium } = await import('playwright-core');
      const browser = await chromium.launch({ headless: !opts.interactive });
      const results: Array<{ user: string; role: string; file?: string; status: string }> = [];
      try {
        for (const role of roles) {
          const members = all.filter((u) => u.role === role);
          const chosen = opts.all ? members : [members[Number(opts.index)]].filter(Boolean);
          for (const m of chosen) {
            const rows = await provider.load(cfg.project.data.userPool!.dataset);
            const idx = rows.findIndex((r) => String(r.username ?? r.id) === m!.username);
            const row = rows[idx]!;
            const user = {
              id: m!.id,
              username: m!.username,
              password: String(row.password ?? ''),
              role,
              index: idx,
              extra: row,
            };
            if (!opts.force && cache.isFresh(user)) {
              results.push({
                user: user.username,
                role,
                file: cache.fileFor(user),
                status: 'fresh (skipped)',
              });
              continue;
            }
            if (opts.interactive) {
              const context = await browser.newContext({ baseURL: cfg.env.ui.baseUrl });
              const page = await context.newPage();
              await page.goto(cfg.project.auth.form?.loginPath ?? '/');
              out(
                pc.cyan(
                  `Complete the login for ${user.username} in the browser window, then close it…`,
                ),
              );
              await new Promise<void>((resolve) => page.once('close', () => resolve()));
              const state = (await context.storageState()) as unknown as Record<string, unknown>;
              await context.close();
              results.push({
                user: user.username,
                role,
                file: cache.save(user, state),
                status: 'captured (interactive)',
              });
              continue;
            }
            const strategy = defineAuth({ strategy: cfg.project.auth.strategy as any });
            const state = await strategy.login({ browser, config: cfg, user });
            if (!state) {
              results.push({
                user: user.username,
                role,
                status: `strategy "${cfg.project.auth.strategy}" produced no state`,
              });
              continue;
            }
            results.push({
              user: user.username,
              role,
              file: cache.save(user, state),
              status: 'captured',
            });
          }
        }
      } finally {
        await browser.close();
      }
      if (ctx.opts.json) return json(results);
      table(results);
      ok(`states under ${cache.dir}`);
    });

  auth
    .command('list')
    .description('Show cached login states and their age')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const cfg = ctx.registry.resolve(opts.project, opts.env);
      const rows = new AuthStateCache(cfg).list().map((s) => ({
        ...s,
        fresh: s.ageMinutes < cfg.project.auth.maxAgeMinutes ? 'yes' : 'no',
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
