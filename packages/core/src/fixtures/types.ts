import type { BrowserName, Layer } from '@automax/contracts';
import type { ProjectRegistry } from '../config/registry.js';
import type { HarMode, ResolvedConfig } from '../config/resolve.js';
import type { EnvConfig } from '@automax/contracts';
import type { AuthStrategy } from '../auth/index.js';
import type { ApiClient } from '../api/client.js';
import type { DataProvider, LeasedUser, UserPool } from '../data/types.js';
import type { HealHistory } from '../heal/history.js';
import type { Healer } from '../heal/healer.js';
import type { ScreenshotNarrator } from '../shots/narrator.js';
import type { ApiContext } from './api-context.js';
import type { AuthStateCache } from './auth.js';
import type { PageRegistry } from './pages.js';
import type { ScenarioMeta } from './scenario.js';

/** Opaque database handle (a Kysely instance when @automax/db is installed). */
export type DbHandle = { destroy?: () => Promise<void> } & Record<string, unknown>;

export interface AutomaxOption {
  project: string;
  layer: Layer;
  browser?: BrowserName;
}

export interface WorkerFixtures {
  automax: AutomaxOption;
  registry: ProjectRegistry;
  config: ResolvedConfig;
  env: EnvConfig;
  runDir: string;
  auth: AuthStrategy;
  userPool: UserPool;
  authCache: AuthStateCache;
  /** Kysely instance from @automax/db when env.db is configured; otherwise undefined. */
  db: DbHandle | undefined;
  healHistory: HealHistory;
  harMode: HarMode;
}

export interface TestFixtures {
  scenario: ScenarioMeta;
  apiContext: ApiContext;
  api: ApiClient;
  data: DataProvider;
  user: LeasedUser | undefined;
  pages: PageRegistry;
  shots: ScreenshotNarrator;
  heal: Healer;
  /** auto fixture: pushes identity annotations */
  $automaxAnnotations: void;
}
