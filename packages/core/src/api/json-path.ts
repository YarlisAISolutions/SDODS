import { JSONPath } from 'jsonpath-plus';
import { SdodsError } from '../errors.js';

/**
 * Read a value by dotted path (`data.items[0].id`) or JSONPath (`$.data[?(@.id==1)].name`, `$..id`).
 *
 * `undefined` always means "nothing matched", whatever the path syntax, so callers can tell a
 * missing key from a present one. A key that is present with the value `null` or `[]` returns that
 * value. Dotted paths return a single value. JSONPath returns `undefined` for no match, the value
 * itself for one match, and an array of the matches for two or more; so `$.items[*]` over an empty
 * `items` is `undefined`, while `$.items` is `[]`.
 */
export function getPath(body: unknown, path: string): unknown {
  if (path.startsWith('$')) {
    // `wrap: true` always yields an array of matches: a matched `[]` comes back as `[[]]`, so an
    // empty result is unambiguously "no match" and must not leak out as a value.
    const result = JSONPath({ path, json: body as any, wrap: true }) as unknown[];
    if (result.length === 0) return undefined;
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

/**
 * The value at `path`, or an SdodsError when the path matched nothing. `getPath` returns
 * `undefined` only for "no match", so a present `null` or `[]` passes through.
 */
export function matchedPath(body: unknown, path: string, savingAs?: string): unknown {
  const value = getPath(body, path);
  if (value !== undefined) return value;
  throw new SdodsError(
    'RUN_FAILED',
    `JSON path ${path} matched nothing in the last response${savingAs ? `; cannot save it as ${savingAs}` : ''}.`,
    {
      hint: 'Check the path against the response body: a failed request often returns only an error object. A JSONPath such as $.items[*] matches nothing over an empty array; point at $.items to read the array itself.',
    },
  );
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
