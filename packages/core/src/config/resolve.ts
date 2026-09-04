import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import {
  EnvConfigSchema,
  ProjectConfigSchema,
  newRunId,
  type EnvConfig,
  type ProjectConfig,
} from '@sdods/contracts';
import { SdodsConfigError } from '../errors.js';
import {
  DEFAULT_ARTIFACTS_DIR,
  ENV_TO_CONFIG_PATH,
  FRAMEWORK_DEFAULTS,
  PROJECT_FILE,
} from './defaults.js';
import { loadDotEnvLayer } from './env-files.js';
import { assertNoSecretLiterals, interpolate } from './interpolate.js';
import {
  coerceEnvValue,
  deepMerge,
  getAtPath,
  setPath,
  type LayerName,
  type Provenance,
} from './merge.js';

export type HarMode = 'off' | 'update' | 'replay';

export interface RuntimeConfig {
  runId: string;
  envName: string;
  ci: boolean;
  headed: boolean;
  workers?: number;
  shard?: { current: number; total: number };
  retries: number;
  artifactsDir: string;
  runDir: string;
  harMode: HarMode;
  offline: boolean;
  updateSnapshots: boolean;
  repoRoot: string;
}

export interface CliOverrides {
  env?: string;
  headed?: boolean;
  workers?: number;
  shard?: string;
  retries?: number;
  runId?: string;
  artifactsDir?: string;
  harMode?: HarMode;
  offline?: boolean;
  updateSnapshots?: boolean;
  uiBaseUrl?: string;
  apiBaseUrl?: string;
  shotPolicy?: string;
  shotsOnlyOnFailure?: boolean;
  heal?: boolean;
}

export interface ResolvedConfig {
  project: ProjectConfig & { root: string };
  env: EnvConfig;
  runtime: RuntimeConfig;
  /** which layer produced each leaf (dotted path) */
  provenance: Record<string, LayerName>;
  /** env var names referenced by ${VAR} and the files that contributed values */
  sources: { dotenvFiles: string[] };
}

export interface ResolveOptions {
  rootDir: string;
  projectRoot: string;
  env?: string;
  cliOverrides?: CliOverrides;
  processEnv?: NodeJS.ProcessEnv;
}

export function readYamlFile<T = unknown>(file: string): T {
  try {
    return parseYaml(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    throw new SdodsConfigError(`Cannot parse YAML at ${file}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}

export function loadProjectFile(projectRoot: string): ProjectConfig {
  const file = join(projectRoot, PROJECT_FILE);
  if (!existsSync(file)) {
    throw new SdodsConfigError(`No ${PROJECT_FILE} in ${projectRoot}`, {
      code: 'CONFIG_NOT_FOUND',
      hint: 'Run `sdods project create <slug>` or `sdods analyze <app>` to create one.',
    });
  }
  const raw = readYamlFile<Record<string, unknown>>(file) ?? {};
  const merged = deepMerge(structuredClone(FRAMEWORK_DEFAULTS), raw);
  try {
    const parsed = ProjectConfigSchema.parse(merged);
    const dirSlug = basename(projectRoot);
    if (parsed.slug !== dirSlug) {
      throw new SdodsConfigError(
        `Project slug "${parsed.slug}" does not match its directory "${dirSlug}".`,
        {
          hint: `Rename the directory to ${parsed.slug} or set slug: ${dirSlug}.`,
        },
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof ZodError) throw zodToConfigError(e, file);
    throw e;
  }
}

export function loadEnvFile(projectRoot: string, envName: string): EnvConfig {
  const file = join(projectRoot, 'envs', `${envName}.yaml`);
  if (!existsSync(file)) {
    throw new SdodsConfigError(`Environment "${envName}" has no file at ${file}`, {
      code: 'ENV_NOT_FOUND',
      hint: `Run \`sdods env add ${envName} --project ${basename(projectRoot)} --ui-url ... --api-url ...\`.`,
    });
  }
  const raw = readYamlFile<Record<string, unknown>>(file) ?? {};
  try {
    return EnvConfigSchema.parse({ name: envName, ...raw });
  } catch (e) {
    if (e instanceof ZodError) throw zodToConfigError(e, file);
    throw e;
  }
}

export function zodToConfigError(e: ZodError, file: string): SdodsConfigError {
  const issues = e.issues
    .map((i) => `  • ${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('\n');
  return new SdodsConfigError(`Invalid configuration in ${file}:\n${issues}`, {
    details: { file, issues: e.issues },
  });
}

/**
 * Precedence (later wins): defaults → project yaml → envs/<env>.yaml → .env(.<env>) → process.env → CLI.
 * Synchronous on purpose: this runs inside playwright.config.ts.
 */
export function resolveConfig(opts: ResolveOptions): ResolvedConfig {
  const processEnv = opts.processEnv ?? process.env;
  const prov: Provenance = { byPath: new Map() };
  const cli = opts.cliOverrides ?? parseCliOverridesEnv(processEnv);

  // 1 + 2: defaults + project yaml (already merged & validated in loadProjectFile)
  const project = loadProjectFile(opts.projectRoot);
  markAll(project as unknown as Record<string, unknown>, prov, 'project', 'project');

  // 3: env selection + env yaml
  const envName = cli.env ?? opts.env ?? processEnv.SDODS_ENV ?? project.envs.default;
  if (!project.envs.available.includes(envName)) {
    throw new SdodsConfigError(
      `Environment "${envName}" is not in envs.available [${project.envs.available.join(', ')}] for project ${project.slug}.`,
      {
        code: 'ENV_NOT_FOUND',
        hint: `Add "${envName}" to envs.available in ${PROJECT_FILE} and create envs/${envName}.yaml.`,
      },
    );
  }
  const envYaml = loadEnvFile(opts.projectRoot, envName);
  markAll(envYaml as unknown as Record<string, unknown>, prov, 'envYaml', 'env');

  // env-level overrides of project sections
  let projectMerged: ProjectConfig = project;
  for (const section of ['screenshots', 'heal', 'timeouts', 'perf'] as const) {
    const patch = (envYaml as Record<string, unknown>)[section];
    if (patch) {
      projectMerged = {
        ...projectMerged,
        [section]: deepMerge(projectMerged[section], patch, prov, 'envYaml', `project.${section}`),
      };
    }
  }

  // 4: dotenv layer (values for ${VAR}); 5: process.env (also ${VAR} source, wins)
  const dotenv = loadDotEnvLayer(opts.rootDir, opts.projectRoot, envName);
  const vars: Record<string, string | undefined> = {
    ...dotenv.values,
    ...(processEnv as Record<string, string | undefined>),
  };

  const tree: {
    project: Record<string, unknown>;
    env: Record<string, unknown>;
    runtime: Record<string, unknown>;
  } = {
    project: projectMerged as unknown as Record<string, unknown>,
    env: envYaml as unknown as Record<string, unknown>,
    runtime: {
      runId: undefined,
      envName,
      ci: Boolean(processEnv.CI) || envYaml.ci === true,
      headed: false,
      workers: undefined,
      shard: undefined,
      retries: undefined,
      artifactsDir: DEFAULT_ARTIFACTS_DIR,
      harMode: undefined,
      offline: false,
      updateSnapshots: false,
      repoRoot: resolvePath(opts.rootDir),
    },
  };

  // 5b: SDODS_* → config paths
  for (const [envKey, dotted] of Object.entries(ENV_TO_CONFIG_PATH)) {
    const raw = processEnv[envKey];
    if (raw === undefined || raw === '') continue;
    setPath(
      tree as unknown as Record<string, unknown>,
      dotted,
      dotted === 'runtime.shard'
        ? parseShard(raw)
        : BOOLEAN_PATHS.has(dotted)
          ? coerceBool(raw)
          : coerceEnvValue(raw),
    );
    prov.byPath.set(dotted, 'processEnv');
  }

  // 6: CLI overrides (last)
  applyCli(tree, cli, prov);

  // 7: interpolate ${VAR} (skip env.vars values, which may hold {{templates}} but ${VAR} still resolves), refuse secret literals
  assertNoSecretLiterals(tree.env, 'env');
  const interpolated = interpolate(tree, { vars, onUnresolved: 'throw' });

  // runtime finalisation
  const rt = interpolated.runtime as unknown as RuntimeConfig & { retries?: number | undefined };
  rt.runId = rt.runId || newRunId();
  rt.retries = rt.retries ?? (rt.ci ? projectMerged.retries.ci : projectMerged.retries.local);
  rt.harMode = rt.harMode ?? 'off';
  rt.artifactsDir = resolvePath(opts.rootDir, rt.artifactsDir || DEFAULT_ARTIFACTS_DIR);
  rt.runDir = join(rt.artifactsDir, rt.runId);
  rt.headed = Boolean(rt.headed);
  rt.offline = Boolean(rt.offline);
  rt.updateSnapshots = Boolean(rt.updateSnapshots);

  // final validation (env may have been overridden by process/cli)
  const envFinal = EnvConfigSchema.parse(interpolated.env);
  const projectFinal = ProjectConfigSchema.parse(interpolated.project);

  return {
    project: { ...projectFinal, root: resolvePath(opts.projectRoot) },
    env: envFinal,
    runtime: rt as RuntimeConfig,
    provenance: Object.fromEntries(prov.byPath),
    sources: { dotenvFiles: dotenv.files },
  };
}

function markAll(obj: Record<string, unknown>, prov: Provenance, layer: LayerName, prefix: string) {
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>))
        walk(val, `${path}.${k}`);
    } else prov.byPath.set(path, layer);
  };
  walk(obj, prefix);
}

function applyCli(
  tree: {
    project: Record<string, unknown>;
    env: Record<string, unknown>;
    runtime: Record<string, unknown>;
  },
  cli: CliOverrides,
  prov: Provenance,
) {
  const set = (dotted: string, value: unknown) => {
    if (value === undefined) return;
    setPath(tree as unknown as Record<string, unknown>, dotted, value);
    prov.byPath.set(dotted, 'cli');
  };
  set('runtime.headed', cli.headed);
  set('runtime.workers', cli.workers);
  set('runtime.shard', cli.shard ? parseShard(cli.shard) : undefined);
  set('runtime.retries', cli.retries);
  set('runtime.runId', cli.runId);
  set('runtime.artifactsDir', cli.artifactsDir);
  set('runtime.harMode', cli.harMode);
  set('runtime.offline', cli.offline);
  set('runtime.updateSnapshots', cli.updateSnapshots);
  set('env.ui.baseUrl', cli.uiBaseUrl);
  set('env.api.baseUrl', cli.apiBaseUrl);
  set('project.screenshots.policy.default', cli.shotPolicy);
  set('project.screenshots.onlyOnFailure', cli.shotsOnlyOnFailure);
  set('project.heal.enabled', cli.heal);
}

/** Config paths that are booleans: `SDODS_X=1|true|yes|on` → true, `0|false|no|off` → false. */
const BOOLEAN_PATHS = new Set([
  'runtime.headed',
  'runtime.offline',
  'runtime.updateSnapshots',
  'project.screenshots.onlyOnFailure',
  'project.heal.enabled',
]);

export function coerceBool(raw: string): boolean {
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export function parseShard(raw: string): { current: number; total: number } {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(raw).trim());
  if (!m)
    throw new SdodsConfigError(`Invalid shard "${raw}", expected "<current>/<total>" like 1/3.`);
  return { current: Number(m[1]), total: Number(m[2]) };
}

export const CLI_OVERRIDES_ENV = 'SDODS_CLI_OVERRIDES';

export function parseCliOverridesEnv(env: NodeJS.ProcessEnv): CliOverrides {
  const raw = env[CLI_OVERRIDES_ENV];
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CliOverrides;
  } catch {
    return {};
  }
}

export function serializeCliOverrides(cli: CliOverrides): string {
  return JSON.stringify(Object.fromEntries(Object.entries(cli).filter(([, v]) => v !== undefined)));
}

/** Useful for `sdods config show`: winning layer per path, plus values. */
export function explainConfig(
  cfg: ResolvedConfig,
): Array<{ path: string; value: unknown; layer: LayerName }> {
  const rows: Array<{ path: string; value: unknown; layer: LayerName }> = [];
  const tree = { project: cfg.project, env: cfg.env, runtime: cfg.runtime };
  for (const [path, layer] of Object.entries(cfg.provenance)) {
    rows.push({ path, value: getAtPath(tree, path), layer });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
