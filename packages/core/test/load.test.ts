import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvConfigSchema, type EnvConfigInput } from '@sdods/contracts';
import {
  K6_INSTALL_URL,
  generateK6Script,
  loadGuardProblems,
  mapK6ExitCode,
  parseLoadProfile,
  peakVus,
  runLoad,
} from '../src/load/index.js';

const SECRET = 'tok-7f3c9a-this-must-never-be-written';

const env = (over: Partial<EnvConfigInput> = {}) =>
  EnvConfigSchema.parse({
    name: 'perf',
    ui: { baseUrl: 'https://perf.example.com' },
    api: {
      baseUrl: 'https://api.perf.example.com',
      headers: { Accept: 'application/json' },
      auth: { type: 'bearer', token: '${API_TOKEN}' },
    },
    ...over,
  });

const PROFILE_YAML = `description: Browse and create posts
thinkTimeSeconds: 0.5
stages:
  - { duration: 30s, target: 10 }
  - { duration: 1m, target: 25 }
  - { duration: 15s, target: 0 }
thresholds:
  http_req_duration: ['p(95)<500']
  http_req_failed: 'rate<0.01'
requests:
  - name: list posts
    path: /posts?limit=\${PAGE_SIZE:-20}
    expect: { status: 200, bodyContains: title, maxDurationMs: 800 }
  - method: post
    path: /posts
    headers: { X-Tenant: '\${TENANT_ID}' }
    body: { title: load, owner: '\${OWNER_ID}', tags: [a, b] }
    expect: { status: [200, 201] }
`;

const profileRaw = () => {
  // yaml parsing is covered by readLoadProfile in the runLoad tests; keep this one literal.
  return {
    description: 'Browse and create posts',
    thinkTimeSeconds: 0.5,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '1m', target: 25 },
      { duration: '15s', target: 0 },
    ],
    thresholds: { http_req_duration: ['p(95)<500'], http_req_failed: 'rate<0.01' },
    requests: [
      {
        name: 'list posts',
        path: '/posts?limit=${PAGE_SIZE:-20}',
        expect: { status: 200, bodyContains: 'title', maxDurationMs: 800 },
      },
      {
        method: 'post',
        path: '/posts',
        headers: { 'X-Tenant': '${TENANT_ID}' },
        body: { title: 'load', owner: '${OWNER_ID}', tags: ['a', 'b'] },
        expect: { status: [200, 201] },
      },
    ],
  };
};

function scaffold(opts: { envLoad?: string; dotenv?: string; profile?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-load-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  mkdirSync(join(proj, 'load'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(proj, 'sdods.project.yaml'),
    'slug: shop\nname: Shop\nlayers: [api]\nenvs: { default: perf, available: [perf] }\n',
  );
  writeFileSync(
    join(proj, 'envs', 'perf.yaml'),
    `ui: { baseUrl: https://perf.example.com }\napi:\n  baseUrl: https://api.perf.example.com/\n  auth: { type: bearer, token: '\${API_TOKEN}' }\n${opts.envLoad ?? ''}`,
  );
  writeFileSync(join(proj, 'load', 'browse.yaml'), opts.profile ?? PROFILE_YAML);
  if (opts.dotenv) writeFileSync(join(proj, '.env.perf'), opts.dotenv);
  return { root, proj };
}

/** A stand-in for k6: records its arguments and environment, writes a summary, exits $FAKE_K6_EXIT. */
function fakeK6(): string {
  const bin = mkdtempSync(join(tmpdir(), 'sdods-fake-k6-'));
  const file = join(bin, 'k6');
  writeFileSync(
    file,
    `#!/bin/sh
summary=""
for a in "$@"; do
  if [ "$prev" = "--summary-export" ]; then summary="$a"; fi
  prev="$a"
done
printf '%s\\n' "$@" > "\${summary%/*}/fake-k6-args.txt"
printf 'API_TOKEN=%s\\nTENANT_ID=%s\\nPAGE_SIZE=%s\\n' "$API_TOKEN" "$TENANT_ID" "$PAGE_SIZE" > "\${summary%/*}/fake-k6-env.txt"
printf '{"metrics":{"http_reqs":{"count":42,"rate":4.2},"http_req_duration":{"avg":80,"p(95)":123.4},"http_req_failed":{"passes":0,"fails":42,"value":0},"checks":{"passes":41,"fails":1,"value":0.976}}}' > "$summary"
exit "\${FAKE_K6_EXIT:-0}"
`,
  );
  chmodSync(file, 0o755);
  return bin;
}

const OPTED_IN = 'load: { allowed: true, maxVus: 50, allowWrites: true }\n';
const VARS = { API_TOKEN: SECRET, TENANT_ID: 't-1', OWNER_ID: 'u-1' };

describe('load profile schema', () => {
  it('normalises method, status and single-string thresholds', () => {
    const p = parseLoadProfile(profileRaw());
    expect(p.auth).toBe('env');
    expect(p.requests[0]!.method).toBe('GET');
    expect(p.requests[0]!.expect.status).toEqual([200]);
    expect(p.requests[1]!.method).toBe('POST');
    expect(p.requests[1]!.expect.status).toEqual([200, 201]);
    expect(p.thresholds.http_req_failed).toEqual(['rate<0.01']);
    expect(peakVus(p)).toBe(25);
  });

  it('requires stages, or vus with duration or iterations — not both', () => {
    const base = { requests: [{ path: '/x' }] };
    expect(() => parseLoadProfile(base)).toThrow(/set stages, or vus with duration/);
    expect(() => parseLoadProfile({ ...base, vus: 5 })).toThrow(/set stages, or vus/);
    expect(parseLoadProfile({ ...base, vus: 5, duration: '1m30s' }).vus).toBe(5);
    expect(peakVus(parseLoadProfile({ ...base, vus: 3, iterations: 10 }))).toBe(3);
    expect(() =>
      parseLoadProfile({ ...base, vus: 5, stages: [{ duration: '10s', target: 5 }] }),
    ).toThrow(/either stages, or vus/);
  });

  it('refuses absolute URLs, bad durations, unknown methods and secret literals', () => {
    const ok = { vus: 1, duration: '10s' };
    expect(() =>
      parseLoadProfile({ ...ok, requests: [{ path: 'https://prod.example.com/x' }] }),
    ).toThrow(/path must start with/);
    expect(() =>
      parseLoadProfile({ vus: 1, duration: 'ten seconds', requests: [{ path: '/x' }] }),
    ).toThrow(/k6 duration/);
    expect(() =>
      parseLoadProfile({ ...ok, requests: [{ method: 'TRACE', path: '/x' }] }),
    ).toThrow();
    expect(() =>
      parseLoadProfile({
        ...ok,
        requests: [{ path: '/x', headers: { 'X-Api-Token': 'abc123' } }],
      }),
    ).toThrow(/Secret literal/);
  });

  it('env load block is optional and defaults to the safe side', () => {
    expect(env().load).toBeUndefined();
    expect(env({ load: { allowed: true } }).load).toEqual({ allowed: true, allowWrites: false });
  });
});

describe('k6 script generation', () => {
  it('matches the golden script: stages, thresholds, checks, auth via __ENV', async () => {
    const { script, requiredEnv } = generateK6Script({
      project: 'shop',
      profileName: 'browse',
      profile: parseLoadProfile(profileRaw()),
      env: env(),
      baseUrl: 'https://api.perf.example.com',
    });
    await expect(script).toMatchFileSnapshot('fixtures/load/browse.k6.js');
    expect(requiredEnv).toEqual(['API_TOKEN', 'OWNER_ID', 'TENANT_ID']);
    expect(script).toContain('"Authorization": "Bearer " + __ENV.API_TOKEN');
    expect(script).toContain('"p(95)<500"');
    expect(script).toContain('"target": 25');
    expect(script).toContain('(__ENV.PAGE_SIZE || "20")');
    expect(script).not.toMatch(/\$\{[A-Z_]+/);
  });

  it('basic, header and oauth auth read credentials from __ENV; auth: none sends nothing', () => {
    const gen = (auth: EnvConfigInput['api']['auth'], profileAuth: 'env' | 'none' = 'env') =>
      generateK6Script({
        project: 'shop',
        profileName: 'p',
        profile: parseLoadProfile({
          auth: profileAuth,
          vus: 1,
          duration: '5s',
          requests: [{ path: '/x' }],
        }),
        env: env({ api: { baseUrl: 'https://api.perf.example.com', auth } }),
        baseUrl: 'https://api.perf.example.com',
      });
    const basic = gen({ type: 'basic', username: 'svc', password: '${SVC_PASSWORD}' });
    expect(basic.script).toContain(`import encoding from 'k6/encoding';`);
    expect(basic.script).toContain('encoding.b64encode("svc" + ":" + __ENV.SVC_PASSWORD)');
    expect(basic.requiredEnv).toEqual(['SVC_PASSWORD']);

    const header = gen({ type: 'header', name: 'X-Api-Key', value: '${API_KEY}' });
    expect(header.script).toContain('"X-Api-Key": __ENV.API_KEY');

    const oauth = gen({
      type: 'oauth-client-credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'load-client',
      clientSecret: '${CLIENT_SECRET}',
      scope: 'read',
    });
    expect(oauth.script).toContain('http.post("https://auth.example.com/token"');
    expect(oauth.script).toContain('client_secret: __ENV.CLIENT_SECRET');
    expect(oauth.script).toContain('"Authorization": "Bearer " + data.token');

    const none = gen({ type: 'bearer', token: '${API_TOKEN}' }, 'none');
    expect(none.script).not.toContain('Authorization');
    expect(none.requiredEnv).toEqual([]);
  });
});

describe('opt-in guard', () => {
  const profile = parseLoadProfile(profileRaw());

  it('refuses an environment that has not opted in', () => {
    expect(loadGuardProblems(env(), profile)).toEqual([
      expect.stringContaining('has not opted in'),
      expect.stringContaining('POST'),
    ]);
  });

  it('enforces maxVus and allowWrites', () => {
    expect(loadGuardProblems(env({ load: { allowed: true, maxVus: 10 } }), profile)).toEqual([
      expect.stringContaining('peaks at 25 virtual users, above load.maxVus 10'),
      expect.stringContaining('does not set load.allowWrites: true'),
    ]);
    expect(
      loadGuardProblems(env({ load: { allowed: true, maxVus: 25, allowWrites: true } }), profile),
    ).toEqual([]);
  });

  it('runLoad refuses before generating anything to run, and names the fix', async () => {
    const { root, proj } = scaffold();
    const err = await runLoad({
      rootDir: root,
      projectRoot: proj,
      profile: 'browse',
      outDir: join(root, 'out'),
      processEnv: { ...VARS, PATH: fakeK6() },
      stdio: 'pipe',
    }).catch(
      (e: unknown) => e as { code: string; message: string; hint: string; exitCode: number },
    );
    expect(err).toMatchObject({ code: 'CONFIG_INVALID', exitCode: 2 });
    expect(err.message).toContain('Refusing to run a load test');
    expect(err.hint).toContain('load: { allowed: true');
    expect(existsSync(join(root, 'out'))).toBe(false);
  });

  it('--dry-run writes the script, reports the guard, and never inlines secrets', async () => {
    const { root, proj } = scaffold({ dotenv: `API_TOKEN=${SECRET}\n` });
    const lines: string[] = [];
    const res = await runLoad({
      rootDir: root,
      projectRoot: proj,
      profile: 'browse',
      dryRun: true,
      processEnv: { PATH: '' },
      log: (l) => lines.push(l),
    });
    expect(res.exitCode).toBe(0);
    expect(res.outDir).toContain(join('.sdods', 'runs'));
    expect(res.target).toBe('https://api.perf.example.com');
    expect(res.guardProblems[0]).toContain('has not opted in');
    expect(lines).toContain('target   https://api.perf.example.com');
    expect(lines).toContain('peak VUs 25 (stages)');
    const script = readFileSync(res.scriptFile, 'utf8');
    expect(script).toContain('__ENV.API_TOKEN');
    expect(script).not.toContain(SECRET);
    expect(readFileSync(join(res.outDir, 'load.json'), 'utf8')).not.toContain(SECRET);
  });
});

describe('running k6', () => {
  it('fails with an actionable message when k6 is not installed', async () => {
    const { root, proj } = scaffold({ envLoad: OPTED_IN });
    const empty = mkdtempSync(join(tmpdir(), 'sdods-empty-path-'));
    const err = await runLoad({
      rootDir: root,
      projectRoot: proj,
      profile: 'browse',
      processEnv: { ...VARS, PATH: empty },
    }).catch(
      (e: unknown) => e as { code: string; message: string; hint: string; exitCode: number },
    );
    expect(err).toMatchObject({ code: 'NOT_SUPPORTED', exitCode: 2 });
    expect(err.message).toContain('k6 is not installed');
    expect(err.hint).toContain(K6_INSTALL_URL);
    expect(err.hint).toContain('--runner docker');
  });

  it('refuses to start when a variable the script reads is unset', async () => {
    const { root, proj } = scaffold({ envLoad: OPTED_IN });
    const err = await runLoad({
      rootDir: root,
      projectRoot: proj,
      profile: 'browse',
      processEnv: { API_TOKEN: SECRET, PATH: fakeK6() },
      stdio: 'pipe',
    }).catch((e: unknown) => e as { code: string; message: string });
    expect(err).toMatchObject({ code: 'CONFIG_UNRESOLVED_VAR' });
    expect(err.message).toContain('${OWNER_ID}');
  });

  it('maps k6 exit codes: 0 passes, 99 (thresholds) and anything else fail with 1', () => {
    expect(mapK6ExitCode(0)).toEqual({ exitCode: 0, thresholdsFailed: false });
    expect(mapK6ExitCode(99)).toEqual({ exitCode: 1, thresholdsFailed: true });
    expect(mapK6ExitCode(107)).toEqual({ exitCode: 1, thresholdsFailed: false });
  });

  it.skipIf(process.platform === 'win32')(
    'runs k6 from PATH with --summary-export, passing secrets only through the environment',
    async () => {
      const { root, proj } = scaffold({
        envLoad: OPTED_IN,
        dotenv: `TENANT_ID=t-from-dotenv\nPAGE_SIZE=50\n`,
      });
      const bin = fakeK6();
      const run = (exit: string) =>
        runLoad({
          rootDir: root,
          projectRoot: proj,
          profile: 'browse',
          processEnv: { API_TOKEN: SECRET, OWNER_ID: 'u-1', PATH: bin, FAKE_K6_EXIT: exit },
          stdio: 'pipe',
        });

      const pass = await run('0');
      expect(pass).toMatchObject({ exitCode: 0, k6ExitCode: 0, thresholdsFailed: false });
      expect(pass.runner).toBe('k6');
      expect(pass.summary).toEqual({
        requests: 42,
        p95Ms: 123.4,
        failedRate: 0,
        checksRate: 0.976,
      });
      expect(pass.summaryFile).toBe(join(pass.outDir, 'summary.json'));
      const args = readFileSync(join(pass.outDir, 'fake-k6-args.txt'), 'utf8').trim().split('\n');
      expect(args).toEqual(['run', '--summary-export', pass.summaryFile, pass.scriptFile]);
      expect(args.join(' ')).not.toContain(SECRET);
      expect(readFileSync(join(pass.outDir, 'fake-k6-env.txt'), 'utf8')).toBe(
        `API_TOKEN=${SECRET}\nTENANT_ID=t-from-dotenv\nPAGE_SIZE=50\n`,
      );
      expect(readFileSync(pass.scriptFile, 'utf8')).not.toContain(SECRET);
      const meta = JSON.parse(readFileSync(join(pass.outDir, 'load.json'), 'utf8'));
      expect(meta).toMatchObject({ exitCode: 0, peakVus: 25, env: 'perf', profile: 'browse' });

      const fail = await run('99');
      expect(fail).toMatchObject({ exitCode: 1, k6ExitCode: 99, thresholdsFailed: true });
    },
  );
});
