export * from './driver.js';
export * from './create-db.js';
export * from './col.js';
export * from './ids.js';
export * from './schema.js';
export * from './migrate.js';
export * from './repos/index.js';
export * from './ingest/index.js';
export * from './switch/index.js';
export * from './insights.js';
export * from './test-data.js';
export * from './scopes.js';

import { createDb, type SdodsDb } from './create-db.js';
import { resolveDriverConfig, type DriverConfig } from './driver.js';
import { migrateToLatest } from './migrate.js';

/** Open + migrate in one call (what `sdods serve` and `sdods run --ingest` do on boot). */
export async function openDb(cfg: DriverConfig = resolveDriverConfig()): Promise<SdodsDb> {
  const adb = createDb(cfg);
  await migrateToLatest(adb);
  return adb;
}
