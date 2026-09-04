import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, resolve as resolvePath } from 'node:path';
import type { DataSource } from '@sdods/contracts';
import { SdodsError } from '../errors.js';

/**
 * Resolve a file-backed data source for an environment:
 *   1. spec.path with {env} substituted
 *   2. data/<env>/<basename>
 *   3. spec.fallback
 *   4. data/common/<basename>
 */
export function resolveDataPath(
  projectRoot: string,
  spec: Extract<DataSource, { path: string }>,
  envName: string,
): string {
  const primary = spec.path.replace(/\{env\}/g, envName);
  const base = basename(primary);
  const candidates = [
    primary,
    join('data', envName, base),
    spec.fallback,
    join('data', 'common', base),
  ]
    .filter((c): c is string => Boolean(c))
    .map((c) => (isAbsolute(c) ? c : resolvePath(projectRoot, c)));
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new SdodsError(
      'DATASET_NOT_FOUND',
      `No data file for "${spec.path}" in env "${envName}".`,
      {
        hint: `Tried: ${[...new Set(candidates)].join(', ')}`,
        details: { candidates },
      },
    );
  }
  return found;
}
