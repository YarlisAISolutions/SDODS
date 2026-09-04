import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { countUsers, type SdodsDb } from '@sdods/db';
import { ProjectRegistry } from '@sdods/core/config';
import { loadServerConfig, type ServerConfig } from './config.js';
import { errorHandler } from './errors.js';
import dbPlugin from './plugins/db.js';
import authPlugin from './plugins/auth.js';
import ssePlugin from './plugins/sse.js';
import staticPlugin from './plugins/static.js';
import mcpPlugin from './plugins/mcp.js';
import { RunManager, type RunnerHooks } from './services/run-manager.js';
import { Scheduler } from './services/scheduler.js';
import { AgentManager } from './services/agent-manager.js';
import { HierarchyService } from './services/hierarchy.js';
import { miscRoutes } from './routes/misc.js';
import { authRoutes } from './routes/auth.js';
import { hierarchyRoutes } from './routes/hierarchy.js';
import { projectRoutes } from './routes/projects.js';
import { runRoutes } from './routes/runs.js';
import { scheduleRoutes } from './routes/schedules.js';
import { agentRoutes } from './routes/agents.js';
import './types.js';

export interface BuildServerOptions {
  config?: Partial<ServerConfig>;
  adb?: SdodsDb;
  runner?: RunnerHooks;
  logger?: boolean | object;
  /** skip scheduler start (tests) */
  scheduler?: boolean;
  /** skip static + mcp plugins (tests) */
  minimal?: boolean;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = loadServerConfig(opts.config ?? {});
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.SDODS_LOG_LEVEL === 'debug' ? 'debug' : 'info' },
    trustProxy: true,
    bodyLimit: config.ingestMaxMb * 1024 * 1024,
  });
  app.decorate('config', config);
  app.setErrorHandler(errorHandler);

  await app.register(dbPlugin, { adb: opts.adb });

  let registry = ProjectRegistry.discover(config.rootDir, { projectsDir: config.projectsDir });
  app.decorate('registry', registry);
  app.decorate('reloadRegistry', () => {
    registry = ProjectRegistry.discover(config.rootDir, { projectsDir: config.projectsDir });
    (app as { registry: ProjectRegistry }).registry = registry;
    return registry;
  });

  const hierarchy = new HierarchyService(app.adb);
  app.decorate('hierarchy', hierarchy);
  const runManager = new RunManager(config, app.adb, opts.runner);
  app.decorate('runManager', runManager);
  const scheduler = new Scheduler(app.adb, runManager, app.log);
  app.decorate('scheduler', scheduler);
  app.decorate('agentManager', new AgentManager(config));
  app.decorate('setupState', { token: null as string | null });

  await app.register(authPlugin);
  await app.register(ssePlugin);
  if (!opts.minimal) {
    await app.register(mcpPlugin);
    await app.register(staticPlugin);
  }

  await app.register(miscRoutes);
  await app.register(authRoutes);
  await app.register(hierarchyRoutes);
  await app.register(projectRoutes);
  await app.register(runRoutes);
  await app.register(scheduleRoutes);
  await app.register(agentRoutes);

  app.addHook('onReady', async () => {
    try {
      await hierarchy.sync(registry);
      await scheduler.syncFromRegistry(registry);
    } catch (e) {
      app.log.warn(`hierarchy sync failed: ${(e as Error).message}`);
    }
    const orphans = await runManager.markOrphans().catch(() => 0);
    if (orphans) app.log.warn(`${orphans} run(s) marked as error after restart`);
    if (!config.authDisabled && (await countUsers(app.adb.db)) === 0) {
      app.setupState.token = randomBytes(16).toString('hex');
    }
    if (opts.scheduler !== false) await scheduler.start();
  });
  app.addHook('onClose', async () => scheduler.stop());
  return app;
}

export async function startServer(
  opts: BuildServerOptions & { open?: boolean } = {},
): Promise<{ app: FastifyInstance; url: string }> {
  const app = await buildServer(opts);
  const { host, port } = app.config;
  await app.listen({ host, port });
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  const lines = [`SDODS server listening on ${url}`];
  if (app.setupState.token)
    lines.push(
      `No users yet. Create the first admin at ${url}/setup?token=${app.setupState.token}`,
      `  or: sdods users create --admin --username <name> --password <pw>`,
    );
  if (app.config.authDisabled)
    lines.push('AUTH_DISABLED=1: every request is a local admin (development only).');
  for (const l of lines) app.log.info(l);
  if (opts.open) {
    const { exec } = await import('node:child_process');
    exec(
      `${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'} ${url}`,
    );
  }
  return { app, url };
}

export { loadServerConfig } from './config.js';
export type { ServerConfig } from './config.js';
export { RunManager } from './services/run-manager.js';
export { Scheduler, nextTimes } from './services/scheduler.js';
export { HierarchyService } from './services/hierarchy.js';
export { hashPassword } from './routes/auth.js';
export * as schemas from './schemas/index.js';
