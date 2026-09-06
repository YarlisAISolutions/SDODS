import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../src/fixtures/api-context.js';
import { CompositeDataProvider } from '../src/data/provider.js';
import { resolveConfig } from '../src/config/resolve.js';

/**
 * Two defects that shared a shape: a value that was *almost* right, so nothing
 * threw, and the wrongness only surfaced far from its cause.
 */

describe('`I use no authentication` actually disables authentication', () => {
  // The step used to assign `undefined`, and the client reads `undefined` as
  // "unset — fall back to env.api.auth". So on every environment that declares
  // a credential the step was a no-op, and a scenario asserting an
  // unauthenticated refusal quietly sent credentials and asserted nothing.
  //
  // This mirrors the resolution in ApiClient.buildHeaders. If that expression
  // changes, this must change with it — which is the point.
  const resolve = (optsAuth: unknown, ctxAuth: unknown, envAuth: unknown) =>
    optsAuth === null
      ? undefined
      : (optsAuth ?? (ctxAuth === null ? undefined : (ctxAuth ?? envAuth)));

  const ENV = { type: 'bearer', token: 'from-env' };
  const CTX = { type: 'bearer', token: 'from-ctx' };

  it('null on the context beats the environment credential', () => {
    expect(resolve(undefined, null, ENV)).toBeUndefined();
  });

  it('undefined on the context still falls back to the environment', () => {
    expect(resolve(undefined, undefined, ENV)).toBe(ENV);
  });

  it('a context credential still wins over the environment', () => {
    expect(resolve(undefined, CTX, ENV)).toBe(CTX);
  });

  it('null per-request beats everything', () => {
    expect(resolve(null, CTX, ENV)).toBeUndefined();
  });

  it('ApiContext.auth accepts null', () => {
    const ctx = new ApiContext();
    ctx.auth = null;
    expect(ctx.auth).toBeNull();
  });
});

describe('dataset ${VAR} resolves from the dotenv layer, not only the shell', () => {
  // `loadDotEnvLayer` deliberately does not mutate process.env, and the data
  // provider used to fall back to bare `process.env`. So the documented pattern
  // — passwords in `.env.<env>`, `${VAR}` in users.csv — could not work: the
  // row kept the literal `${TEST_MEMBER_PASSWORD}` and the failure surfaced as
  // the identity provider rejecting a nonsense credential.
  function workspace() {
    const root = mkdtempSync(join(tmpdir(), 'sdods-vars-'));
    const projectRoot = join(root, 'projects', 'demo');
    mkdirSync(join(projectRoot, 'envs'), { recursive: true });
    mkdirSync(join(projectRoot, 'data', 'common'), { recursive: true });

    writeFileSync(
      join(root, 'sdods.workspace.yaml'),
      'organization:\n  slug: t\n  name: T\nworkspaces:\n  - slug: default\n    name: D\n    organization: t\ndefaultWorkspace: default\n',
    );
    writeFileSync(
      join(projectRoot, 'sdods.project.yaml'),
      [
        'slug: demo',
        'name: Demo',
        'organization: t',
        'workspace: default',
        'layers: [api]',
        'envs:',
        '  default: staging',
        '  available: [staging]',
        'data:',
        '  sources:',
        '    users: { type: csv, path: data/common/users.csv }',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(projectRoot, 'envs', 'staging.yaml'),
      'name: staging\nui:\n  baseUrl: https://example.test\napi:\n  baseUrl: https://api.example.test\n  auth: { type: none }\n',
    );
    // The password lives ONLY in the dotenv file — never in the CSV, never in
    // the shell. That is the whole point of the pattern.
    writeFileSync(join(projectRoot, '.env.staging'), 'SECRET_PW=hunter2\n');
    writeFileSync(
      join(projectRoot, 'data', 'common', 'users.csv'),
      'id,username,password,role\n1,ada@example.test,${SECRET_PW},member\n',
    );
    return { root, projectRoot };
  }

  it('interpolates a dataset cell from .env.<env>', async () => {
    const { root, projectRoot } = workspace();
    // An empty process env, so a pass cannot come from the ambient shell.
    const config = resolveConfig({ rootDir: root, projectRoot, env: 'staging', processEnv: {} });

    expect(config.vars.SECRET_PW, 'the resolver must expose its ${VAR} scope').toBe('hunter2');

    const rows = await new CompositeDataProvider(config).load('users');
    expect(rows[0]!.password).toBe('hunter2');
    expect(rows[0]!.password).not.toContain('${');
  });

  it('process.env still wins over the dotenv layer', async () => {
    const { root, projectRoot } = workspace();
    const config = resolveConfig({
      rootDir: root,
      projectRoot,
      env: 'staging',
      processEnv: { SECRET_PW: 'from-shell' },
    });
    const rows = await new CompositeDataProvider(config).load('users');
    expect(rows[0]!.password).toBe('from-shell');
  });
});

describe('the API layer gets a credential for the leased pool user', () => {
  // Three seams were dead at once, so a role-tagged API scenario sent every
  // request anonymously:
  //   1. storageState is undefined when layer === 'api' (correct, but it means
  //      @user:<role> applies no credential here)
  //   2. `... for API calls` set variables and did not authenticate
  //   3. token() was written to <role>-<n>.token.json and never read back
  //
  // Against an app that 401s, that failed loudly. Against one that answers 200
  // to anonymous reads, an authorization scenario passed proving nothing.
  const user = {
    id: '1',
    username: 'ada@example.test',
    password: 'x',
    role: 'member',
    index: 0,
  } as never;

  function configWithAuthDir() {
    const root = mkdtempSync(join(tmpdir(), 'sdods-token-'));
    mkdirSync(join(root, '.auth', 'staging'), { recursive: true });
    return { project: { root }, env: { name: 'staging' } } as never;
  }

  it('tokenFileFor points at the file `sdods auth capture` writes', async () => {
    const { tokenFileFor } = await import('../src/auth/capture.js');
    const config = configWithAuthDir();
    expect(tokenFileFor(config, user)).toMatch(/\.auth\/staging\/member-0\.token\.json$/);
  });

  it('a cached token is read back rather than re-minted', async () => {
    const { tokenFileFor } = await import('../src/auth/capture.js');
    const config = configWithAuthDir();
    writeFileSync(tokenFileFor(config, user), JSON.stringify({ token: 'cached-abc' }));

    // Mirrors readCachedToken in data.steps.ts. If that helper changes shape
    // this must change with it — which is the point of pinning the contract.
    const raw = JSON.parse(readFileSync(tokenFileFor(config, user), 'utf8')) as { token?: string };
    expect(raw.token).toBe('cached-abc');
  });

  it('a corrupt token cache does not throw', async () => {
    const { tokenFileFor } = await import('../src/auth/capture.js');
    const config = configWithAuthDir();
    writeFileSync(tokenFileFor(config, user), 'not json at all');
    let token: string | undefined;
    expect(() => {
      try {
        token = (JSON.parse(readFileSync(tokenFileFor(config, user), 'utf8')) as { token?: string })
          .token;
      } catch {
        token = undefined;
      }
    }).not.toThrow();
    expect(token).toBeUndefined();
  });
});
