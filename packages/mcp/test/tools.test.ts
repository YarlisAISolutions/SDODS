import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProposalStore, simpleDiff } from '../src/proposals.js';
import { basicTagCheck, parseGherkin, similarity } from '../src/tools/feature.js';
import { nextCronTimes } from '../src/tools/issue-schedule.js';
import {
  analyzeApp,
  analyzeBestPractices,
  analyzeCoverage,
  analyzeLocators,
} from '../src/tools/analyze.js';
import { parseCliError, parseJsonOutput } from '../src/cli.js';
import { maskRows, resolveDatasetFile } from '../src/tools/data.js';

const FEATURE = `@ui @smoke @auth
Feature: Login
  Background:
    Given I am on the login page
  Scenario: Happy path
    When I login with "standard_user" and "secret_sauce"
    Then the page URL should contain "/inventory.html"
  @regression
  Scenario Outline: Failures
    When I login with "<u>" and "<p>"
    Then I should see the login error "<e>"
    Examples:
      | u | p | e |
      | a | b | c |
      | d | e | f |
`;

describe('gherkin parsing and tag checks', () => {
  it('parses features, inherits tags and counts example rows', () => {
    const p = parseGherkin(FEATURE, 'features/auth/login.feature');
    expect(p.errors).toEqual([]);
    expect(p.name).toBe('Login');
    expect(p.tags).toEqual(['@ui', '@smoke', '@auth']);
    expect(p.background?.steps).toEqual(['Given I am on the login page']);
    expect(p.scenarios).toHaveLength(2);
    expect(p.scenarios[1]!.tags).toContain('@regression');
    expect(p.scenarios[1]!.examplesRows).toBe(2);
    expect(basicTagCheck(p, ['@smoke', '@regression', '@sanity'])).toEqual([
      expect.stringContaining('exactly one suite tag'),
    ]); // outline has @smoke+@regression
    const bad = parseGherkin('Feature: x\n  Scenario: y\n    Given z\n', 'x.feature');
    expect(basicTagCheck(bad, ['@smoke'])).toHaveLength(2);
    expect(
      parseGherkin('Scenario: no feature keyword\n  Given z\n', 'b.feature').errors.length,
    ).toBeGreaterThan(0);
  });

  it('fuzzy-matches step phrases', () => {
    expect(
      similarity('I send a GET request to "/posts"', 'I send a {method} request to {string}'),
    ).toBeGreaterThan(0.5);
    expect(
      similarity('I click the login button', 'the response status should be {int}'),
    ).toBeLessThan(0.3);
  });
});

describe('proposals', () => {
  it('creates, diffs, accepts into a target root and rejects', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdods-prop-'));
    mkdirSync(join(root, 'projects', 'shop', 'features'), { recursive: true });
    writeFileSync(join(root, 'projects', 'shop', 'features', 'a.feature'), 'Feature: old\n');
    const store = new ProposalStore(root);
    const m = store.create({
      role: 'generator',
      project: 'shop',
      summary: 'add b, change a',
      files: [
        { path: 'projects/shop/features/b.feature', content: 'Feature: new\n' },
        { path: 'projects/shop/features/a.feature', content: 'Feature: changed\n' },
      ],
    });
    expect(m.status).toBe('pending');
    expect(m.files.map((f) => f.op)).toEqual(['add', 'modify']);
    const diff = store.diff(m.id);
    expect(diff).toContain('+Feature: new');
    expect(diff).toContain('-Feature: old');
    expect(store.list({ status: 'pending' })).toHaveLength(1);
    const target = mkdtempSync(join(tmpdir(), 'sdods-target-'));
    const written = store.accept(m.id, { targetRoot: target, reviewedBy: 'tester' });
    expect(written).toHaveLength(2);
    expect(readFileSync(join(target, 'projects/shop/features/b.feature'), 'utf8')).toBe(
      'Feature: new\n',
    );
    expect(store.get(m.id)?.status).toBe('accepted');
    expect(() =>
      store.create({ role: 'x', summary: 's', files: [{ path: '../escape.txt', content: 'x' }] }),
    ).toThrow(/escapes/);
    const r = store.create({ role: 'reviewer', summary: 'r', files: [] });
    expect(store.reject(r.id, 'nope').status).toBe('rejected');
    expect(simpleDiff('a\nb\nc', 'a\nc\nd')).toBe(' a\n-b\n c\n+d');
  });
});

describe('cron preview', () => {
  it('computes next fire times', () => {
    const from = new Date('2026-09-03T10:30:00Z');
    expect(nextCronTimes('0 2 * * *', 2, 'UTC', from)).toEqual([
      '2026-09-04T02:00:00.000Z',
      '2026-09-05T02:00:00.000Z',
    ]);
    expect(nextCronTimes('*/15 * * * *', 2, 'UTC', from)).toEqual([
      '2026-09-03T10:45:00.000Z',
      '2026-09-03T11:00:00.000Z',
    ]);
    expect(nextCronTimes('0 9 * * 1', 1, 'America/New_York', from)[0]).toBe(
      '2026-09-07T13:00:00.000Z',
    );
    expect(() => nextCronTimes('bad', 1, 'UTC')).toThrow(/5 cron fields/);
  });
});

describe('cli output parsing', () => {
  it('extracts JSON after log noise and structured errors', () => {
    expect(parseJsonOutput('[INFO] hello\n{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonOutput('[1,2]')).toEqual([1, 2]);
    expect(
      parseCliError('{"error":{"code":"NOT_SUPPORTED","message":"nope","hint":"later"}}\n', '', 2),
    ).toEqual({ code: 'NOT_SUPPORTED', message: 'nope', hint: 'later' });
    expect(parseCliError('✖ CONFIG_INVALID: bad yaml', '', 2)).toEqual({
      code: 'CONFIG_INVALID',
      message: 'bad yaml',
    });
  });
});

describe('data helpers', () => {
  it('masks secret columns and resolves the fallback chain', () => {
    expect(maskRows([{ username: 'a', password: 'x', role: 'r' }])).toEqual([
      { username: 'a', password: '***', role: 'r' },
    ]);
    const root = mkdtempSync(join(tmpdir(), 'sdods-data-'));
    mkdirSync(join(root, 'data', 'common'), { recursive: true });
    mkdirSync(join(root, 'data', 'staging'), { recursive: true });
    writeFileSync(join(root, 'data', 'common', 'users.csv'), 'id\n1\n');
    expect(
      resolveDatasetFile(
        root,
        { path: 'data/{env}/users.csv', fallback: 'data/common/users.csv' },
        'staging',
      ),
    ).toBe(join(root, 'data/common/users.csv'));
    writeFileSync(join(root, 'data', 'staging', 'users.csv'), 'id\n2\n');
    expect(resolveDatasetFile(root, { path: 'data/{env}/users.csv' }, 'staging')).toBe(
      join(root, 'data/staging/users.csv'),
    );
  });
});

describe('analysis heuristics', () => {
  it('detects framework, routes, test ids and proposes a project', () => {
    const app = mkdtempSync(join(tmpdir(), 'sdods-app-'));
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({
        name: '@acme/shop-web',
        dependencies: { react: '19', 'react-router': '7', express: '5' },
        devDependencies: { '@playwright/test': '1' },
      }),
    );
    mkdirSync(join(app, 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(app, 'src', 'routes', 'index.tsx'),
      `const routes = [{ path: '/', el: 1 }, { path: '/cart', el: 2 }, { path: '/orders/:id', el: 3 }];\n<button data-testid="checkout">x</button><div data-testid="a"/>`,
    );
    writeFileSync(
      join(app, 'src', 'server.ts'),
      `app.get('/api/orders', h); app.post('/api/orders', h);`,
    );
    writeFileSync(join(app, 'openapi.yaml'), 'openapi: 3.1.0');
    writeFileSync(
      join(app, '.env.example'),
      'API_URL=https://api.acme.test\nAPP_URL=https://shop.acme.test',
    );
    const a = analyzeApp(app) as any;
    expect(a.frameworks.map((f: any) => f.finding)).toEqual(
      expect.arrayContaining(['react', 'express']),
    );
    expect(a.routes.map((r: any) => r.path)).toEqual(
      expect.arrayContaining(['/', '/cart', '/api/orders']),
    );
    expect(a.testIdAttribute).toBe('data-testid');
    expect(a.openapi).toEqual(['openapi.yaml']);
    expect(a.proposal.slug).toBe('shop-web');
    expect(a.proposal.layers).toEqual(expect.arrayContaining(['ui', 'api']));
    expect(a.proposal.env.local.ui.baseUrl).toBe('https://shop.acme.test');
    expect(a.checklist.find((c: any) => c.check === 'OpenAPI spec available').ok).toBe(true);
  });

  it('computes coverage, best practices and locator scores for a project dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdods-proj-'));
    mkdirSync(join(root, 'features', 'auth'), { recursive: true });
    mkdirSync(join(root, 'pages'), { recursive: true });
    writeFileSync(
      join(root, 'sdods.project.yaml'),
      'slug: p\nroutes: { login: /, inventory: /inventory.html, cart: /cart.html }\nmodules:\n  - { name: auth, endpoints: ["GET /users"] }\n',
    );
    writeFileSync(
      join(root, 'features', 'auth', 'login.feature'),
      FEATURE.replace('@ui @smoke @auth', '@ui @smoke @auth') +
        '\n  Scenario: Nav\n    Given I navigate to the "inventory" page\n    Then I wait for 5 seconds\n',
    );
    writeFileSync(
      join(root, 'pages', 'LoginPage.ts'),
      [
        `const a = page.locator('#user');`,
        `const b = this.heal.locator(page.locator('#x'), {});`,
        `const c = page.getByRole('button');`,
        `const d = page.locator('//div');`,
      ].join('\n'),
    );
    const cov = analyzeCoverage(root);
    expect(cov.routes.find((r) => r.route === 'inventory')?.scenarios).toBe(2); // by route name and by path
    expect(cov.uncoveredRoutes).toEqual(['login', 'cart']);
    expect(cov.modules[0]).toEqual({ module: 'auth', features: 1, scenarios: 3 });
    const bp = analyzeBestPractices(root);
    expect(bp.findings.some((f) => f.rule === 'sleep')).toBe(true);
    expect(bp.findings.some((f) => f.rule === 'xpath-locator')).toBe(true);
    expect(bp.findings.some((f) => f.rule === 'coverage-a11y')).toBe(true);
    const loc = analyzeLocators(root);
    expect(loc.byKind).toEqual({ css: 2, role: 1, xpath: 1 });
    expect(loc.fragile).toHaveLength(2);
  });
});
