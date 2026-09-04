import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { AnalysisReport, ChecklistItem } from '@automax/contracts';
import { AutomaxError } from '../errors.js';
import {
  detectA11y,
  detectAuth,
  detectCi,
  detectEnvs,
  detectExistingTests,
  detectFrameworks,
  detectI18n,
  detectOpenApi,
  detectPackageManager,
  detectRoutes,
  detectTestIds,
} from './detectors.js';
import { Scan, type ScanOptions } from './scan.js';

export interface AnalyzeOptions extends ScanOptions {
  /** explicit OpenAPI spec path (relative to appPath) */
  openapi?: string;
}

/** Read-only analysis of an application repository. Never writes. */
export function analyzeProject(appPath: string, opts: AnalyzeOptions = {}): AnalysisReport {
  const root = resolvePath(appPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new AutomaxError('CONFIG_NOT_FOUND', `Application path not found: ${root}`, {
      hint: 'Pass the root of the application repository, e.g. `automax analyze ../my-app`.',
      exitCode: 2,
    });
  }
  const scan = new Scan(root, opts);
  const packageManager = detectPackageManager(scan);
  const frameworks = detectFrameworks(scan);
  const routes = detectRoutes(scan, frameworks);
  const openapi = detectOpenApi(scan, opts.openapi);
  const testIds = detectTestIds(scan);
  const existingTests = detectExistingTests(scan);
  const auth = detectAuth(scan, routes);
  const { envs, baseUrls } = detectEnvs(scan);
  const ci = detectCi(scan);
  const i18n = detectI18n(scan);
  const a11y = detectA11y(scan);

  const report: AnalysisReport = {
    appPath: root,
    analyzedAt: new Date().toISOString(),
    filesScanned: scan.files.length,
    packageManager,
    frameworks,
    routes,
    openapi,
    testIds,
    existingTests,
    auth,
    envs,
    baseUrls,
    ci,
    i18n,
    a11y,
    checklist: [],
  };
  report.checklist = buildChecklist(report, scan.truncated);
  return report;
}

export function buildChecklist(r: AnalysisReport, truncated = false): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const hasUi = r.frameworks.some((f) => f.kind === 'frontend' || f.kind === 'fullstack');
  const hasApi =
    r.frameworks.some((f) => f.kind === 'backend' || f.kind === 'fullstack') ||
    r.openapi.length > 0 ||
    r.routes.some((x) => x.kind === 'api');

  if (truncated) {
    items.push({
      id: 'scan-truncated',
      severity: 'info',
      title: 'Scan was truncated',
      detail: 'The repository exceeded the file budget; results may be partial.',
      fix: 'Point `automax analyze` at the application package instead of the monorepo root.',
    });
  }
  if (!r.frameworks.length) {
    items.push({
      id: 'no-framework',
      severity: 'warning',
      title: 'No known framework detected',
      detail: 'Routes and base URLs could not be inferred from a framework convention.',
      fix: 'Pass `--openapi <spec>` for the API layer and add routes to automax.project.yaml by hand.',
    });
  }
  if (hasUi && !r.testIds.attribute) {
    items.push({
      id: 'no-test-ids',
      severity: 'warning',
      title: 'No test-id attributes found in templates',
      detail:
        'Locators will rely on roles, labels and text. That is fine for accessible UIs but fragile otherwise.',
      fix: 'Add data-testid to interactive elements, or set testIdAttribute to the attribute your team already uses.',
    });
  } else if (hasUi && r.testIds.attribute && r.testIds.attribute !== 'data-testid') {
    items.push({
      id: 'custom-test-id',
      severity: 'info',
      title: `Test-id attribute is ${r.testIds.attribute}`,
      detail: `Detected ${r.testIds.counts[r.testIds.attribute]} occurrences; AutoMax will configure testIdAttribute accordingly.`,
    });
  }
  if (hasUi && r.routes.filter((x) => x.kind === 'page').length === 0) {
    items.push({
      id: 'no-page-routes',
      severity: 'warning',
      title: 'No page routes detected',
      detail: 'Starter UI features need at least one route.',
      fix: 'Add `routes:` to automax.project.yaml (name → path).',
    });
  }
  if (hasApi && !r.openapi.length) {
    items.push({
      id: 'no-openapi',
      severity: 'warning',
      title: 'No OpenAPI specification found',
      detail: 'Contract testing and endpoint coverage work best from a spec.',
      fix: 'Export your OpenAPI document (many frameworks generate one) and reference it via env `api.openapi`.',
    });
  }
  for (const t of r.existingTests) {
    const total = Object.values(t.locators).reduce((a, b) => a + b, 0);
    const fragile = t.locators.css + t.locators.xpath;
    if (total > 0 && fragile / total > 0.5) {
      items.push({
        id: `fragile-locators-${t.framework}`,
        severity: 'warning',
        title: `Existing ${t.framework} tests lean on CSS/XPath locators`,
        detail: `${fragile} of ${total} locators are CSS or XPath. Role, label and test-id locators survive UI refactors better.`,
        fix: 'Import the specs into the recorded layer, then convert them with `automax record convert` which proposes role/test-id locators.',
      });
    }
    if (t.framework === 'cypress') {
      items.push({
        id: 'cypress-present',
        severity: 'info',
        title: 'Cypress tests found',
        detail: `${t.files} Cypress files. Their cy.get selectors and data-cy attributes map onto the AutoMax test-id locator strategy.`,
      });
    }
    if (t.framework === 'playwright') {
      items.push({
        id: 'playwright-present',
        severity: 'info',
        title: 'Playwright specs found',
        detail: `${t.files} spec files can be imported into the recorded layer with --apply.`,
      });
    }
  }
  if (r.ci.provider === 'none') {
    items.push({
      id: 'no-ci',
      severity: 'warning',
      title: 'No CI configuration detected',
      detail: 'Nothing runs the suite automatically.',
      fix: 'Copy the AutoMax GitHub Actions workflow or run `automax schedule install --target github`.',
    });
  }
  if (hasUi && !r.a11y.tooling.length) {
    items.push({
      id: 'no-a11y',
      severity: 'info',
      title: 'No accessibility tooling',
      detail: 'Add @a11y scenarios; AutoMax runs axe-core for them.',
    });
  }
  if (!r.envs.length) {
    items.push({
      id: 'no-env-files',
      severity: 'info',
      title: 'No .env files found',
      detail: 'Environment base URLs were inferred from framework defaults.',
      fix: 'Verify envs/*.yaml base URLs after --apply.',
    });
  }
  if (r.auth.strategyGuess !== 'none') {
    items.push({
      id: 'auth-strategy',
      severity: 'info',
      title: `Auth strategy guess: ${r.auth.strategyGuess}`,
      detail: `Based on ${r.auth.libraries.join(', ') || 'login-looking pages'}. Configure selectors or token placement under auth: in the project yaml.`,
      fix:
        r.auth.strategyGuess === 'sso'
          ? 'Use `automax auth capture --interactive` once per role to store SSO sessions.'
          : undefined,
    });
  }
  if (r.i18n.locales.length > 1) {
    items.push({
      id: 'multi-locale',
      severity: 'info',
      title: `${r.i18n.locales.length} locales detected`,
      detail: `Locales: ${r.i18n.locales.join(', ')}. Use per-environment use.locale and role/text locators that do not depend on translated copy.`,
    });
  }
  return items;
}
