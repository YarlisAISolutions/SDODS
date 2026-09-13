import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRunnerProjectName, runnerProjectName } from '@sdods/contracts';
import { deepMerge, coerceEnvValue, setPath, getAtPath } from '../src/config/merge.js';
import { assertNoSecretLiterals, collectVarRefs, interpolate } from '../src/config/interpolate.js';
import { combineTagExpr, normalizeTagExpr, parseTagValue } from '../src/config/tags.js';
import { resolveConfig, serializeCliOverrides } from '../src/config/resolve.js';
import { ProjectRegistry } from '../src/config/registry.js';
import { buildRunnerConfig } from '../src/config/runner.js';

function scaffold(
  opts: { projectYaml?: string; envYaml?: string; dotenv?: Record<string, string> } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-cfg-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(proj, 'sdods.project.yaml'),
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
        SDODS_UI_BASE_URL: 'https://override.example.com',
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
      processEnv: { API_TOKEN: 't', SDODS_UI_BASE_URL: 'https://override.example.com' } as any,
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

  it('reads CLI overrides from SDODS_CLI_OVERRIDES when none are passed', () => {
    const { root, proj } = scaffold();
    const cfg = resolveConfig({
      rootDir: root,
      projectRoot: proj,
      processEnv: {
        API_TOKEN: 't',
        SDODS_CLI_OVERRIDES: serializeCliOverrides({ env: 'local' }),
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

describe('buildRunnerConfig headed', () => {
  // SDODS_HEADED and --headed used to resolve onto runtime.headed and then be dropped on the
  // floor: nothing emitted `headless`, so a "headed" run still opened no window.
  it('emits headless from runtime.headed', () => {
    const { root, proj } = scaffold();
    mkdirSync(join(proj, 'features'), { recursive: true }); // defineBddConfig validates featuresRoot
    const prev = process.env.SDODS_HEADED;
    try {
      delete process.env.SDODS_HEADED;
      expect(
        buildRunnerConfig(ProjectRegistry.discover(root), { env: 'local' }).use?.headless,
      ).toBe(true);

      process.env.SDODS_HEADED = '1';
      expect(
        buildRunnerConfig(ProjectRegistry.discover(root), { env: 'local' }).use?.headless,
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.SDODS_HEADED;
      else process.env.SDODS_HEADED = prev;
    }
  });
});

describe('buildRunnerConfig browsers and channels', () => {
  // `devices['Desktop Edge']` sets an Edge user-agent but leaves defaultBrowserType at 'chromium',
  // so without an explicit channel an "edge" target launches bundled Chromium that merely claims
  // to be Edge — green, and meaningless. These lock the channel in.
  function targets(projectYaml: string, browsers?: string[]) {
    const { root, proj } = scaffold({ projectYaml });
    mkdirSync(join(proj, 'features'), { recursive: true });
    const cfg = buildRunnerConfig(ProjectRegistry.discover(root), { env: 'local', browsers });
    return Object.fromEntries(
      (cfg.projects ?? []).map((p) => [
        String(p.name),
        (p.use as Record<string, unknown>)?.channel,
      ]),
    );
  }
  const yaml = (browsers: string, channel = '') =>
    `slug: shop\nname: Shop\nlayers: [ui]\nbrowsers: [${browsers}]\n${channel ? `channel: ${channel}\n` : ''}envs: { default: staging, available: [staging, local] }\n`;

  it('gives the edge target the msedge channel and leaves chromium alone', () => {
    const t = targets(yaml('chromium, edge'));
    expect(t['shop--ui--edge']).toBe('msedge');
    expect(t['shop--ui--chromium']).toBeUndefined();
  });

  it('ignores a project channel from another family rather than retargeting edge', () => {
    // `channel: chrome` must not make the --edge target launch Google Chrome: that would put one
    // browser in the results under another browser's name.
    const t = targets(yaml('chromium, edge', 'chrome'));
    expect(t['shop--ui--edge']).toBe('msedge');
    expect(t['shop--ui--chromium']).toBe('chrome');
  });

  it('lets a same-family project channel refine edge', () => {
    expect(targets(yaml('edge', 'msedge-beta'))['shop--ui--edge']).toBe('msedge-beta');
  });

  it('still applies a project channel to chromium', () => {
    expect(targets(yaml('chromium', 'chrome'))['shop--ui--chromium']).toBe('chrome');
  });

  it('leaves non-chromium engines without a channel', () => {
    const t = targets(yaml('firefox, webkit', 'chrome'));
    expect(t['shop--ui--firefox']).toBeUndefined();
    expect(t['shop--ui--webkit']).toBeUndefined();
  });
});

describe('buildRunnerConfig evidence, parallelism and setup (#83)', () => {
  // `fullyParallel: true` and `use: { screenshot: 'off', video: 'retain-on-failure',
  // trace: 'on-first-retry' }` were literals in buildRunnerConfig. With `retries.local: 0` that meant
  // no trace locally, ever, and no project could run its files in order or gate on a login first.
  const base = (extra = '') =>
    `slug: shop\nname: Shop\nlayers: [ui, api]\nbrowsers: [chromium, firefox]\nenvs: { default: staging, available: [staging, local] }\n${extra}`;

  function build(
    projectYaml: string,
    opts: { localYaml?: string; sel?: Record<string, unknown>; env?: Record<string, string> } = {},
  ) {
    const { root, proj } = scaffold({ projectYaml });
    if (opts.localYaml)
      writeFileSync(
        join(proj, 'envs', 'local.yaml'),
        `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n${opts.localYaml}`,
      );
    mkdirSync(join(proj, 'features'), { recursive: true });
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      return buildRunnerConfig(ProjectRegistry.discover(root), { env: 'local', ...opts.sel });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }
  const byName = (cfg: ReturnType<typeof buildRunnerConfig>) =>
    Object.fromEntries((cfg.projects ?? []).map((p) => [String(p.name), p]));
  const evidenceOf = (p: { use?: unknown }) => {
    const u = p.use as Record<string, unknown>;
    return { screenshot: u.screenshot, video: u.video, trace: u.trace };
  };

  it('keeps the previous defaults when nothing is configured', () => {
    const cfg = build(base());
    expect(cfg.fullyParallel).toBe(true);
    expect(cfg.use).toMatchObject({
      screenshot: 'off',
      video: 'retain-on-failure',
      trace: 'on-first-retry',
    });
    for (const p of cfg.projects ?? []) {
      expect(evidenceOf(p)).toEqual({
        screenshot: 'off',
        video: 'retain-on-failure',
        trace: 'on-first-retry',
      });
      expect(p.fullyParallel).toBe(true);
      expect(p.dependencies ?? []).toEqual([]);
    }
  });

  it('takes evidence modes from sdods.project.yaml', () => {
    const cfg = build(base('evidence: { trace: on, video: off, screenshot: only-on-failure }\n'));
    expect(evidenceOf(byName(cfg)['shop--ui--chromium']!)).toEqual({
      screenshot: 'only-on-failure',
      video: 'off',
      trace: 'on',
    });
    expect(evidenceOf(byName(cfg)['shop--api']!).trace).toBe('on');
    expect(cfg.use).toMatchObject({ trace: 'on', video: 'off', screenshot: 'only-on-failure' });
  });

  it('lets envs/<env>.yaml override single evidence keys', () => {
    const cfg = build(base('evidence: { trace: on, video: off }\n'), {
      localYaml: 'evidence: { trace: retain-on-failure }\n',
    });
    expect(evidenceOf(byName(cfg)['shop--ui--firefox']!)).toEqual({
      screenshot: 'off',
      video: 'off',
      trace: 'retain-on-failure',
    });
  });

  it('rejects modes Playwright does not accept', () => {
    expect(() => build(base('evidence: { trace: sometimes }\n'))).toThrow(/evidence\.trace/);
    expect(() => build(base(), { localYaml: 'evidence: { video: always }\n' })).toThrow(
      /evidence\.video/,
    );
  });

  it('lets the CLI (--trace/--video) and SDODS_TRACE win over the yaml', () => {
    const { root, proj } = scaffold({ projectYaml: base('evidence: { trace: off }\n') });
    const viaCli = resolveConfig({
      rootDir: root,
      projectRoot: proj,
      env: 'local',
      cliOverrides: { trace: 'on', video: 'on' },
      processEnv: {} as any,
    });
    expect(viaCli.project.evidence).toMatchObject({ trace: 'on', video: 'on' });
    expect(viaCli.provenance['project.evidence.trace']).toBe('cli');

    const viaEnv = build(base('evidence: { trace: off }\n'), { env: { SDODS_TRACE: 'on' } });
    expect(evidenceOf(byName(viaEnv)['shop--api']!).trace).toBe('on');
  });

  it('takes fullyParallel from the project, and a process overrides it', () => {
    const serial = build(base('fullyParallel: false\n'));
    expect(serial.fullyParallel).toBe(false);
    for (const p of serial.projects ?? []) expect(p.fullyParallel).toBe(false);

    const withProcess = base(
      'processes:\n  - { name: release-gate, fullyParallel: false }\n  - { name: pr-check }\n',
    );
    const gate = build(withProcess, { sel: { project: 'shop', process: 'release-gate' } });
    for (const p of gate.projects ?? []) expect(p.fullyParallel).toBe(false);
    const pr = build(withProcess, { sel: { project: 'shop', process: 'pr-check' } });
    for (const p of pr.projects ?? []) expect(p.fullyParallel).toBe(true);
  });

  it('turns setup: { tags } into setup run targets every other target depends on', () => {
    const cfg = build(base('setup: { tags: "@setup" }\n'));
    const p = byName(cfg);
    expect(Object.keys(p).sort()).toEqual([
      'shop--api',
      'shop--api--setup',
      'shop--ui--chromium',
      'shop--ui--chromium--setup',
      'shop--ui--firefox',
      'shop--ui--firefox--setup',
    ]);
    expect(p['shop--ui--chromium']!.dependencies).toEqual(['shop--ui--chromium--setup']);
    expect(p['shop--ui--firefox']!.dependencies).toEqual(['shop--ui--firefox--setup']);
    expect(p['shop--api']!.dependencies).toEqual(['shop--api--setup']);
    expect(p['shop--ui--chromium--setup']!.dependencies ?? []).toEqual([]);
    // The setup scenarios are generated apart from the rest, so they neither run twice nor fall
    // out of the selection when --tags does not match them.
    expect(p['shop--ui--chromium--setup']!.testDir).not.toBe(p['shop--ui--chromium']!.testDir);
    // A setup target launches the same browser as the target it gates.
    expect((p['shop--ui--firefox--setup']!.use as any).defaultBrowserType).toBe('firefox');
  });

  it('lets a process choose its own setup tags or none', () => {
    const yaml = base(
      'setup: { tags: "@setup" }\nprocesses:\n  - { name: quick, setup: false }\n  - { name: gate, setup: { tags: "@probe or @auth" } }\n',
    );
    const quick = byName(build(yaml, { sel: { project: 'shop', process: 'quick' } }));
    expect(Object.keys(quick).some((n) => n.endsWith('--setup'))).toBe(false);
    const gate = byName(build(yaml, { sel: { project: 'shop', process: 'gate' } }));
    expect(gate['shop--api']!.dependencies).toEqual(['shop--api--setup']);
  });

  it('names setup targets so reports still read their layer and browser', () => {
    // Dashboard, ingest and scenario identity all parse the target name; a setup target must keep
    // resolving to its real layer and browser rather than to null or a browser called "setup".
    expect(parseRunnerProjectName('shop--ui--chromium--setup')).toEqual({
      project: 'shop',
      layer: 'ui',
      browser: 'chromium',
      phase: 'setup',
    });
    expect(parseRunnerProjectName('shop--api--setup')).toEqual({
      project: 'shop',
      layer: 'api',
      phase: 'setup',
    });
    expect(parseRunnerProjectName('shop--ui--chromium')).toEqual({
      project: 'shop',
      layer: 'ui',
      browser: 'chromium',
    });
    expect(runnerProjectName({ project: 'shop', layer: 'api', phase: 'setup' })).toBe(
      'shop--api--setup',
    );
  });
});
