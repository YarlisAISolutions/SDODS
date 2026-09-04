import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeCoverage, parseFeatures, pomRouteSteps } from '../src/analyze/coverage.js';
import { ProjectRegistry } from '../src/config/registry.js';

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'automax-cov-'));
  writeFileSync(join(root, 'package.json'), '{}');
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  mkdirSync(join(proj, 'features', 'auth'), { recursive: true });
  mkdirSync(join(proj, 'features', 'api'), { recursive: true });
  mkdirSync(join(proj, 'pages'), { recursive: true });
  writeFileSync(
    join(proj, 'automax.project.yaml'),
    `slug: shop
name: Shop
layers: [ui, api]
routes: { login: /, inventory: /inventory.html, cart: /cart.html, checkout: /checkout.html }
tags: { suites: [smoke, regression], roles: [standard, admin] }
envs: { default: local, available: [local] }
modules:
  - { name: auth, routes: [login] }
  - { name: inventory, routes: [inventory, cart] }
  - { name: checkout, routes: [checkout] }
  - { name: posts, endpoints: ['/posts', '/posts/{id}', '/posts/{id}/comments'] }
  - { name: users, endpoints: ['/users/{id}'] }
`,
  );
  writeFileSync(
    join(proj, 'envs', 'local.yaml'),
    `ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api, openapi: openapi.yaml }\n`,
  );
  writeFileSync(
    join(proj, 'openapi.yaml'),
    `openapi: 3.0.0\ninfo: { title: t, version: '1' }\npaths:\n  /posts: { get: { responses: {} } }\n  /albums/{id}: { get: { responses: {} } }\n`,
  );
  writeFileSync(
    join(proj, 'pages', 'LoginPage.ts'),
    `export class LoginPage {
  @Given('I am on the login page')
  async open() {
    await this.goto('login');
  }
  @When('I login with {string} and {string}')
  async login(u: string, p: string) {
    await this.fill(u, p);
  }
}
`,
  );
  writeFileSync(
    join(proj, 'features', 'auth', 'login.feature'),
    `@ui @auth
Feature: Login
  Background:
    Given I am on the login page

  @smoke @user:standard
  Scenario: Login works
    When I login with "a" and "b"
    Then I should be on the inventory page

  @regression
  Scenario Outline: Failed login <who>
    When I login with "<who>" and "x"
    Examples:
      | who |
      | u1  |
      | u2  |
`,
  );
  writeFileSync(
    join(proj, 'features', 'api', 'posts.feature'),
    `@api @posts
Feature: Posts
  @smoke
  Scenario: List and detail
    When I send a GET request to "/posts"
    And I send a GET request to "http://localhost:3000/api/posts/1?x=1"
    Then the response status should be 200

  @regression
  Scenario: Hybrid-ish
    Given I use a leased user with role "admin"
    When I seed via POST "/posts" with body:
      """
      {}
      """
    And I navigate to the "cart" page
`,
  );
  return root;
}

describe('coverage', () => {
  it('parses features into pickles with effective tags and suites', () => {
    const root = fixtureRepo();
    const pickles = parseFeatures(join(root, 'projects', 'shop'), ['@smoke', '@regression']);
    expect(pickles).toHaveLength(5); // 1 + 2 outline rows + 2 api
    const login = pickles.find((p) => p.scenario === 'Login works')!;
    expect(login.tags).toEqual(
      expect.arrayContaining(['@ui', '@auth', '@smoke', '@user:standard']),
    );
    expect(login.suite).toBe('@smoke');
    expect(login.steps[0]).toBe('I am on the login page'); // background included
  });

  it('maps decorator steps that call goto() to routes', () => {
    const root = fixtureRepo();
    const steps = pomRouteSteps(join(root, 'projects', 'shop'));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.route).toBe('login');
    expect(steps[0]!.re.test('I am on the login page')).toBe(true);
  });

  it('computes route/endpoint/role coverage by suite, including OpenAPI endpoints', () => {
    const root = fixtureRepo();
    const reg = ProjectRegistry.discover(root);
    const report = computeCoverage(reg, 'shop', { openapi: true, env: 'local' }); // explicit: CI may export AUTOMAX_ENV

    const route = (n: string) => report.routes.find((r) => r.name === n)!;
    expect(route('login').covered).toBe(true);
    expect(route('login').bySuite).toEqual({ '@smoke': 1, '@regression': 2 });
    expect(route('inventory').covered).toBe(true); // "I should be on the inventory page"
    expect(route('cart').covered).toBe(true); // hybrid step navigate
    expect(route('checkout').covered).toBe(false);
    expect(route('inventory').module).toBe('inventory');

    const ep = (n: string) => report.endpoints.find((r) => r.name === n)!;
    expect(ep('/posts').covered).toBe(true);
    expect(ep('/posts').bySuite).toEqual({ '@smoke': 1, '@regression': 1 }); // GET + seed POST
    expect(ep('/posts/{id}').covered).toBe(true); // absolute URL with query, base stripped
    expect(ep('/posts/{id}/comments').covered).toBe(false);
    expect(ep('/users/{id}').covered).toBe(false);
    expect(ep('/albums/{id}')).toBeDefined(); // from OpenAPI
    expect(ep('/albums/{id}').covered).toBe(false);

    const role = (n: string) => report.roles.find((r) => r.name === n)!;
    expect(role('standard').covered).toBe(true); // @user: tag
    expect(role('admin').covered).toBe(true); // leased user step

    expect(report.summary.routes).toEqual({ covered: 3, total: 4 });
    expect(report.summary.endpoints).toEqual({ covered: 2, total: 5 });
    expect(report.summary.roles).toEqual({ covered: 2, total: 2 });
    expect(report.summary.scenarios).toBe(5);
    expect(report.summary.bySuite).toEqual({ '@smoke': 2, '@regression': 3 });
    expect(report.summary.uncoveredModules).toEqual(['checkout', 'users']);
  });
});
