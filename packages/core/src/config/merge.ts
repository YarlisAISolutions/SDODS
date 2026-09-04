/**
 * Deep merge with SDODS semantics: plain objects merge recursively, arrays REPLACE,
 * `undefined` is skipped, `null` clears the key.
 */
export type LayerName = 'defaults' | 'project' | 'envYaml' | 'dotenv' | 'processEnv' | 'cli';

export interface Provenance {
  /** dotted path → layer that produced the final value */
  byPath: Map<string, LayerName>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

export function deepMerge<T>(
  base: T,
  patch: unknown,
  prov?: Provenance,
  layer?: LayerName,
  path = '',
): T {
  if (patch === undefined) return base;
  if (patch === null) {
    if (prov && layer) prov.byPath.set(path, layer);
    return undefined as T;
  }
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      const p = path ? `${path}.${k}` : k;
      const merged = deepMerge(out[k], v, prov, layer, p);
      if (merged === undefined) delete out[k];
      else out[k] = merged;
    }
    return out as T;
  }
  if (prov && layer) markLeaves(patch, prov, layer, path);
  return patch as T;
}

function markLeaves(v: unknown, prov: Provenance, layer: LayerName, path: string) {
  if (isPlainObject(v)) {
    for (const [k, val] of Object.entries(v))
      markLeaves(val, prov, layer, path ? `${path}.${k}` : k);
  } else {
    prov.byPath.set(path, layer);
  }
}

export function setPath(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

export function getAtPath(target: unknown, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>((acc, key) => (isPlainObject(acc) ? acc[key] : undefined), target);
}

export function coerceEnvValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}
