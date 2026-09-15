import { SdodsError } from '../errors.js';

const TPL_RE = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;

type Scopes = Array<Record<string, unknown> | undefined>;

/**
 * Render `{{name}}` / `{{obj.path}}` placeholders. Values are looked up in order over the given
 * scopes (first wins). `${VAR}` env references are left untouched (config already resolved them).
 * A placeholder with no value is left as the literal `{{name}}`; use `renderStrict` wherever that
 * literal could be matched instead of failing.
 */
export function render(template: string, ...scopes: Scopes): string {
  return substitute(template, scopes, []);
}

/**
 * `render`, but a placeholder that resolves to nothing throws `no such variable: <name>` instead
 * of surviving as the literal `{{name}}`. Every built-in step renders its string arguments through
 * this: a literal placeholder can never appear in a URL, a title or a response, so a positive
 * assertion on it fails for the wrong reason and a negative one ("should not contain") passes
 * without testing anything. Only the template's own placeholders are checked, so a variable whose
 * value happens to contain `{{…}}` is not mistaken for a miss.
 */
export function renderStrict(template: string, ...scopes: Scopes): string {
  const missing: string[] = [];
  const out = substitute(template, scopes, missing);
  if (missing.length > 0) {
    const names = [...new Set(missing)];
    throw new SdodsError(
      'CONFIG_UNRESOLVED_VAR',
      `no such variable: ${names.join(', ')} (in "${template}").`,
      {
        hint: 'No scenario variable or env var of that name exists yet. Save it first (for example with "I save the response JSON path ... as ..."), or fix the spelling. The step refuses to match the literal placeholder, which would fail for the wrong reason or, in a negative assertion, pass without testing anything.',
        details: { missing: names, template },
      },
    );
  }
  return out;
}

export function hasTemplate(s: string): boolean {
  return TPL_RE.test(s) && ((TPL_RE.lastIndex = 0), true);
}

function substitute(template: string, scopes: Scopes, missing: string[]): string {
  return template.replace(TPL_RE, (_m, name: string) => {
    for (const scope of scopes) {
      if (!scope) continue;
      const v = lookup(scope, name);
      if (v !== undefined) return typeof v === 'string' ? v : JSON.stringify(v);
    }
    missing.push(name);
    return `{{${name}}}`;
  });
}

function lookup(scope: Record<string, unknown>, name: string): unknown {
  if (name in scope) return scope[name];
  return name
    .split('.')
    .reduce<unknown>(
      (acc, k) => (acc && typeof acc === 'object' ? (acc as any)[k] : undefined),
      scope,
    );
}

/** Render a JSON doc string, keeping types for whole-value placeholders (`"id": {{postId}}`). */
export function renderJson(template: string, ...scopes: Scopes): unknown {
  const text = substitute(template, scopes, []);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Body is not valid JSON after rendering templates: ${(e as Error).message}\n${text}`,
      { cause: e },
    );
  }
}
