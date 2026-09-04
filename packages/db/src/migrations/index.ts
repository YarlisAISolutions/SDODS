import type { AutomaxMigration } from '../migrate.js';
import * as m0001 from './0001_platform_init.js';
import * as m0002 from './0002_results.js';
import * as m0003 from './0003_improvement.js';
import * as m0004 from './0004_test_data.js';
import * as m0005 from './0005_integrations_agents_audit.js';
import * as m0006 from './0006_schedules.js';
import * as m0007 from './0007_hierarchy.js';

/**
 * Static registry (bundler-friendly, no runtime file discovery). Order matters: Kysely sorts by key.
 */
export const MIGRATIONS: Record<string, AutomaxMigration> = {
  '0001_platform_init': m0001,
  '0002_results': m0002,
  '0003_improvement': m0003,
  '0004_test_data': m0004,
  '0005_integrations_agents_audit': m0005,
  '0006_schedules': m0006,
  '0007_hierarchy': m0007,
};
