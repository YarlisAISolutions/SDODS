export type Driver = 'sqlite' | 'postgres';

export interface DriverConfig {
  driver: Driver;
  sqlitePath?: string;
  databaseUrl?: string;
}

export const DEFAULT_SQLITE_PATH = '.sdods/sdods.db';

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
  return { driver: 'sqlite', sqlitePath: env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH };
}
