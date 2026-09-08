import type { ProjectConfig } from '@sdods/contracts';

export const LAYER_TAGS = ['@ui', '@api', '@hybrid'] as const;
/** Control tags the runner interprets itself; lint passes them through untouched. */
export const RUNNER_SPECIAL_TAGS =
  /^@(only|skip|fixme|fail|slow|timeout:\d+|retries:\d+|mode:(parallel|serial|default))$/;
/** @deprecated Use {@link RUNNER_SPECIAL_TAGS}. Removed in the next minor. */
export const PLAYWRIGHT_BDD_SPECIAL = RUNNER_SPECIAL_TAGS;
export const VALUE_TAG = /^@([a-z][a-z0-9-]*):(.+)$/;
export const KNOWN_VALUE_TAGS = [
  'env',
  'user',
  'data',
  'har',
  'jira',
  'github',
  'skip',
  'title',
  'flag',
] as const;
export const BROWSERS_FOR_SKIP = [
  'chromium',
  'firefox',
  'webkit',
  'mobile-chrome',
  'mobile-safari',
] as const;

export interface TagTaxonomy {
  layers: readonly string[];
  suites: string[];
  extra: string[];
  roles: string[];
  envs: string[];
  datasets: string[];
}

export function taxonomyFromProject(project: ProjectConfig): TagTaxonomy {
  return {
    layers: LAYER_TAGS,
    suites: project.tags.suites.map((s) => `@${s}`),
    extra: project.tags.extra.map((s) => `@${s}`),
    roles: project.tags.roles,
    envs: project.envs.available,
    datasets: Object.keys(project.data.sources),
  };
}

export function parseTagValue(tags: readonly string[], name: string): string | undefined {
  const prefix = `@${name}:`;
  const found = tags.find((t) => t.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

export function parseTagValues(tags: readonly string[], name: string): string[] {
  const prefix = `@${name}:`;
  return tags.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
}

export function layerOfTags(tags: readonly string[]): 'ui' | 'api' | 'hybrid' | undefined {
  if (tags.includes('@ui')) return 'ui';
  if (tags.includes('@api')) return 'api';
  if (tags.includes('@hybrid')) return 'hybrid';
  return undefined;
}

export function suiteOfTags(
  tags: readonly string[],
  suites: readonly string[],
): string | undefined {
  return tags.find((t) => suites.includes(t));
}

/** Combine the layer restriction with a user expression: "(@ui) and (<expr>)". */
export function combineTagExpr(layerTag: string, userExpr?: string): string {
  const base = layerTag === '@hybrid' ? '@hybrid' : layerTag;
  if (!userExpr || !userExpr.trim()) return base;
  return `(${base}) and (${userExpr.trim()})`;
}

/** `--tags @smoke` shorthand also accepts comma lists ("@smoke,@sanity" → "@smoke or @sanity"). */
export function normalizeTagExpr(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/\b(and|or|not)\b|\(/.test(trimmed)) return trimmed;
  const parts = trimmed
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((t) => (t.startsWith('@') ? t : `@${t}`));
  return parts.length > 1 ? parts.join(' or ') : parts[0];
}

// ── runtime tag gate ─────────────────────────────────────────────────────────

export interface TagGateContext {
  /** `config.env.name` — the environment this run is actually pointed at. */
  env: string;
  /** Browser of the current Playwright project, when there is one. */
  browser?: string;
  /**
   * Feature flags baked into the environment under test. Undefined means "not
   * known", which is treated as "do not gate" — an unknown flag list must not
   * silently skip a suite.
   */
  flags?: readonly string[];
  /** Whether `@quarantine` scenarios run. Defaults to skipping them. */
  quarantine?: 'run' | 'skip';
}

/**
 * Why this scenario should not run here, or undefined to run it.
 *
 * Four tags were validated at LINT time and had no runtime path at all, which
 * is the worst arrangement available: the tag reads as a control, the linter
 * confirms it is spelled correctly, and the runner ignores it. A project can
 * carry hundreds of `@env:` tags and still send every one of them at
 * production.
 *
 * Kept a pure function, separate from the fixture that calls it, because the
 * property that matters — "a tag that excludes this environment MUST skip" —
 * should be testable without a browser, a config or a Playwright runner.
 */
export function scenarioSkipReason(
  tags: readonly string[],
  ctx: TagGateContext,
): string | undefined {
  // @env:<name> — an ALLOW list. Tagging any environment excludes every other
  // one; tagging none leaves the scenario unrestricted.
  const envs = parseTagValues(tags, 'env');
  if (envs.length && !envs.includes(ctx.env)) {
    return `@env:${envs.join(', @env:')} — this run is on "${ctx.env}"`;
  }

  // @skip:<browser> — a DENY list, and the opposite direction on purpose: it
  // names what must not run rather than what may.
  if (ctx.browser) {
    const skipped = parseTagValues(tags, 'skip');
    if (skipped.includes(ctx.browser)) return `@skip:${ctx.browser}`;
  }

  // @quarantine — known-flaky, excluded unless explicitly asked for. Every
  // recipe was excluding these by hand in its tag expression, which is a
  // per-recipe list that drifts and that nobody can audit centrally.
  if (tags.includes('@quarantine') && (ctx.quarantine ?? 'skip') === 'skip') {
    return '@quarantine — set SDODS_QUARANTINE=run to include quarantined scenarios';
  }

  // @flag:<name> — the scenario needs a feature flag that this build may not
  // carry. Flags are usually baked at build time, so a test cannot turn one on;
  // it can only discover which way the build went and decline to assert.
  if (ctx.flags) {
    const required = parseTagValues(tags, 'flag');
    const missing = required.filter((f) => !ctx.flags!.includes(f));
    if (missing.length) {
      return `@flag:${missing.join(', @flag:')} — not enabled in "${ctx.env}"`;
    }
  }

  return undefined;
}
