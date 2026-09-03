import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';

/**
 * Load `.env` then `.env.<env>` from the repo root and the project root (project wins),
 * WITHOUT mutating process.env (dotenv.config would silently outrank the process layer).
 */
export function loadDotEnvLayer(
  repoRoot: string,
  projectRoot: string | undefined,
  envName: string,
): { values: Record<string, string>; files: string[] } {
  const roots = projectRoot && projectRoot !== repoRoot ? [repoRoot, projectRoot] : [repoRoot];
  const names = ['.env', `.env.${envName}`, '.env.local', `.env.${envName}.local`];
  const values: Record<string, string> = {};
  const files: string[] = [];
  for (const root of roots) {
    for (const name of names) {
      const file = join(root, name);
      if (!existsSync(file)) continue;
      const parsed = parseDotenv(readFileSync(file, 'utf8'));
      Object.assign(values, parsed);
      files.push(file);
    }
  }
  return { values, files };
}
