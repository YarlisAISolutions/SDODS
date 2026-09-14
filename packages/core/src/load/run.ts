import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve as resolvePath } from 'node:path';
import { execa } from 'execa';
import { newRunId, type LoadProfile } from '@sdods/contracts';
import { SdodsConfigError, SdodsError } from '../errors.js';
import { DEFAULT_ARTIFACTS_DIR } from '../config/defaults.js';
import { loadDotEnvLayer } from '../config/env-files.js';
import { assertNoSecretLiterals, interpolateString } from '../config/interpolate.js';
import { loadEnvFile, loadProjectFile } from '../config/resolve.js';
import {
  assertLoadAllowed,
  baseUrlOverrideProblems,
  loadGuardProblems,
  peakVus,
  readLoadProfile,
} from './profile.js';
import { generateK6Script } from './script.js';

export const K6_INSTALL_URL = 'https://grafana.com/docs/k6/latest/set-up/install-k6/';
export const K6_DEFAULT_IMAGE = 'grafana/k6:latest';
/** k6 exits with 99 when one or more thresholds failed. */
export const K6_THRESHOLDS_FAILED = 99;

export type LoadRunner = 'auto' | 'k6' | 'docker';
export type LoadStdio = 'inherit' | 'pipe' | 'stderr';

/** Absolute path of an executable on `PATH`, or undefined. */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = join(dir, name + ext);
      try {
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        // keep looking
      }
    }
  }
  return undefined;
}

export function k6MissingError(runner: LoadRunner): SdodsError {
  if (runner === 'docker') {
    return new SdodsError('NOT_SUPPORTED', '`--runner docker` needs docker on PATH.', {
      hint: `Install Docker, or install k6 itself (${K6_INSTALL_URL}) and use --runner k6.`,
      docsPath: '/docs/guides/load-testing',
      exitCode: 2,
    });
  }
  return new SdodsError('NOT_SUPPORTED', 'k6 is not installed (no `k6` on PATH).', {
    hint:
      `Install k6: ${K6_INSTALL_URL} (macOS: brew install k6), or run it in Docker with ` +
      '`--runner docker`. `--dry-run` writes the script without k6.',
    docsPath: '/docs/guides/load-testing',
    exitCode: 2,
  });
}

/** sdods exit code for a k6 exit code: 0 passes, anything else (99 = thresholds) fails with 1. */
export function mapK6ExitCode(code: number): { exitCode: number; thresholdsFailed: boolean } {
  if (code === 0) return { exitCode: 0, thresholdsFailed: false };
  return { exitCode: 1, thresholdsFailed: code === K6_THRESHOLDS_FAILED };
}

export interface RunK6Options {
  outDir: string;
  scriptFile: string;
  summaryFile: string;
  runner?: LoadRunner;
  image?: string;
  /** Environment for the k6 process; k6 exposes it to the script as `__ENV`. */
  env: NodeJS.ProcessEnv;
  /** Names passed into the container with `-e NAME` (values stay out of the command line). */
  passEnv?: string[];
  /** `stderr` sends k6's output to stderr so stdout stays machine-readable (`--json`). */
  stdio?: LoadStdio;
}

export interface RunK6Result {
  runner: 'k6' | 'docker';
  command: string;
  k6ExitCode: number;
  stdout: string;
  stderr: string;
}

export async function runK6(opts: RunK6Options): Promise<RunK6Result> {
  const runner = opts.runner ?? 'auto';
  let file: string;
  let args: string[];
  let used: 'k6' | 'docker';
  const k6 = runner === 'docker' ? undefined : findExecutable('k6', opts.env);
  if (k6) {
    used = 'k6';
    file = k6;
    args = ['run', '--summary-export', opts.summaryFile, opts.scriptFile];
  } else if (runner === 'docker') {
    const docker = findExecutable('docker', opts.env);
    if (!docker) throw k6MissingError('docker');
    used = 'docker';
    file = docker;
    const mount = resolvePath(opts.outDir);
    args = [
      'run',
      '--rm',
      '-i',
      '-v',
      `${mount}:/sdods-load`,
      ...(opts.passEnv ?? []).flatMap((name) => ['-e', name]),
      opts.image ?? K6_DEFAULT_IMAGE,
      'run',
      '--summary-export',
      `/sdods-load/${relativeTo(mount, opts.summaryFile)}`,
      `/sdods-load/${relativeTo(mount, opts.scriptFile)}`,
    ];
  } else {
    throw k6MissingError(runner);
  }
  const res = await execa(file, args, {
    env: opts.env,
    extendEnv: false,
    reject: false,
    stdio: opts.stdio === 'stderr' ? ['ignore', 2, 2] : (opts.stdio ?? 'inherit'),
  });
  if (res.failed && typeof res.exitCode !== 'number') {
    throw new SdodsError('RUN_FAILED', `Could not start ${used}: ${res.message}`, {
      docsPath: '/docs/guides/load-testing',
    });
  }
  return {
    runner: used,
    command: [used, ...args].join(' '),
    k6ExitCode: res.exitCode ?? 1,
    stdout: typeof res.stdout === 'string' ? res.stdout : '',
    stderr: typeof res.stderr === 'string' ? res.stderr : '',
  };
}

function relativeTo(dir: string, file: string): string {
  const abs = resolvePath(file);
  if (!abs.startsWith(dir + '/') && !abs.startsWith(dir + '\\')) {
    throw new SdodsError('INTERNAL', `${abs} is not inside ${dir}; docker cannot mount it.`);
  }
  return abs.slice(dir.length + 1).replace(/\\/g, '/');
}

export interface LoadSummary {
  requests?: number;
  p95Ms?: number;
  failedRate?: number;
  checksRate?: number;
}

/** A few headline numbers from k6's `--summary-export` JSON; absent metrics stay undefined. */
export function readK6Summary(file: string): LoadSummary | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const metrics = (JSON.parse(readFileSync(file, 'utf8')) as { metrics?: Record<string, any> })
      .metrics;
    if (!metrics) return undefined;
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
    return {
      requests: num(metrics.http_reqs?.count),
      p95Ms: num(metrics.http_req_duration?.['p(95)']),
      failedRate: num(metrics.http_req_failed?.value ?? metrics.http_req_failed?.rate),
      checksRate: num(metrics.checks?.value ?? metrics.checks?.rate),
    };
  } catch {
    return undefined;
  }
}

export interface RunLoadOptions {
  rootDir: string;
  projectRoot: string;
  profile: string;
  env?: string;
  /** Where to write script.js, summary.json and load.json. Default `.sdods/runs/<id>/load/<profile>`. */
  outDir?: string;
  dryRun?: boolean;
  runner?: LoadRunner;
  image?: string;
  processEnv?: NodeJS.ProcessEnv;
  stdio?: LoadStdio;
  /** Progress lines (target, peak VUs, warnings), printed before k6 starts. */
  log?: (line: string) => void;
}

export interface LoadRunResult {
  project: string;
  env: string;
  profile: string;
  target: string;
  peakVus: number;
  outDir: string;
  scriptFile: string;
  summaryFile?: string;
  dryRun: boolean;
  /** Reasons a real run would be refused (reported by --dry-run; a real run throws instead). */
  guardProblems: string[];
  requiredEnv: string[];
  runner?: 'k6' | 'docker';
  k6ExitCode?: number;
  thresholdsFailed: boolean;
  summary?: LoadSummary;
  exitCode: number;
}

/**
 * Generate a k6 script for a load profile and run it against an environment that opted in.
 * The environment is read uninterpolated so `${VAR}` secrets become `__ENV` lookups; their values
 * reach k6 through its process environment only.
 */
export async function runLoad(opts: RunLoadOptions): Promise<LoadRunResult> {
  const processEnv = opts.processEnv ?? process.env;
  const log = opts.log ?? (() => {});
  const project = loadProjectFile(opts.projectRoot);
  const envName = opts.env ?? processEnv.SDODS_ENV ?? project.envs.default;
  if (!project.envs.available.includes(envName)) {
    throw new SdodsConfigError(
      `Environment "${envName}" is not in envs.available [${project.envs.available.join(', ')}] for project ${project.slug}.`,
      { code: 'ENV_NOT_FOUND' },
    );
  }
  const env = loadEnvFile(opts.projectRoot, envName);
  assertNoSecretLiterals(env, 'env');
  const profile: LoadProfile = readLoadProfile(opts.projectRoot, opts.profile);

  const vars: Record<string, string | undefined> = {
    ...loadDotEnvLayer(opts.rootDir, opts.projectRoot, envName).values,
    ...(processEnv as Record<string, string | undefined>),
  };
  const envBaseUrl = interpolateString(
    env.api.baseUrl,
    { vars, onUnresolved: 'throw' },
    'env.api.baseUrl',
  ).replace(/\/+$/, '');
  const override = processEnv.SDODS_API_BASE_URL || undefined;
  const overrideProblems = baseUrlOverrideProblems(env, envBaseUrl, override);
  const target = (override ?? envBaseUrl).trim().replace(/\/+$/, '');
  const peak = peakVus(profile);
  const guardProblems = [...loadGuardProblems(env, profile), ...overrideProblems];

  const { script, requiredEnv } = generateK6Script({
    project: project.slug,
    profileName: opts.profile,
    profile,
    env,
    baseUrl: target,
  });

  log(`target   ${target}`);
  log(`peak VUs ${peak}${profile.stages ? ` (stages)` : ''}`);
  if (opts.dryRun) {
    for (const p of guardProblems) log(`warning: a real run would be refused: ${p}`);
  } else {
    // Refuse before writing anything: a refused run leaves no run directory behind.
    assertLoadAllowed(env, profile, overrideProblems);
    const missing = requiredEnv.filter((name) => !vars[name]);
    if (missing.length) {
      throw new SdodsConfigError(
        `The load script reads ${missing.map((n) => `\${${n}}`).join(', ')} and ${missing.length === 1 ? 'it is' : 'they are'} not set.`,
        {
          code: 'CONFIG_UNRESOLVED_VAR',
          hint: `Add ${missing[0]}=... to .env.${envName} (repo root or project folder), or export it in the shell.`,
          details: { variables: missing },
        },
      );
    }
  }

  const outDir = resolvePath(
    opts.outDir ??
      join(
        opts.rootDir,
        processEnv.SDODS_ARTIFACTS_DIR || DEFAULT_ARTIFACTS_DIR,
        newRunId(),
        'load',
        opts.profile,
      ),
  );
  mkdirSync(outDir, { recursive: true });
  const scriptFile = join(outDir, 'script.js');
  const summaryFile = join(outDir, 'summary.json');
  writeFileSync(scriptFile, script);

  const result: LoadRunResult = {
    project: project.slug,
    env: envName,
    profile: opts.profile,
    target,
    peakVus: peak,
    outDir,
    scriptFile,
    dryRun: Boolean(opts.dryRun),
    guardProblems,
    requiredEnv,
    thresholdsFailed: false,
    exitCode: 0,
  };
  const writeMeta = () =>
    writeFileSync(
      join(outDir, 'load.json'),
      JSON.stringify({ ...result, finishedAt: new Date().toISOString() }, null, 2) + '\n',
    );
  if (opts.dryRun) {
    writeMeta();
    return result;
  }

  // Dotenv values reach k6 through its environment, never through the script or its arguments.
  // Every variable the script reads, including `${VAR:-default}` ones set in .env files.
  const referenced = [
    ...new Set([...script.matchAll(/__ENV\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!)),
  ]
    .filter((name) => vars[name] !== undefined)
    .sort();
  const k6Env: NodeJS.ProcessEnv = { ...processEnv };
  for (const name of referenced) k6Env[name] = vars[name];
  const run = await runK6({
    outDir,
    scriptFile,
    summaryFile,
    runner: opts.runner,
    image: opts.image,
    env: k6Env,
    passEnv: referenced,
    stdio: opts.stdio,
  });
  const mapped = mapK6ExitCode(run.k6ExitCode);
  Object.assign(result, {
    runner: run.runner,
    k6ExitCode: run.k6ExitCode,
    thresholdsFailed: mapped.thresholdsFailed,
    exitCode: mapped.exitCode,
    summaryFile: existsSync(summaryFile) ? summaryFile : undefined,
    summary: readK6Summary(summaryFile),
  });
  writeMeta();
  return result;
}
