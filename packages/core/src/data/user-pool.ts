import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
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
}

/**
 * Pool of accounts from the configured dataset, partitioned by role and capped by env.users.poolSize.
 * Leases are keyed by owner (`runId:shardOffset+parallelIndex`) and released on worker teardown.
 */
export class FileUserPool implements UserPool {
  private readonly log = new Logger('pool');
  private readonly leased = new Map<string, LeasedUser>(); // by role
  private rows?: Promise<Row[]>;
  private readonly store: LeaseStore;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly data: DataProvider,
    private readonly opts: UserPoolOptions,
  ) {
    this.store =
      opts.store ??
      new FileLeaseStore(
        join(config.runtime.artifactsDir, '..', 'leases', config.project.slug, config.env.name),
      );
  }

  static ownerFor(config: ResolvedConfig, parallelIndex: number): string {
    const shard = config.runtime.shard;
    const offset = shard ? (shard.current - 1) * (config.runtime.workers ?? 1) : 0;
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
    const waitMs = this.opts.waitMs ?? pool.waitMs;
    const started = Date.now();
    while (true) {
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
              `(3) raise data.userPool.waitMs (currently ${waitMs}ms); (4) lower --workers. ` +
              `Note env.users.poolSize slices the dataset BEFORE role filtering, so a ` +
              `small value can starve a role on its own.`,
          },
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async release(user: LeasedUser) {
    // A shared user holds no lease (leaseKey is empty). Releasing it would be at
    // best a no-op and at worst a release of another worker's row.
    if (user.leaseKey) await this.store.release(user.leaseKey, this.opts.owner);
    this.leased.delete(user.role);
  }

  async releaseAll() {
    await this.store.releaseAll(this.opts.owner);
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
