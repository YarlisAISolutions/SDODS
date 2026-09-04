import { JSONPath } from 'jsonpath-plus';

/**
 * Read a value by dotted path (`data.items[0].id`) or JSONPath (`$.data[?(@.id==1)].name`, `$..id`).
 * Dotted paths return a single value; JSONPath returns a single value when one match, else an array.
 */
export function getPath(body: unknown, path: string): unknown {
  if (path.startsWith('$')) {
    const result = JSONPath({ path, json: body as any, wrap: true }) as unknown[];
    return result.length === 1 ? result[0] : result;
  }
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  return segments.reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return (acc as Record<string, unknown>)[key];
  }, body);
}

/** Coerce a Gherkin string literal into a comparable JS value ("42" → 42, "true" → true, "null" → null). */
export function coerce(raw: string): unknown {
  const s = raw.trim();
  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}
