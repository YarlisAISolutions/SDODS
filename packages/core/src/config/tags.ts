import type { ProjectConfig } from '@sdods/contracts';

export const LAYER_TAGS = ['@ui', '@api', '@hybrid'] as const;
export const PLAYWRIGHT_BDD_SPECIAL =
  /^@(only|skip|fixme|fail|slow|timeout:\d+|retries:\d+|mode:(parallel|serial|default))$/;
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
