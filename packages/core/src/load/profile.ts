import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import {
  LOAD_READ_METHODS,
  LoadProfileSchema,
  type EnvConfig,
  type LoadProfile,
} from '@sdods/contracts';
import { SdodsConfigError } from '../errors.js';
import { assertNoSecretLiterals } from '../config/interpolate.js';
import { readYamlFile, zodToConfigError } from '../config/resolve.js';

export const LOAD_DIR = 'load';
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Profile names under `projects/<slug>/load/`, without the extension. */
export function listLoadProfiles(projectRoot: string): string[] {
  const dir = join(projectRoot, LOAD_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => f.replace(/\.ya?ml$/, ''))
    .sort();
}

export function loadProfileFile(projectRoot: string, name: string): string | undefined {
  if (!PROFILE_NAME_RE.test(name)) return undefined;
  for (const ext of ['yaml', 'yml']) {
    const file = join(projectRoot, LOAD_DIR, `${name}.${ext}`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

export function parseLoadProfile(raw: unknown, file = '<profile>'): LoadProfile {
  assertNoSecretLiterals(raw, 'profile');
  try {
    return LoadProfileSchema.parse(raw ?? {});
  } catch (e) {
    if (e instanceof ZodError) throw zodToConfigError(e, file);
    throw e;
  }
}

export function readLoadProfile(projectRoot: string, name: string): LoadProfile {
  const file = loadProfileFile(projectRoot, name);
  if (!file) {
    const known = listLoadProfiles(projectRoot);
    throw new SdodsConfigError(`No load profile "${name}" in ${join(projectRoot, LOAD_DIR)}.`, {
      code: 'CONFIG_NOT_FOUND',
      hint: known.length
        ? `Known profiles: ${known.join(', ')}.`
        : `Create ${LOAD_DIR}/${name}.yaml in the project folder (see the load testing guide).`,
      docsPath: '/docs/guides/load-testing',
    });
  }
  return parseLoadProfile(readYamlFile(file), file);
}

/** The most virtual users the profile reaches: `vus`, or the highest stage target. */
export function peakVus(profile: LoadProfile): number {
  if (profile.stages) return Math.max(...profile.stages.map((s) => s.target));
  return profile.vus ?? 1;
}

/**
 * Why this environment may not take this profile. Empty means it may.
 * Checked before every real run; `--dry-run` only reports it.
 */
export function loadGuardProblems(env: EnvConfig, profile: LoadProfile): string[] {
  const problems: string[] = [];
  const load = env.load;
  if (!load?.allowed) {
    problems.push(
      `environment "${env.name}" has not opted in to load tests (envs/${env.name}.yaml has no \`load: { allowed: true }\`)`,
    );
  }
  const peak = peakVus(profile);
  if (load?.maxVus !== undefined && peak > load.maxVus) {
    problems.push(
      `profile peaks at ${peak} virtual users, above load.maxVus ${load.maxVus} for "${env.name}"`,
    );
  }
  const writes = profile.requests.filter(
    (r) => !(LOAD_READ_METHODS as readonly string[]).includes(r.method),
  );
  if (writes.length && !load?.allowWrites) {
    problems.push(
      `profile sends ${[...new Set(writes.map((r) => r.method))].join(', ')} requests and "${env.name}" does not set load.allowWrites: true`,
    );
  }
  return problems;
}

export function assertLoadAllowed(env: EnvConfig, profile: LoadProfile): void {
  const problems = loadGuardProblems(env, profile);
  if (!problems.length) return;
  throw new SdodsConfigError(`Refusing to run a load test: ${problems.join('; ')}.`, {
    hint:
      `Only opt in an environment you own and that is sized for load — never production. ` +
      `In envs/${env.name}.yaml: load: { allowed: true, maxVus: 50, allowWrites: false }. ` +
      '`--dry-run` writes the script without running it.',
    docsPath: '/docs/guides/load-testing',
    details: { problems },
  });
}
