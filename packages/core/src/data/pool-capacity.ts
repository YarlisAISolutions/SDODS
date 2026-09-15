import { cpus } from 'node:os';
import { relative } from 'node:path';
import type { BrowserName, Layer, UserPoolConfig } from '@sdods/contracts';
import type { ResolvedConfig } from '../config/resolve.js';
import { combineTagExpr, parseTagExpr, parseTagValue, scenarioSkipReason } from '../config/tags.js';
import { SdodsError } from '../errors.js';
import { parseFeatureFile } from '../lint/gherkin.js';
import { listFeatureFiles } from '../lint/index.js';
import { poolAccountsByEnv } from '../matrix/index.js';
import { effectiveWorkers, leaseWaitMs } from './user-pool.js';

/**
 * #153: an exclusive lease is held for a worker's whole life, so a role with fewer accounts than
 * the workers that reach its scenarios starves every other worker. Each one waits `waitMs` and
 * fails the scenario with USER_POOL_EXHAUSTED, once per scenario, 30s into it. Measured on a real
 * suite: 55 passed / 335 failed at --workers 4 with one `member` account. This decides that before
 * any spec is generated.
 *
 * It must never cry wolf, so every estimate below errs towards FEWER concurrent leases: a scenario
 * the tag gate would skip, a filter only approximated here, or a shard's share all count low.
 */

/** Playwright's `browserName` for an SDODS browser: what the runtime tag gate compares `@skip:` with. */
const ENGINE: Record<BrowserName, string> = {
  chromium: 'chromium',
  edge: 'chromium',
  firefox: 'firefox',
  webkit: 'webkit',
  'mobile-chrome': 'chromium',
  'mobile-safari': 'webkit',
};

export interface PoolDemandOptions {
  /** Selected layers; `recorded` has no Gherkin and takes no `@user:` lease. */
  layers: readonly Layer[];
  /** Selected browsers (each is its own run target for ui/hybrid). */
  browsers: readonly BrowserName[];
  /** `--tags`, already normalised. */
  tags?: string;
  /** The setup tier's tags: those scenarios run before the targets they gate, not beside them. */
  setupTags?: string;
  /** Feature flags the env declares (`env.vars.features`); undefined gates nothing. */
  flags?: readonly string[];
  quarantine?: 'run' | 'skip';
  fullyParallel: boolean;
  /** Keep a feature, given its path relative to the project root. */
  includeFeature?: (projectRelativePath: string) => boolean;
  /** Keep a scenario by name (`--scenario` / `--grep`, matched on the scenario name only). */
  includeScenario?: (name: string) => boolean;
  repeatEach?: number;
  shardTotal?: number;
}

/**
 * For each `@user:<role>`, how many units of work that lease it could run at once: one per
 * scenario per run target, or one per feature file per target where the file runs serially
 * (`fullyParallel: false`, `@mode:serial`, `@mode:default`).
 */
export function poolDemandByRole(
  project: { root: string },
  env: string,
  o: PoolDemandOptions,
): Map<string, number> {
  const setup = o.setupTags ? parseTagExpr(o.setupTags) : undefined;
  const layers = o.layers
    .filter((l) => l !== 'recorded')
    .map((layer) => ({ layer, expr: parseTagExpr(combineTagExpr(`@${layer}`, o.tags)) }));
  const units = new Map<string, Set<string>>();
  for (const file of listFeatureFiles(project.root)) {
    const rel = relative(project.root, file).replace(/\\/g, '/');
    if (o.includeFeature && !o.includeFeature(rel)) continue;
    const parsed = parseFeatureFile(file);
    for (const pickle of parsed.pickles) {
      const tags = pickle.tags.map((t) => t.name);
      const role = parseTagValue(tags, 'user');
      if (!role || setup?.evaluate(tags)) continue;
      if (o.includeScenario && !o.includeScenario(pickle.name)) continue;
      const serial =
        tags.includes('@mode:serial') ||
        tags.includes('@mode:default') ||
        (!o.fullyParallel && !tags.includes('@mode:parallel'));
      for (const { layer, expr } of layers) {
        if (!expr.evaluate(tags)) continue;
        const targets = layer === 'api' ? [undefined] : o.browsers;
        for (const browser of targets) {
          const gate = { env, flags: o.flags, quarantine: o.quarantine };
          // The runtime gate sees Playwright's engine name; lint accepts the SDODS name. Skipped
          // under either reading counts as skipped, which can only lower the estimate.
          if (
            scenarioSkipReason(tags, gate) ||
            (browser &&
              (scenarioSkipReason(tags, { ...gate, browser }) ||
                scenarioSkipReason(tags, { ...gate, browser: ENGINE[browser] })))
          )
            continue;
          const key = `${layer}|${browser ?? ''}|${rel}${serial ? '' : `|${pickle.id}`}`;
          let set = units.get(role);
          if (!set) units.set(role, (set = new Set()));
          set.add(key);
        }
      }
    }
  }
  const out = new Map<string, number>();
  for (const [role, set] of units) {
    let n = set.size * Math.max(1, o.repeatEach ?? 1);
    // A shard runs some share of the tests; the smallest guaranteed share is the honest estimate.
    if (o.shardTotal && o.shardTotal > 1) n = Math.floor(n / o.shardTotal);
    out.set(role, n);
  }
  return out;
}

export interface PoolShortfall {
  role: string;
  /** Accounts with this role after `env.users.poolSize`. */
  accounts: number;
  /** Scenarios (or serial files) with this role that the workers could run at once. */
  concurrent: number;
}

/**
 * Roles whose exclusive, worker-held leases cannot cover the workers that will ask for them.
 *
 * Empty whenever contention cannot starve a worker: `mode: shared` takes no lease,
 * `leaseScope: scenario` queues instead of starving, and a dataset that is not file-backed has no
 * count to compare. A role with no account at all is not a capacity problem — it fails at any
 * worker count, and the lease names the roles that do exist.
 */
export function checkPoolCapacity(opts: {
  pool: UserPoolConfig | undefined;
  accounts: ReadonlyMap<string, number> | undefined;
  demand: ReadonlyMap<string, number>;
  workers: number;
}): PoolShortfall[] {
  const { pool, accounts } = opts;
  if (!pool || pool.mode === 'shared' || pool.leaseScope === 'scenario' || !accounts) return [];
  const out: PoolShortfall[] = [];
  for (const [role, units] of opts.demand) {
    const have = accounts.get(role) ?? 0;
    const concurrent = Math.min(opts.workers, units);
    if (have > 0 && have < concurrent) out.push({ role, accounts: have, concurrent });
  }
  return out.sort((a, b) => a.role.localeCompare(b.role));
}

/** Accounts per role for the resolved env, after `env.users.poolSize`. Undefined if not file-backed. */
export function poolAccountsFor(config: ResolvedConfig): Map<string, number> | undefined {
  return poolAccountsByEnv(config.project, {
    envs: [config.env.name],
    poolSize: () => config.env.users.poolSize,
  })?.get(config.env.name);
}

/** How the worker count was arrived at, for messages. */
export function describeWorkers(workers: number | undefined): string {
  return workers !== undefined
    ? `${workers} worker(s)`
    : `${effectiveWorkers()} worker(s) (Playwright's default: half of ${cpus().length} cores)`;
}

export function poolTooSmallError(
  config: ResolvedConfig,
  shortfalls: readonly PoolShortfall[],
  runtimeWorkers: number | undefined,
): SdodsError {
  const pool = config.project.data.userPool;
  const lines = shortfalls.map(
    (s) =>
      `role "${s.role}" has ${s.accounts} account(s) but ${s.concurrent} of its scenarios can run at once`,
  );
  return new SdodsError(
    'USER_POOL_TOO_SMALL',
    `User pool too small for ${describeWorkers(runtimeWorkers)} in env ${config.env.name}: ${lines.join('; ')}. ` +
      `Leases are held per worker, so every worker past the account count would wait ` +
      `${pool ? Math.round(leaseWaitMs(pool) / 1000) : 30}s and fail each of those scenarios with USER_POOL_EXHAUSTED.`,
    {
      hint:
        `Any one of: set data.userPool.leaseScope: scenario to release an account when each ` +
        `scenario ends (scenarios then queue for it); add accounts with ` +
        `${shortfalls.map((s) => `role "${s.role}"`).join(', ')} to dataset "${pool?.dataset}"` +
        `${config.env.users.poolSize ? ` (env.users.poolSize ${config.env.users.poolSize} caps the dataset before roles are split)` : ''}; ` +
        `set data.userPool.mode: shared if these scenarios do not mutate user-scoped state; ` +
        `run with --workers ${Math.max(1, Math.min(...shortfalls.map((s) => s.accounts)))}; ` +
        `or pass --allow-pool-contention to run anyway.`,
      docsPath: '/docs/guides/test-data-and-user-pools',
      details: { env: config.env.name, shortfalls },
      exitCode: 2,
    },
  );
}
