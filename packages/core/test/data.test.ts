import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataPath } from '../src/data/resolve-path.js';
import { FileLeaseStore, FileUserPool } from '../src/data/user-pool.js';
import { CompositeDataProvider } from '../src/data/provider.js';
import { resolvePolicy } from '../src/shots/policy.js';
import { getPath, coerce } from '../src/api/json-path.js';
import { render, renderJson } from '../src/api/template.js';
import { resolveConfig } from '../src/config/resolve.js';
import { parseFeatureFile, scenariosOf } from '../src/lint/gherkin.js';
import { lintProject } from '../src/lint/index.js';

function project(opts: { yaml?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'automax-data-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  mkdirSync(join(proj, 'data', 'common'), { recursive: true });
  mkdirSync(join(proj, 'data', 'staging'), { recursive: true });
  mkdirSync(join(proj, 'features', 'auth'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(proj, 'automax.project.yaml'),
    opts.yaml ??
      `slug: shop
name: Shop
layers: [ui, api]
envs: { default: staging, available: [staging] }
tags: { suites: [smoke, regression], roles: [standard, admin] }
modules:
  - { name: auth, tags: ['@auth'] }
data:
  sources:
    users: { type: csv, path: 'data/{env}/users.csv', fallback: data/common/users.csv }
    products: { type: json, path: data/common/products.json }
  userPool: { dataset: users, roleColumn: role, leaseTtlMs: 60000 }
screenshots: { policy: { default: on-failure, '@smoke': scenario, '@regression': step, '@visual': visual } }
`,
  );
  writeFileSync(
    join(proj, 'envs', 'staging.yaml'),
    `ui: { baseUrl: https://s.example.com }\napi: { baseUrl: https://api.example.com }\nusers: { poolSize: 3 }\nvars: { greeting: hello }\n`,
  );
  writeFileSync(
    join(proj, 'data', 'common', 'users.csv'),
    `id,username,password,role\n1,u1,\${PW:-pw1},standard\n2,u2,pw2,standard\n3,a1,pw3,admin\n4,u4,pw4,standard\n`,
  );
  writeFileSync(
    join(proj, 'data', 'common', 'products.json'),
    JSON.stringify([{ id: 1, name: 'Backpack' }]),
  );
  const cfg = resolveConfig({
    rootDir: root,
    projectRoot: proj,
    processEnv: {} as any,
    cliOverrides: { runId: 'run-1', artifactsDir: join(root, '.automax/runs') },
  });
  return { root, proj, cfg };
}

describe('resolveDataPath', () => {
  it('prefers env file, then fallback, then common', () => {
    const { proj } = project();
    const spec = {
      type: 'csv' as const,
      path: 'data/{env}/users.csv',
      fallback: 'data/common/users.csv',
    };
    expect(resolveDataPath(proj, spec, 'staging')).toBe(join(proj, 'data', 'common', 'users.csv'));
    writeFileSync(
      join(proj, 'data', 'staging', 'users.csv'),
      'id,username,password,role\n9,s1,x,standard\n',
    );
    expect(resolveDataPath(proj, spec, 'staging')).toBe(join(proj, 'data', 'staging', 'users.csv'));
    expect(() =>
      resolveDataPath(proj, { type: 'csv', path: 'data/{env}/nope.csv' }, 'staging'),
    ).toThrow(/No data file/);
  });
});

describe('CompositeDataProvider', () => {
  it('loads csv with interpolation, json, rows, find, cleanup LIFO', async () => {
    const { cfg } = project();
    const data = new CompositeDataProvider(cfg, { seed: 'abc', vars: { PW: 'secret' } });
    const users = await data.load('users');
    expect(users).toHaveLength(4);
    expect(users[0]).toMatchObject({ id: 1, username: 'u1', password: 'secret', role: 'standard' });
    expect(await data.row('products', 0)).toEqual({ id: 1, name: 'Backpack' });
    expect(await data.find('users', { role: 'admin' })).toMatchObject({ username: 'a1' });
    await expect(data.row('users', 10)).rejects.toThrow(/row 10 does not exist/);
    await expect(data.load('missing')).rejects.toThrow(/not declared/);
    const order: string[] = [];
    data.registerCleanup(async () => void order.push('first'));
    data.registerCleanup(async () => {
      order.push('second');
      throw new Error('boom');
    });
    const errors = await data.runCleanups();
    expect(order).toEqual(['second', 'first']);
    expect(errors).toHaveLength(1);
  });
});

describe('FileUserPool', () => {
  it('leases distinct users per owner, caps by poolSize, expires stale leases', async () => {
    const { cfg, root } = project();
    const store = new FileLeaseStore(join(root, 'leases'));
    const data = new CompositeDataProvider(cfg);
    const a = new FileUserPool(cfg, data, { owner: 'run:0', store, waitMs: 300 });
    const b = new FileUserPool(cfg, data, { owner: 'run:1', store, waitMs: 300 });
    const ua = await a.lease('standard', 0);
    const ub = await b.lease('standard', 1);
    expect(ua.username).not.toBe(ub.username);
    expect(await a.lease('standard', 0)).toBe(ua); // re-entrant per role
    // poolSize 3 → only u1,u2 standard + a1 admin; third standard lease must wait then fail
    const c = new FileUserPool(cfg, data, { owner: 'run:2', store, waitMs: 250 });
    await expect(c.lease('standard', 2)).rejects.toThrow(/leased/);
    await a.releaseAll();
    const uc = await c.lease('standard', 2);
    expect(uc.username).toBe(ua.username);
    await expect(a.lease('nope', 0)).rejects.toThrow(/No users with role/);
    // a stale lease (older than the TTL) left by a crashed worker is reclaimable
    const staleDir = join(root, 'stale-leases');
    const stale = new FileLeaseStore(staleDir);
    writeFileSync(
      join(staleDir, 'x.lock'),
      JSON.stringify({ owner: 'dead-worker', leasedAt: Date.now() - 100_000 }),
    );
    expect(await stale.tryAcquire('x', 'run:9', 5_000)).toBe(true);
    expect(await stale.tryAcquire('x', 'run:10', 5_000)).toBe(false);
    expect((await stale.owners()).x).toBe('run:9');
  });
});

describe('screenshot policy', () => {
  it('resolves by tag specificity and honours onlyOnFailure', () => {
    const { cfg } = project();
    expect(resolvePolicy(['@ui', '@smoke'], cfg).mode).toBe('scenario');
    expect(resolvePolicy(['@ui', '@regression'], cfg)).toMatchObject({
      mode: 'step',
      step: true,
      scenario: true,
    });
    expect(resolvePolicy(['@ui', '@regression', '@visual'], cfg)).toMatchObject({
      mode: 'visual',
      visual: true,
    });
    expect(resolvePolicy(['@api'], cfg).mode).toBe('on-failure');
    const only = {
      ...cfg,
      project: { ...cfg.project, screenshots: { ...cfg.project.screenshots, onlyOnFailure: true } },
    };
    expect(resolvePolicy(['@ui', '@regression', '@visual'], only)).toMatchObject({
      mode: 'on-failure',
      visual: true,
      step: false,
    });
  });
});

describe('json-path and templates', () => {
  it('dotted paths, JSONPath, coercion and rendering', () => {
    const body = { data: { items: [{ id: 1 }, { id: 2 }] }, ok: true };
    expect(getPath(body, 'data.items[1].id')).toBe(2);
    expect(getPath(body, '$.data.items[*].id')).toEqual([1, 2]);
    expect(getPath(body, '$..id')).toEqual([1, 2]);
    expect(coerce('42')).toBe(42);
    expect(coerce('true')).toBe(true);
    expect(coerce('{"a":1}')).toEqual({ a: 1 });
    expect(render('/posts/{{postId}}/{{missing}}', { postId: 7 })).toBe('/posts/7/{{missing}}');
    expect(renderJson('{ "id": {{id}}, "t": "{{t}}" }', { id: 3, t: 'x' })).toEqual({
      id: 3,
      t: 'x',
    });
  });
});

describe('lint', () => {
  it('parses features, enforces layer/suite/module/value tags and outline title-format', async () => {
    const { cfg, proj } = project();
    writeFileSync(
      join(proj, 'features', 'auth', 'login.feature'),
      `@ui @auth\nFeature: Login\n  @smoke\n  Scenario: ok\n    Given x\n  @regression @user:nobody @jira:BAD\n  Scenario Outline: out\n    Given <a>\n    Examples:\n      | a |\n      | 1 |\n`,
    );
    writeFileSync(
      join(proj, 'features', 'orphan.feature'),
      `@api\nFeature: Orphan\n  Scenario: no suite\n    Given x\n`,
    );
    const parsed = parseFeatureFile(join(proj, 'features', 'auth', 'login.feature'));
    expect(scenariosOf(parsed).map((s) => s.name)).toEqual(['ok', 'out']);
    const result = await lintProject({ project: cfg.project });
    const rules = [...result.errors, ...result.warnings].map((f) => f.rule);
    expect(rules).toContain('tags/user');
    expect(rules).toContain('tags/jira');
    expect(rules).toContain('tags/suite');
    expect(rules).toContain('module/unassigned');
    expect(rules).toContain('outline/title-format');
    expect(result.errors.filter((e) => e.rule === 'tags/layer')).toHaveLength(0);
  });
});
