import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Driver = 'sqlite' | 'postgres';

export interface DriverConfig {
  driver: Driver;
  sqlitePath?: string;
  databaseUrl?: string;
}

export const DEFAULT_SQLITE_PATH = '.sdods/sdods.db';

// Mirrors the markers ProjectRegistry.findRepoRoot looks for. Duplicated rather than imported
// because @sdods/db must not depend on @sdods/core (core already depends on db).
const WORKSPACE_MARKERS = ['sdods.workspace.yaml', 'sdods.config.ts', 'sdods.config.json'];

/**
 * Nearest ancestor of `start` that looks like an SDODS workspace, or null.
 *
 * The default sqlite path is relative, and resolving it against the current directory meant every
 * command opened a *different* database depending on where it was run from. `sdods serve` started
 * inside a run's artifacts folder would silently create an empty database there and then reject
 * every login, because the users live in the workspace database one or four levels up.
 */
export function findWorkspaceRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    if (WORKSPACE_MARKERS.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve the platform database driver from the environment (`DB_DRIVER`, `SQLITE_PATH`, `DATABASE_URL`). */
export function resolveDriverConfig(env: NodeJS.ProcessEnv = process.env): DriverConfig {
  const driver = (env.DB_DRIVER ?? 'sqlite').toLowerCase();
  if (driver === 'postgres' || driver === 'postgresql' || driver === 'pg') {
    if (!env.DATABASE_URL) {
      throw new Error(
        'DB_DRIVER=postgres requires DATABASE_URL (e.g. postgres://sdods:sdods@localhost:5432/sdods)',
      );
    }
    return { driver: 'postgres', databaseUrl: env.DATABASE_URL };
  }
  if (driver !== 'sqlite') {
    throw new Error(`Unknown DB_DRIVER "${env.DB_DRIVER}". Use sqlite or postgres.`);
  }
  // An explicit SQLITE_PATH is taken at face value: the caller said where they want it. Only the
  // default is anchored to the workspace, so `sdods serve` and `sdods users` agree on one database
  // no matter which subdirectory they run from.
  if (env.SQLITE_PATH) return { driver: 'sqlite', sqlitePath: env.SQLITE_PATH };
  const root = findWorkspaceRoot();
  return {
    driver: 'sqlite',
    sqlitePath: root ? join(root, DEFAULT_SQLITE_PATH) : DEFAULT_SQLITE_PATH,
  };
}
