import type { Command } from 'commander';
import { createContext } from '../context.js';
import { info, ok, parseIntFlag } from '../ui.js';

export function register(program: Command) {
  program
    .command('serve')
    .description('Start the SDODS web server (REST API, SSE, web UI, MCP over HTTP, scheduler)')
    .option('--port <n>', 'port (default: PORT env or 4444)', parseIntFlag('port'))
    .option('--host <host>', 'bind address (default: HOST env or 127.0.0.1)')
    .option('--open', 'open the browser after start')
    .option('--no-scheduler', 'do not start the cron scheduler')
    .option('--auth-disabled', 'development only: every request is a local admin')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const { startServer } = await import('@sdods/server');
      const { app, url } = await startServer({
        config: {
          rootDir: ctx.rootDir,
          port: opts.port,
          host: opts.host,
          authDisabled: opts.authDisabled ? true : undefined,
        },
        scheduler: opts.scheduler !== false,
        open: Boolean(opts.open),
      });
      ok(`SDODS server listening on ${url}`);
      if (app.setupState.token)
        info(
          `First run: create the admin at ${url}/setup?token=${app.setupState.token} (or: sdods users create --admin --username <name> --password <pw>)`,
        );
      info('Press Ctrl+C to stop.');
      const stop = async () => {
        await app.close();
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      await new Promise(() => undefined);
    });
}
