import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createDb, migrateToLatest, resolveDriverConfig, type AutomaxDb } from '@automax/db';

export interface DbPluginOptions {
  adb?: AutomaxDb;
}

/** Decorates `fastify.adb` (opened + migrated). Closes it on shutdown unless it was injected. */
export default fp(async function dbPlugin(app: FastifyInstance, opts: DbPluginOptions) {
  const owned = !opts.adb;
  const adb = opts.adb ?? createDb(resolveDriverConfig());
  await migrateToLatest(adb);
  app.decorate('adb', adb);
  if (owned) app.addHook('onClose', async () => adb.close());
});
