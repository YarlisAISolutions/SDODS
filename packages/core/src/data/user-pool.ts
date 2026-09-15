import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import type { UserPoolConfig } from '@sdods/contracts';
import type { ResolvedConfig } from '../config/resolve.js';
import { SdodsError } from '../errors.js';
import { Logger } from '../logger.js';
import type { DataProvider, LeaseStore, LeasedUser, Row, UserPool } from './types.js';

/** O_EXCL lock files with TTL; safe across workers on one machine. */
export class FileLeaseStore implements LeaseStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(userId: string) {
    return join(this.dir, `${userId}.lock`);
  }

  async tryAcquire(userId: string, owner: string, ttlMs: number): Promise<boolean> {
    const file = this.file(userId);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(file, 'wx');
        writeSync(fd, JSON.stringify({ owner, leasedAt: Date.now() }));
        closeSync(fd);
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          const raw = JSON.parse(readFileSync(file, 'utf8')) as { owner: string; leasedAt: number };
          if (raw.owner === owner) return true; // re-entrant for the same owner
          if (Date.now() - raw.leasedAt > ttlMs) {
            unlinkSync(file); // stale lease from a crashed worker
            continue;
          }
        } catch {
          try {
            unlinkSync(file);
          } catch {
            /* ignore */
          }
          continue;
        }
        return false;
      }
    }
    return false;
  }

  async release(userId: string, owner: string): Promise<void> {
    const file = this.file(userId);
    if (!existsSync(file)) return;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { owner: string };
      if (raw.owner === owner) unlinkSync(file);
    } catch {
      unlinkSync(file);
    }
  }

  async releaseAll(owner: string): Promise<void> {
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.lock')) continue;
      await this.release(f.replace(/\.lock$/, ''), owner);
    }
  }

  async owners(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.lock')) continue;
      try {
        out[f.replace(/\.lock$/, '')] = (
          JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as { owner: string }
        ).owner;
      } catch {
        /* ignore */
      }
    }
    return out;
  }
}

export interface UserPoolOptions {
  owner: string;
  store?: LeaseStore;
  waitMs?: number;
  /** Where waiters take their place in line. Default: `.queue` beside the lease files. */
  queueDir?: string;
}

/** `data.userPool.waitMs` when unset and leases are held per worker. */
export const DEFAULT_LEASE_WAIT_MS = 30_000;
const POLL_MS = 500;
/** A waiter refreshes its ticket every poll; one untouched this long belongs to a waiter that is gone. */
const TICKET_STALE_MS = 10_000;

/**
 * The worker count Playwright will actually use: `--workers` / `SDODS_WORKERS` when set (both land
 * in `runtime.workers`), else Playwright's own default of half the logical cores.
 *
 * Every browser and layer of one `sdods run` shares this pool: the CLI starts ONE `playwright test`
 * with a `--project` per run target, and Playwright's `workers` caps the whole invocation.
 */
export function effectiveWorkers(workers?: number): number {
  return workers ?? Math.max(1, Math.floor(cpus().length / 2));
}

/** How long a lease request waits for a free account (see `data.userPool.waitMs`). */
export function leaseWaitMs(
  pool: Pick<UserPoolConfig, 'waitMs' | 'leaseScope' | 'leaseTtlMs'>,
): number {
  if (pool.waitMs !== undefined) return pool.waitMs;
  return pool.leaseScope === 'scenario' ? pool.leaseTtlMs : DEFAULT_LEASE_WAIT_MS;
}

/**
 * With `leaseScope: scenario`, waiting for an account is how one account serialises the scenarios
 * that need it, so the wait must not count against the scenario's own timeout: a scenario third in
 * line would otherwise fail having done nothing. The timeout is raised by the longest possible wait
 * before leasing, then settled to what was actually waited.
 */
export function scenarioLeaseClock(
  pool: UserPoolConfig | undefined,
  testInfo: { timeout: number; setTimeout(ms: number): void },
): { settle(): void } {
  const base = testInfo.timeout;
  if (pool?.leaseScope !== 'scenario' || pool.mode === 'shared' || base <= 0) {
    return { settle: () => undefined };
  }
  const started = Date.now();
  testInfo.setTimeout(base + leaseWaitMs(pool));
  return { settle: () => testInfo.setTimeout(base + (Date.now() - started)) };
}

/**
 * Pool of accounts from the configured dataset, partitioned by role and capped by env.users.poolSize.
 * Leases are keyed by owner (`runId:shardOffset+parallelIndex`) and released on worker teardown, or
 * at scenario teardown with `leaseScope: scenario`.
 */
export class FileUserPool implements UserPool {
  private readonly log = new Logger('pool');
  private readonly leased = new Map<string, LeasedUser>(); // by role
  private rows?: Promise<Row[]>;
  private storeInstance?: LeaseStore;
  private readonly leaseDir: string;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly data: DataProvider,
    private readonly opts: UserPoolOptions,
  ) {
    this.leaseDir = join(
      config.runtime.artifactsDir,
      '..',
      'leases',
      config.project.slug,
      config.env.name,
    );
    this.storeInstance = opts.store;
  }

  /**
   * Created on first use. Every scenario depends on the pool (the scenario-scope release fixture is
   * automatic), and a project that never leases must not grow a lease directory for it.
   */
  private get store(): LeaseStore {
    return (this.storeInstance ??= new FileLeaseStore(this.leaseDir));
  }

  static ownerFor(config: ResolvedConfig, parallelIndex: number): string {
    const shard = config.runtime.shard;
    // Shards each number their workers from 0, so the offset must span a whole shard's workers.
    // It used `workers ?? 1`, which let shard 2's worker 0 share an owner with shard 1's worker 1
    // whenever --workers was left to Playwright's default.
    const offset = shard ? (shard.current - 1) * effectiveWorkers(config.runtime.workers) : 0;
    return `${config.runtime.runId}:${offset + parallelIndex}`;
  }

  private async users(): Promise<Row[]> {
    if (!this.rows) {
      const pool = this.config.project.data.userPool;
      if (!pool) {
        throw new SdodsError(
          'CONFIG_INVALID',
          `Project ${this.config.project.slug} has no data.userPool configured.`,
          {
            hint: 'Add data.userPool: { dataset: users, roleColumn: role } to sdods.project.yaml.',
          },
        );
      }
      this.rows = this.data.load(pool.dataset).then((rows) => {
        const size = this.config.env.users.poolSize;
        return size ? rows.slice(0, size) : rows;
      });
    }
    return this.rows;
  }

  async lease(role: string, _parallelIndex: number): Promise<LeasedUser> {
    const existing = this.leased.get(role);
    if (existing) return existing;
    const pool = this.config.project.data.userPool!;
    const rows = await this.users();
    // `index` is the position WITHIN the role, matching `sdods auth capture --index` and the
    // storage-state file name `<role>-<index>.json`.
    const candidates = rows
      .filter((r) => String(r[pool.roleColumn] ?? 'standard') === role)
      .map((r, index) => ({ r, index }));
    if (!candidates.length) {
      throw new SdodsError(
        'USER_POOL_EXHAUSTED',
        `No users with role "${role}" in dataset "${pool.dataset}" (env ${this.config.env.name}).`,
        {
          hint: `Roles present: ${[...new Set(rows.map((r) => String(r[pool.roleColumn])))].join(', ')}.`,
        },
      );
    }
    // A shared pool hands out an account without acquiring a lease at all.
    // Deterministic by worker index, so two workers on the same role get
    // different accounts when the pool has them and the same one when it does
    // not — which is the point: sharing is what makes a single-account role
    // usable by a parallel read-only suite.
    if (pool.mode === 'shared') {
      const picked = candidates[_parallelIndex % candidates.length]!;
      const id = String(picked.r.id ?? picked.r.username ?? picked.index);
      const user: LeasedUser = {
        id,
        username: String(picked.r.username ?? id),
        password: String(picked.r.password ?? ''),
        role,
        index: picked.index,
        extra: picked.r,
        leaseKey: '',
        owner: this.opts.owner,
      };
      this.leased.set(role, user);
      this.log.debug(`shared ${user.username} (${role}) for ${this.opts.owner}`);
      return user;
    }

    const ttl = pool.leaseTtlMs;
    const waitMs = this.opts.waitMs ?? leaseWaitMs(pool);
    const started = Date.now();
    const ticket = this.queueTicket(role, started);
    try {
      while (true) {
        // First come, first served. Without a queue the worker that just released an account won
        // it straight back: its next scenario asks within milliseconds while every waiter polls
        // every 500ms, so under `leaseScope: scenario` the same waiters lost round after round and
        // failed on the timeout while the account changed hands the whole time.
        if (ticket.ahead() < candidates.length) {
          for (const { r, index } of candidates) {
            const id = String(r.id ?? r.username ?? index);
            if (await this.store.tryAcquire(id, this.opts.owner, ttl)) {
              const user: LeasedUser = {
                id,
                username: String(r.username ?? id),
                password: String(r.password ?? ''),
                role,
                index,
                extra: r,
                leaseKey: id,
                owner: this.opts.owner,
              };
              this.leased.set(role, user);
              this.log.debug(`leased ${user.username} (${role}) for ${this.opts.owner}`);
              return user;
            }
          }
        }
        if (Date.now() - started > waitMs) {
          const owners = await this.store.owners();
          throw new SdodsError(
            'USER_POOL_EXHAUSTED',
            `All ${candidates.length} user(s) with role "${role}" are leased.`,
            {
              hint:
                `Owners: ${JSON.stringify(owners)}. Waited ${Math.round(waitMs / 1000)}s. ` +
                `Four ways out, in the order worth trying: (1) if these scenarios do not ` +
                `mutate user-scoped state, set data.userPool.mode: shared — one account ` +
                `then serves every worker, which is what a read-only suite needs; ` +
                `(2) add more accounts with role "${role}" to dataset "${pool.dataset}"; ` +
                `(3) set data.userPool.leaseScope: scenario, so an account is released when ` +
                `each scenario ends rather than when its worker exits, or raise ` +
                `data.userPool.waitMs (currently ${waitMs}ms); (4) lower --workers. ` +
                `Note env.users.poolSize slices the dataset BEFORE role filtering, so a ` +
                `small value can starve a role on its own.`,
            },
          );
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        ticket.touch();
      }
    } finally {
      ticket.drop();
    }
  }

  /**
   * A place in line for `role`: an empty file named by arrival time and owner, refreshed while its
   * waiter polls. `ahead()` counts live tickets that arrived earlier, and a waiter only tries to
   * acquire while fewer are ahead of it than the role has accounts. A ticket nobody refreshes (its
   * worker crashed) goes stale and stops holding the line.
   */
  private queueTicket(role: string, arrivedAt: number) {
    const dir = join(this.opts.queueDir ?? join(this.leaseDir, '.queue'), encodeURIComponent(role));
    const name = `${String(arrivedAt).padStart(15, '0')}-${encodeURIComponent(this.opts.owner)}`;
    const file = join(dir, name);
    const write = () => {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, '');
      } catch {
        /* a queue that cannot be written degrades to unordered polling */
      }
    };
    write();
    return {
      ahead: (): number => {
        let names: string[];
        try {
          names = readdirSync(dir);
        } catch {
          return 0;
        }
        let ahead = 0;
        for (const other of names) {
          if (other >= name) continue;
          try {
            if (Date.now() - statSync(join(dir, other)).mtimeMs > TICKET_STALE_MS) {
              unlinkSync(join(dir, other));
              continue;
            }
          } catch {
            continue; // dropped by its owner between readdir and stat
          }
          ahead++;
        }
        return ahead;
      },
      touch: () => {
        try {
          const now = new Date();
          utimesSync(file, now, now);
        } catch {
          write(); // removed as stale while this worker was blocked: back in, same place
        }
      },
      drop: () => {
        try {
          unlinkSync(file);
        } catch {
          /* already gone */
        }
      },
    };
  }

  async release(user: LeasedUser) {
    // A shared user holds no lease (leaseKey is empty). Releasing it would be at
    // best a no-op and at worst a release of another worker's row.
    if (user.leaseKey) await this.store.release(user.leaseKey, this.opts.owner);
    this.leased.delete(user.role);
  }

  async releaseAll() {
    // A store that was never created holds nothing to release.
    if (this.storeInstance) await this.storeInstance.releaseAll(this.opts.owner);
    this.leased.clear();
  }

  async status() {
    const rows = await this.users();
    const owners = await this.store.owners();
    const pool = this.config.project.data.userPool!;
    return rows.map((r, index) => {
      const id = String(r.id ?? r.username ?? index);
      return {
        id,
        username: String(r.username ?? id),
        role: String(r[pool.roleColumn] ?? 'standard'),
        owner: owners[id],
      };
    });
  }
}

export function leaseDirMtime(dir: string): number | undefined {
  return existsSync(dir) ? statSync(dir).mtimeMs : undefined;
}
