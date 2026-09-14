import type { EnvConfig, LoadProfile, LoadRequest } from '@sdods/contracts';

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export interface K6ScriptInput {
  project: string;
  profileName: string;
  profile: LoadProfile;
  /**
   * The environment as written in `envs/<env>.yaml`, NOT interpolated: `${VAR}` references in
   * auth and headers must survive so they become `__ENV.VAR` lookups instead of inlined values.
   */
  env: EnvConfig;
  /** Resolved `api.baseUrl` (not a secret); requests are sent to `baseUrl + path`. */
  baseUrl: string;
}

export interface K6Script {
  script: string;
  /** Variables the script reads from `__ENV` with no default: they must be set when k6 runs. */
  requiredEnv: string[];
}

/**
 * A string that may contain `${VAR}` / `${VAR:-default}` as a JavaScript expression reading k6's
 * `__ENV`, so secret values stay in the environment and never reach the generated file.
 */
export function envExpr(value: string, required: Set<string>): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of value.matchAll(VAR_RE)) {
    if (m.index > last) parts.push(JSON.stringify(value.slice(last, m.index)));
    const name = m[1]!;
    if (m[2] === undefined) {
      required.add(name);
      parts.push(`__ENV.${name}`);
    } else {
      parts.push(`(__ENV.${name} || ${JSON.stringify(m[2])})`);
    }
    last = m.index + m[0].length;
  }
  if (last < value.length || parts.length === 0) parts.push(JSON.stringify(value.slice(last)));
  return parts.join(' + ');
}

function valueExpr(value: unknown, required: Set<string>, indent: string): string {
  if (typeof value === 'string') return envExpr(value, required);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const inner = indent + '  ';
    return `[\n${value.map((v) => inner + valueExpr(v, required, inner)).join(',\n')},\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return '{}';
    const inner = indent + '  ';
    return `{\n${entries
      .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${valueExpr(v, required, inner)}`)
      .join(',\n')},\n${indent}}`;
  }
  return JSON.stringify(value ?? null);
}

function authLines(
  env: EnvConfig,
  required: Set<string>,
): {
  imports: string[];
  setup: string[];
  headers: Array<[string, string]>;
} {
  const auth = env.api.auth;
  switch (auth.type) {
    case 'none':
      return { imports: [], setup: [], headers: [] };
    case 'bearer':
      return {
        imports: [],
        setup: [],
        headers: [['Authorization', `"Bearer " + ${envExpr(auth.token, required)}`]],
      };
    case 'basic':
      return {
        imports: [`import encoding from 'k6/encoding';`],
        setup: [],
        headers: [
          [
            'Authorization',
            `"Basic " + encoding.b64encode(${envExpr(auth.username, required)} + ":" + ${envExpr(auth.password, required)})`,
          ],
        ],
      };
    case 'header':
      return { imports: [], setup: [], headers: [[auth.name, envExpr(auth.value, required)]] };
    case 'oauth-client-credentials': {
      const form: Array<[string, string]> = [
        ['grant_type', '"client_credentials"'],
        ['client_id', envExpr(auth.clientId, required)],
        ['client_secret', envExpr(auth.clientSecret, required)],
      ];
      if (auth.scope) form.push(['scope', envExpr(auth.scope, required)]);
      if (auth.audience) form.push(['audience', envExpr(auth.audience, required)]);
      return {
        imports: [],
        setup: [
          `  // OAuth client-credentials token, minted once. A test longer than the token lifetime`,
          `  // will start failing with 401 when it expires.`,
          `  const tokenRes = http.post(${envExpr(auth.tokenUrl, required)}, {`,
          ...form.map(([k, v]) => `    ${k}: ${v},`),
          `  }, { headers: { Accept: "application/json" }, tags: { name: "oauth token" } });`,
          `  if (tokenRes.status !== 200) fail("token request failed with status " + tokenRes.status);`,
          `  data.token = tokenRes.json("access_token");`,
        ],
        headers: [['Authorization', `"Bearer " + data.token`]],
      };
    }
  }
}

function requestBlock(req: LoadRequest, required: Set<string>): string[] {
  const name = req.name ?? `${req.method} ${req.path}`;
  const headers: Array<[string, string]> = Object.entries(req.headers).map(([k, v]) => [
    k,
    envExpr(v, required),
  ]);
  let body = 'null';
  if (typeof req.body === 'string') body = envExpr(req.body, required);
  else if (req.body !== undefined) {
    body = `JSON.stringify(${valueExpr(req.body, required, '  ')})`;
    if (!Object.keys(req.headers).some((h) => h.toLowerCase() === 'content-type'))
      headers.unshift(['Content-Type', '"application/json"']);
  }
  const statuses = JSON.stringify(req.expect.status);
  const checks = [
    `    ${JSON.stringify(`${name}: status ${req.expect.status.join(' or ')}`)}: (r) => ${statuses}.includes(r.status),`,
  ];
  if (req.expect.bodyContains !== undefined)
    checks.push(
      `    ${JSON.stringify(`${name}: body contains`)}: (r) => String(r.body).includes(${envExpr(req.expect.bodyContains, required)}),`,
    );
  if (req.expect.maxDurationMs !== undefined)
    checks.push(
      `    ${JSON.stringify(`${name}: under ${req.expect.maxDurationMs}ms`)}: (r) => r.timings.duration < ${req.expect.maxDurationMs},`,
    );
  return [
    `  res = http.request(${JSON.stringify(req.method)}, BASE_URL + ${envExpr(req.path, required)}, ${body}, {`,
    `    headers: Object.assign({}, headers, {${headers.map(([k, v]) => ` ${JSON.stringify(k)}: ${v}`).join(',')}${headers.length ? ' ' : ''}}),`,
    `    tags: { name: ${JSON.stringify(name)} },`,
    `  });`,
    `  check(res, {`,
    ...checks,
    `  });`,
  ];
}

/** k6 `options` exactly as the profile declares them, tagged with project, env and profile. */
export function k6Options(input: K6ScriptInput): Record<string, unknown> {
  const p = input.profile;
  const options: Record<string, unknown> = {};
  if (p.stages) options.stages = p.stages;
  else {
    options.vus = p.vus;
    if (p.duration) options.duration = p.duration;
    if (p.iterations) options.iterations = p.iterations;
  }
  options.thresholds = p.thresholds;
  options.tags = { project: input.project, env: input.env.name, profile: input.profileName };
  return options;
}

export function generateK6Script(input: K6ScriptInput): K6Script {
  const required = new Set<string>();
  const { profile, env } = input;
  const useEnvAuth = profile.auth === 'env';
  const auth = useEnvAuth ? authLines(env, required) : { imports: [], setup: [], headers: [] };
  const commonHeaders: Array<[string, string]> = useEnvAuth
    ? Object.entries(env.api.headers).map(([k, v]) => [k, envExpr(v, required)])
    : [];
  const requests = profile.requests.flatMap((r) => requestBlock(r, required));
  const baseUrl = input.baseUrl.replace(/\/+$/, '');

  const lines = [
    `// Generated by \`sdods load -p ${input.project} -e ${env.name} ${input.profileName}\`. Do not edit: change`,
    `// load/${input.profileName}.yaml and regenerate. Secrets are read from the environment (__ENV)`,
    `// when k6 runs and are never written to this file.`,
    `import http from 'k6/http';`,
    `import { check, fail, sleep } from 'k6';`,
    ...auth.imports,
    ``,
    `const BASE_URL = ${JSON.stringify(baseUrl)};`,
    `const REQUIRED_ENV = ${JSON.stringify([...required].sort())};`,
    ``,
    `export const options = ${JSON.stringify(k6Options(input), null, 2)};`,
    ``,
    `export function setup() {`,
    `  const missing = REQUIRED_ENV.filter((name) => !__ENV[name]);`,
    `  if (missing.length) fail("missing environment variables: " + missing.join(", "));`,
    `  const data = {};`,
    ...auth.setup,
    `  return data;`,
    `}`,
    ``,
    `export default function (data) {`,
    `  const headers = {${[...commonHeaders, ...auth.headers].map(([k, v]) => `\n    ${JSON.stringify(k)}: ${v},`).join('')}${commonHeaders.length || auth.headers.length ? '\n  ' : ''}};`,
    `  let res;`,
    ...requests,
    ...(profile.thinkTimeSeconds > 0 ? [`  sleep(${profile.thinkTimeSeconds});`] : []),
    `}`,
    ``,
  ];
  // Every expression was rendered above, so `required` is complete by the time REQUIRED_ENV is.
  const script = lines.join('\n');
  return { script, requiredEnv: [...required].sort() };
}
