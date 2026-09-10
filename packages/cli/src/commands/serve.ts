import type { Command } from 'commander';
import { SdodsError } from '@sdods/core';
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
      let started;
      try {
        started = await startServer({
          config: {
            rootDir: ctx.rootDir,
            port: opts.port,
            host: opts.host,
            authDisabled: opts.authDisabled ? true : undefined,
          },
          scheduler: opts.scheduler !== false,
          open: Boolean(opts.open),
        });
      } catch (err) {
        // A failed listen used to leave the process alive: the scheduler had already started, so
        // the event loop never drained and the terminal hung after printing the error. Say what to
        // do about the common cause, and exit rather than waiting for Ctrl+C.
        const e = err as NodeJS.ErrnoException;
        if (e?.code === 'EADDRINUSE') {
          const port = opts.port ?? Number(process.env.PORT ?? 4444);
          throw new SdodsError('CONFIG_INVALID', `Port ${port} is already in use.`, {
            hint:
              `Start on another port: sdods serve --port ${port + 1}\n` +
              `Or find what holds it: lsof -i :${port}  (Windows: netstat -ano | findstr :${port})`,
            cause: err,
          });
        }
        throw err;
      }
      const { app, url } = started;
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
