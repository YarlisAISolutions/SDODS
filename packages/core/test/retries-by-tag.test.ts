import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectRegistry } from '../src/config/registry.js';
import { buildRunnerConfig } from '../src/config/runner.js';

/**
 * #84 — `retries.byTag` was accepted by the schema and read by nothing, so a `@flaky` scenario
 * got the project default. bddgen has no hook to inject `@retries:N`, and Playwright has no
 * runtime retries setter, so the mapping is a sibling runner project per tag with `grep` on the
 * tag and its own `retries` (same name, so `--project <name>` and every report keyed on the
 * project name are unchanged).
 */

function workspace(retriesYaml: string) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-retries-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  mkdirSync(join(proj, 'features'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(proj, 'sdods.project.yaml'),
    `slug: shop\nname: Shop\nlayers: [ui, api]\nbrowsers: [chromium]\nenvs: { default: local, available: [local] }\n${retriesYaml}\n`,
  );
  writeFileSync(
    join(proj, 'envs', 'local.yaml'),
    `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n`,
  );
  return root;
}

function projectsFor(retriesYaml: string) {
  const cfg = buildRunnerConfig(ProjectRegistry.discover(workspace(retriesYaml)), { env: 'local' });
  return cfg.projects ?? [];
}

const grepTitle = (tags: string[]) => `shop.feature Feature Scenario ${tags.join(' ')}`;
const matches = (re: unknown, s: string) =>
  (Array.isArray(re) ? re : re ? [re] : []).some((r: RegExp) => new RegExp(r).test(s));

/** Which generated project would run a test with these tags, and with how many retries. */
function routed(projects: ReturnType<typeof projectsFor>, name: string, tags: string[]) {
  const title = grepTitle(tags);
  return projects
    .filter((p) => p.name === name)
    .filter((p) => (p.grep ? matches(p.grep, title) : true) && !matches(p.grepInvert, title))
    .map((p) => p.retries);
}

describe('#84 — retries.byTag reaches the runner', () => {
  it('without byTag the projects are exactly what they were', () => {
    const projects = projectsFor('retries: { ci: 2, local: 0 }');
    expect(projects.map((p) => p.name).sort()).toEqual(['shop--api', 'shop--ui--chromium']);
    expect(projects.every((p) => p.grep === undefined && p.retries === undefined)).toBe(true);
  });

  it('a tagged scenario runs in exactly one project, with the tag retries', () => {
    const projects = projectsFor(`retries: { ci: 2, local: 0, byTag: { '@flaky': 2 } }`);
    for (const name of ['shop--api', 'shop--ui--chromium']) {
      expect(routed(projects, name, ['@api', '@flaky'])).toEqual([2]);
      // Untagged, and a tag that merely starts with the same letters: the base project only.
      expect(routed(projects, name, ['@api', '@smoke'])).toEqual([undefined]);
      expect(routed(projects, name, ['@api', '@flakyish'])).toEqual([undefined]);
    }
  });

  it('a scenario with two byTag tags gets the larger retry count, once', () => {
    const projects = projectsFor(
      `retries: { byTag: { '@network': 1, flaky: 3, '@user:admin': 2 } }`,
    );
    expect(routed(projects, 'shop--api', ['@network', '@flaky'])).toEqual([3]);
    expect(routed(projects, 'shop--api', ['@network', '@user:admin'])).toEqual([2]);
    expect(routed(projects, 'shop--api', ['@network'])).toEqual([1]);
  });

  it('Playwright itself retries the tagged test (real run)', () => {
    const projects = projectsFor(`retries: { ci: 0, local: 0, byTag: { '@flaky': 2 } }`).filter(
      (p) => p.name === 'shop--api',
    );
    const dir = mkdtempSync(join(tmpdir(), 'sdods-retries-run-'));
    const require_ = createRequire(import.meta.url);
    // The CLI and the spec must load the SAME @playwright/test copy, or test() refuses to register.
    const pwDir = dirname(require_.resolve('@playwright/test/package.json'));
    const pwTest = join(pwDir, 'index.js');
    const cli = join(pwDir, 'cli.js');
    writeFileSync(
      join(dir, 'retry.spec.cjs'),
      `const { test, expect } = require(${JSON.stringify(pwTest)});\n` +
        `test('always fails, flaky', { tag: ['@api', '@flaky'] }, () => { expect(1).toBe(2); });\n` +
        `test('always fails, plain', { tag: ['@api', '@smoke'] }, () => { expect(1).toBe(2); });\n`,
    );
    const re = (r: unknown) =>
      r === undefined
        ? 'undefined'
        : `[${(Array.isArray(r) ? r : [r]).map((x: RegExp) => `new RegExp(${JSON.stringify(x.source)}, ${JSON.stringify(x.flags)})`).join(', ')}]`;
    writeFileSync(
      join(dir, 'playwright.config.mjs'),
      `export default { retries: 0, reporter: [['json', { outputFile: ${JSON.stringify(join(dir, 'out.json'))} }]], projects: [\n` +
        projects
          .map(
            (p) =>
              `{ name: ${JSON.stringify(p.name)}, testDir: ${JSON.stringify(dir)}, testMatch: '**/*.spec.cjs', retries: ${p.retries ?? 'undefined'}, grep: ${re(p.grep)}, grepInvert: ${re(p.grepInvert)} }`,
          )
          .join(',\n') +
        `] };\n`,
    );
    const run = spawnSync(
      process.execPath,
      [cli, 'test', '-c', join(dir, 'playwright.config.mjs'), '--project', 'shop--api'],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '' } },
    );
    const report = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
    const runs: Record<string, number> = {};
    const walk = (s: any) => {
      for (const spec of s.specs ?? [])
        for (const t of spec.tests) runs[spec.title] = (runs[spec.title] ?? 0) + t.results.length;
      for (const c of s.suites ?? []) walk(c);
    };
    for (const s of report.suites) walk(s);
    expect(runs, run.stdout + run.stderr).toEqual({
      'always fails, flaky': 3,
      'always fails, plain': 1,
    });
  });
});
