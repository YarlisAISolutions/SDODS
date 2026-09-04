const TPL_RE = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;

/**
 * Render `{{name}}` / `{{obj.path}}` placeholders. Values are looked up in order over the given
 * scopes (first wins). `${VAR}` env references are left untouched (config already resolved them).
 */
export function render(
  template: string,
  ...scopes: Array<Record<string, unknown> | undefined>
): string {
  return template.replace(TPL_RE, (_m, name: string) => {
    for (const scope of scopes) {
      if (!scope) continue;
      const v = lookup(scope, name);
      if (v !== undefined) return typeof v === 'string' ? v : JSON.stringify(v);
    }
    return `{{${name}}}`;
  });
}

export function hasTemplate(s: string): boolean {
  return TPL_RE.test(s) && ((TPL_RE.lastIndex = 0), true);
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
export function renderJson(
  template: string,
  ...scopes: Array<Record<string, unknown> | undefined>
): unknown {
  const text = template.replace(TPL_RE, (_m, name: string) => {
    for (const scope of scopes) {
      if (!scope) continue;
      const v = lookup(scope, name);
      if (v !== undefined) return typeof v === 'string' ? v : JSON.stringify(v);
    }
    return `{{${name}}}`;
  });
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Body is not valid JSON after rendering templates: ${(e as Error).message}\n${text}`,
    );
  }
}
