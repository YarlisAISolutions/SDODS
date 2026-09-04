import { SdodsConfigError } from '../errors.js';

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const SECRET_KEY_RE = /(password|secret|token|apikey|api_key|clientsecret|client_secret)/i;
const VAR_ONLY_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}$/;

export interface InterpolateOptions {
  vars: Record<string, string | undefined>;
  /** Paths to leave untouched (e.g. `env.vars` values can hold templates for steps) */
  skipPaths?: string[];
  onUnresolved?: 'throw' | 'keep' | 'empty';
}

/** Refuse literal secrets in yaml: keys that look secret must reference `${VAR}`. */
export function assertNoSecretLiterals(obj: unknown, path = ''): void {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoSecretLiterals(v, `${path}[${i}]`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (
        SECRET_KEY_RE.test(k) &&
        typeof v === 'string' &&
        v.length > 0 &&
        !VAR_ONLY_RE.test(v) &&
        !k.toLowerCase().endsWith('env') &&
        !k.toLowerCase().endsWith('selector') &&
        !k.toLowerCase().endsWith('placement') &&
        !k.toLowerCase().endsWith('url')
      ) {
        throw new SdodsConfigError(
          `Secret literal at "${p}". Use \${VAR} and put the value in .env.<env>.`,
          {
            code: 'CONFIG_SECRET_LITERAL',
            hint: `Replace the value with "\${${k.toUpperCase()}}" and add ${k.toUpperCase()}=... to your .env file.`,
            details: { path: p },
          },
        );
      }
      assertNoSecretLiterals(v, p);
    }
  }
}

export function interpolateString(value: string, opts: InterpolateOptions, path = ''): string {
  return value.replace(VAR_RE, (_m, name: string, fallback: string | undefined) => {
    const v = opts.vars[name];
    if (v !== undefined) return v;
    if (fallback !== undefined) return fallback;
    const mode = opts.onUnresolved ?? 'throw';
    if (mode === 'keep') return `\${${name}}`;
    if (mode === 'empty') return '';
    throw new SdodsConfigError(`Unresolved variable \${${name}} at "${path || '<root>'}".`, {
      code: 'CONFIG_UNRESOLVED_VAR',
      hint: `Add ${name}=... to .env or .env.<env> (repo root or project folder), or export it in the shell.`,
      details: { variable: name, path },
    });
  });
}

export function interpolate<T>(obj: T, opts: InterpolateOptions, path = ''): T {
  if (typeof obj === 'string') {
    if (opts.skipPaths?.some((p) => path === p || path.startsWith(`${p}.`))) return obj;
    return interpolateString(obj, opts, path) as T;
  }
  if (Array.isArray(obj)) return obj.map((v, i) => interpolate(v, opts, `${path}[${i}]`)) as T;
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = interpolate(v, opts, path ? `${path}.${k}` : k);
    }
    return out as T;
  }
  return obj;
}

/** Collect `${VAR}` names referenced anywhere in an object (for `doctor` and docs). */
export function collectVarRefs(obj: unknown, acc = new Set<string>()): Set<string> {
  if (typeof obj === 'string') {
    for (const m of obj.matchAll(VAR_RE)) if (m[2] === undefined) acc.add(m[1]!);
  } else if (Array.isArray(obj)) obj.forEach((v) => collectVarRefs(v, acc));
  else if (obj && typeof obj === 'object')
    Object.values(obj).forEach((v) => collectVarRefs(v, acc));
  return acc;
}
