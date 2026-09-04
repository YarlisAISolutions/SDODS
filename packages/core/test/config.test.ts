import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deepMerge, coerceEnvValue, setPath, getAtPath } from '../src/config/merge.js';
import { assertNoSecretLiterals, collectVarRefs, interpolate } from '../src/config/interpolate.js';
import { combineTagExpr, normalizeTagExpr, parseTagValue } from '../src/config/tags.js';
import { resolveConfig, serializeCliOverrides } from '../src/config/resolve.js';
import { ProjectRegistry } from '../src/config/registry.js';

function scaffold(
  opts: { projectYaml?: string; envYaml?: string; dotenv?: Record<string, string> } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'automax-cfg-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(proj, 'automax.project.yaml'),
    opts.projectYaml ??
      `slug: shop\nname: Shop\nlayers: [ui, api]\nbrowsers: [chromium, firefox]\nenvs: { default: staging, available: [staging, local] }\nscreenshots: { policy: { default: on-failure, '@smoke': scenario } }\n`,
  );
  writeFileSync(
    join(proj, 'envs', 'staging.yaml'),
    opts.envYaml ??
      `ui: { baseUrl: https://staging.example.com }\napi: { baseUrl: https://api.example.com, auth: { type: bearer, token: '\${API_TOKEN}' } }\nvars: { greeting: 'hi \${WHO:-world}' }\nscreenshots: { onlyOnFailure: true }\n`,
  );
  writeFileSync(
    join(proj, 'envs', 'local.yaml'),
    `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n`,
  );
  if (opts.dotenv) {
    writeFileSync(
      join(proj, '.env.staging'),
      Object.entries(opts.dotenv)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    );
  }
  return { root, proj };
}

describe('deepMerge', () => {
  it('merges objects, replaces arrays, clears on null, skips undefined', () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 'x', e: 'keep' };
    const out = deepMerge(base, { a: { c: [3] }, d: null, e: undefined, f: true });
    expect(out).toEqual({ a: { b: 1, c: [3] }, e: 'keep', f: true });
  });
  it('setPath/getPath and env coercion', () => {
    const t: Record<string, unknown> = {};
    setPath(t, 'a.b.c', 5);
    expect(getAtPath(t, 'a.b.c')).toBe(5);
    expect(coerceEnvValue('true')).toBe(true);
    expect(coerceEnvValue('42')).toBe(42);
    expect(coerceEnvValue('x')).toBe('x');
  });
});

describe('interpolate', () => {
  it('resolves ${VAR} and ${VAR:-default}; throws on unresolved', () => {
    expect(interpolate({ a: '${X}-${Y:-d}' }, { vars: { X: '1' } })).toEqual({ a: '1-d' });
    expect(() => interpolate({ a: '${MISSING}' }, { vars: {} })).toThrow(/Unresolved variable/);
    expect(interpolate({ a: '${MISSING}' }, { vars: {}, onUnresolved: 'keep' })).toEqual({
      a: '${MISSING}',
    });
  });
  it('refuses secret literals but accepts ${VAR} references and env names', () => {
    expect(() => assertNoSecretLiterals({ api: { auth: { token: 'abc123' } } })).toThrow(
      /Secret literal/,
    );
    expect(() =>
      assertNoSecretLiterals({
        api: { auth: { token: '${API_TOKEN}' } },
        tokenEnv: 'GITHUB_TOKEN',
      }),
    ).not.toThrow();
  });
  it('collects only var refs without defaults', () => {
    expect([...collectVarRefs({ a: '${A}', b: '${B:-x}', c: ['${C}'] })].sort()).toEqual([
      'A',
      'C',
    ]);
  });
});

describe('tags', () => {
  it('combines layer with user expression and normalises shorthand', () => {
    expect(combineTagExpr('@ui')).toBe('@ui');
    expect(combineTagExpr('@ui', '@smoke and not @mock')).toBe('(@ui) and (@smoke and not @mock)');
    expect(normalizeTagExpr('smoke,sanity')).toBe('@smoke or @sanity');
    expect(normalizeTagExpr('@smoke and not @wip')).toBe('@smoke and not @wip');
    expect(parseTagValue(['@ui', '@user:admin'], 'user')).toBe('admin');
  });
});

describe('resolveConfig precedence', () => {
  it('project → env yaml → dotenv → process.env → cli, with provenance', () => {
    const { root, proj } = scaffold({ dotenv: { API_TOKEN: 'from-dotenv' } });
    const cfg = resolveConfig({
      rootDir: root,
      projectRoot: proj,
      processEnv: { WHO: 'tests' } as any,
    });
    expect(cfg.env.name).toBe('staging');
    expect(cfg.env.api.auth).toEqual({ type: 'bearer', token: 'from-dotenv' });
    expect(cfg.env.vars.greeting).toBe('hi tests');
    expect(cfg.project.screenshots.onlyOnFailure).toBe(true); // env yaml overrides project section
    expect(cfg.provenance['project.screenshots.onlyOnFailure']).toBe('envYaml');
    expect(cfg.project.browsers).toEqual(['chromium', 'firefox']);
    expect(cfg.runtime.retries).toBe(0);
    expect(cfg.runtime.runId).toMatch(/^[0-9a-f-]{36}$/);

    const viaProcess = resolveConfig({
      rootDir: root,
      projectRoot: proj,
      processEnv: {
        API_TOKEN: 'from-process',
        AUTOMAX_UI_BASE_URL: 'https://override.example.com',
        CI: '1',
      } as any,
    });
    expect(viaProcess.env.api.auth).toEqual({ type: 'bearer', token: 'from-process' });
    expect(viaProcess.env.ui.baseUrl).toBe('https://override.example.com');
    expect(viaProcess.provenance['env.ui.baseUrl']).toBe('processEnv');
    expect(viaProcess.runtime.ci).toBe(true);
    expect(viaProcess.runtime.retries).toBe(2);

    const viaCli = resolveConfig({
      rootDir: root,
      projectRoot: proj,
      processEnv: { API_TOKEN: 't', AUTOMAX_UI_BASE_URL: 'https://override.example.com' } as any,
      cliOverrides: {
        uiBaseUrl: 'https://cli.example.com',
        env: 'local',
        headed: true,
        shard: '2/3',
        retries: 1,
      },
    });
    expect(viaCli.env.name).toBe('local');
    expect(viaCli.env.ui.baseUrl).toBe('https://cli.example.com');
    expect(viaCli.provenance['env.ui.baseUrl']).toBe('cli');
    expect(viaCli.runtime.shard).toEqual({ current: 2, total: 3 });
    expect(viaCli.runtime.headed).toBe(true);
    expect(viaCli.runtime.retries).toBe(1);
  });

  it('reads CLI overrides from AUTOMAX_CLI_OVERRIDES when none are passed', () => {
    const { root, proj } = scaffold();
    const cfg = resolveConfig({
      rootDir: root,
      projectRoot: proj,
      processEnv: {
        API_TOKEN: 't',
        AUTOMAX_CLI_OVERRIDES: serializeCliOverrides({ env: 'local' }),
      } as any,
    });
    expect(cfg.env.name).toBe('local');
  });

  it('fails clearly on unknown env, missing var and secret literal', () => {
    const { root, proj } = scaffold();
    expect(() =>
      resolveConfig({ rootDir: root, projectRoot: proj, env: 'prod', processEnv: {} as any }),
    ).toThrow(/not in envs.available/);
    expect(() =>
      resolveConfig({ rootDir: root, projectRoot: proj, processEnv: {} as any }),
    ).toThrow(/Unresolved variable \$\{API_TOKEN\}/);
    const bad = scaffold({
      envYaml: `ui: { baseUrl: https://x.example.com }\napi: { baseUrl: https://x.example.com, auth: { type: bearer, token: 'literal' } }\n`,
    });
    expect(() =>
      resolveConfig({ rootDir: bad.root, projectRoot: bad.proj, processEnv: {} as any }),
    ).toThrow(/Secret literal/);
  });
});

describe('ProjectRegistry', () => {
  it('discovers projects, lists envs on disk and resolves with memoisation', () => {
    const { root } = scaffold();
    const reg = ProjectRegistry.discover(root);
    expect(reg.list().map((p) => p.slug)).toEqual(['shop']);
    expect(reg.envsOf('shop')).toEqual(['staging', 'local']);
    expect(() => reg.get('nope')).toThrow(/Unknown project/);
    const a = reg.resolve('shop', 'local');
    const b = reg.resolve('shop', 'local');
    expect(a).toBe(b);
    expect(ProjectRegistry.findRepoRoot(join(root, 'projects', 'shop'))).toBe(root);
  });
});
