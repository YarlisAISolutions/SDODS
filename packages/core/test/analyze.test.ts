import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ProjectConfigSchema } from '@automax/contracts';
import { analyzeProject } from '../src/analyze/analyze.js';
import { proposeProject, slugify } from '../src/analyze/propose.js';
import { applyProposal, importPlaywrightSpecs } from '../src/analyze/apply.js';
import { ProjectRegistry } from '../src/config/registry.js';

const APPS = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'apps');

describe('analyzeProject detectors', () => {
  it('detects a Next.js app: routes, api routes, test ids, auth, envs, ci, i18n, a11y, tests', () => {
    const r = analyzeProject(join(APPS, 'next-app'));
    expect(r.packageManager.name).toBe('pnpm');
    expect(r.frameworks.map((f) => f.name)).toContain('Next.js');
    const pages = r.routes
      .filter((x) => x.kind === 'page')
      .map((x) => x.path)
      .sort();
    expect(pages).toEqual(['/', '/cart', '/login', '/products/{id}']);
    const api = r.routes.filter((x) => x.kind === 'api');
    expect(api.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'GET /api/health',
      'POST /api/health',
    ]);
    expect(r.routes.find((x) => x.path === '/products/{id}')?.params).toEqual(['id']);
    expect(r.testIds.attribute).toBe('data-testid');
    expect(r.testIds.counts['data-testid']).toBeGreaterThanOrEqual(8);
    expect(r.auth.strategyGuess).toBe('form');
    expect(r.auth.libraries).toContain('next-auth');
    expect(r.auth.pages).toContain('/login');
    expect(r.envs.find((e) => e.name === 'example')?.apiBaseUrl).toBe(
      'https://api.staging.storefront.example.com',
    );
    expect(r.baseUrls.ui).toBe('http://localhost:3100');
    expect(r.ci.provider).toBe('github');
    expect(r.i18n.libraries).toContain('next-intl');
    expect(r.i18n.locales).toEqual(['de', 'en']);
    expect(r.a11y.tooling).toContain('eslint-plugin-jsx-a11y');
    const pw = r.existingTests.find((t) => t.framework === 'playwright');
    expect(pw?.files).toBe(1);
    expect(pw?.locators.role).toBe(1);
    expect(pw?.locators.testId).toBe(1);
    expect(r.checklist.map((c) => c.id)).toContain('playwright-present');
  });

  it('detects React Router + Cypress + keycloak (sso) + vite port', () => {
    const r = analyzeProject(join(APPS, 'react-router-app'));
    expect(r.packageManager.name).toBe('yarn');
    expect(r.frameworks.map((f) => f.name)).toContain('React Router');
    expect(r.routes.map((x) => x.path).sort()).toEqual([
      '/',
      '/customers',
      '/customers/{customerId}',
      '/settings/profile',
    ]);
    expect(r.testIds.attribute).toBe('data-cy');
    expect(r.auth.strategyGuess).toBe('sso');
    expect(r.baseUrls.ui).toBe('http://localhost:5175');
    const cy = r.existingTests.find((t) => t.framework === 'cypress');
    expect(cy?.locators.css).toBe(2);
    expect(cy?.locators.text).toBe(1);
    expect(r.a11y.tooling).toContain('cypress-axe');
    expect(r.ci.provider).toBe('none');
    expect(r.checklist.some((c) => c.id === 'no-ci')).toBe(true);
    expect(r.checklist.some((c) => c.id === 'fragile-locators-cypress')).toBe(true);
  });

  it('detects an Express API with OpenAPI, jwt auth (token) and fragile Playwright locators', () => {
    const r = analyzeProject(join(APPS, 'express-api'));
    expect(r.packageManager.name).toBe('npm');
    expect(r.frameworks.map((f) => f.name)).toContain('Express');
    expect(r.routes.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'DELETE /orders/{id}',
      'GET /health',
      'GET /orders',
      'GET /orders/{id}',
      'POST /orders',
    ]);
    expect(r.openapi).toHaveLength(1);
    expect(r.openapi[0]!.endpoints.map((e) => `${e.method} ${e.path}`)).toContain(
      'GET /orders/{id}',
    );
    expect(r.openapi[0]!.endpoints.find((e) => e.path === '/health')?.tag).toBe('ops');
    expect(r.auth.strategyGuess).toBe('token');
    expect(r.baseUrls.api).toBe('http://localhost:4010');
    const pw = r.existingTests.find((t) => t.framework === 'playwright');
    expect(pw?.locators.xpath).toBe(1);
    expect(pw?.locators.css).toBeGreaterThanOrEqual(1);
  });

  it('detects Angular routes, data-test attribute, msal (sso), Jenkins and axe', () => {
    const r = analyzeProject(join(APPS, 'angular-app'));
    expect(r.frameworks.map((f) => f.name)).toContain('Angular');
    expect(r.routes.map((x) => x.path).sort()).toEqual(['/', '/login', '/reports/{reportId}']);
    expect(r.testIds.attribute).toBe('data-test');
    expect(r.auth.strategyGuess).toBe('sso');
    expect(r.baseUrls.ui).toBe('http://localhost:4300');
    expect(r.ci.provider).toBe('jenkins');
    expect(r.a11y.tooling).toContain('@axe-core/playwright');
  });

  it('fails clearly for a missing path', () => {
    expect(() => analyzeProject(join(APPS, 'nope'))).toThrow(/Application path not found/);
  });
});

describe('proposeProject', () => {
  it('produces a valid project yaml, envs, modules, starter features and a coverage map', () => {
    const r = analyzeProject(join(APPS, 'next-app'));
    const p = proposeProject(r, { slug: 'storefront' });
    expect(p.slug).toBe('storefront');
    const yamlText = p.projectYaml;
    const cfg = ProjectConfigSchema.parse(parse(yamlText));
    expect(cfg.layers).toEqual(['ui', 'api', 'hybrid', 'recorded']);
    expect(cfg.testIdAttribute).toBe('data-testid');
    expect(cfg.routes).toMatchObject({ home: '/', login: '/login', cart: '/cart' });
    expect(cfg.routes['products-by-id']).toBe('/products/{id}');
    expect(cfg.auth.strategy).toBe('form');
    expect(cfg.auth.form?.loginPath).toBe('/login');
    expect(cfg.modules.map((m) => m.name).sort()).toEqual([
      'cart',
      'health',
      'home',
      'login',
      'products',
    ]);
    expect(cfg.modules.find((m) => m.name === 'health')?.endpoints).toEqual(['/api/health']);
    expect(cfg.modules.find((m) => m.name === 'health')?.layers).toEqual(['api']);
    expect(cfg.modules.find((m) => m.name === 'login')?.testingTypes).toContain('data-driven');
    expect(cfg.envs.default).toBe('local');
    expect(Object.keys(p.envYamls)).toEqual(['local']);
    expect(p.envYamls.local).toContain('baseUrl: http://localhost:3100');
    expect(Object.keys(p.starterFeatures)).toContain('features/login/login.feature');
    expect(p.starterFeatures['features/login/login.feature']).toContain('@ui @login');
    expect(p.starterFeatures['features/login/login.feature']).toContain(
      'Given I navigate to the "login" page',
    );
    expect(p.coverageMap.some((c) => c.kind === 'route' && c.target === 'login')).toBe(true);
    expect(p.coverageMap.some((c) => c.kind === 'endpoint' && c.target === '/api/health')).toBe(
      true,
    );
  });

  it('uses OpenAPI tags as API modules and slugifies names', () => {
    const r = analyzeProject(join(APPS, 'express-api'));
    const p = proposeProject(r);
    expect(p.slug).toBe('express-api');
    const cfg = ProjectConfigSchema.parse(parse(p.projectYaml));
    expect(cfg.layers).toEqual(['api', 'recorded']);
    expect(cfg.modules.map((m) => m.name).sort()).toEqual(['ops', 'orders']);
    expect(cfg.modules.find((m) => m.name === 'orders')?.endpoints).toEqual([
      '/orders',
      '/orders/{id}',
    ]);
    expect(cfg.modules.find((m) => m.name === 'orders')?.testingTypes).toContain('contract');
    expect(p.starterFeatures['features/orders/orders-api.feature']).toContain(
      'When I send a GET request to "/orders/1"',
    );
    expect(slugify('@acme/Store Front!')).toBe('store-front');
  });
});

describe('applyProposal + importPlaywrightSpecs', () => {
  it('writes a project the registry can load and imports specs into recorded/imported', () => {
    const root = mkdtempSync(join(tmpdir(), 'automax-apply-'));
    writeFileSync(join(root, 'package.json'), '{}');
    const app = join(APPS, 'next-app');
    const r = analyzeProject(app);
    const p = proposeProject(r, { slug: 'storefront' });
    const result = applyProposal(p, {
      rootDir: root,
      scaffold: { 'steps/fixtures.ts': '// scaffold', 'features/health.feature': 'dropped' },
      appPath: app,
      importSpecs: true,
    });
    expect(result.written).toContain('automax.project.yaml');
    expect(result.written).toContain('envs/local.yaml');
    expect(result.written).toContain('steps/fixtures.ts');
    expect(result.written).not.toContain('features/health.feature');
    expect(result.importedSpecs).toEqual(['recorded/imported/tests/smoke.spec.ts']);
    expect(
      readFileSync(join(result.root, 'recorded/imported/tests/smoke.spec.ts'), 'utf8'),
    ).toMatch(/^\/\/ @automax-imported/);
    expect(existsSync(join(result.root, 'data/common'))).toBe(true);
    const reg = ProjectRegistry.discover(root);
    expect(reg.get('storefront').modules.length).toBeGreaterThan(0);
    expect(reg.resolve('storefront', 'local', {}, {} as any).env.ui.baseUrl).toBe(
      'http://localhost:3100',
    );
    // second apply without force is refused
    expect(() => applyProposal(p, { rootDir: root })).toThrow(/already exists/);
    expect(importPlaywrightSpecs(join(APPS, 'react-router-app'), result.root)).toEqual([]);
  });
});
