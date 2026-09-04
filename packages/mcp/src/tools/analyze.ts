import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { projectRoot, readJson, readYaml, walk } from '../fs.js';
import { defineTool, summarize } from '../registry/registry.js';
import { parseGherkin } from './feature.js';

/* ------------------------------------------------------------------ */
/* analyze_project — heuristics over an application repository         */
/* ------------------------------------------------------------------ */

export interface Evidence {
  finding: string;
  confidence: number; // 0..1
  evidence: string[];
}

const FRAMEWORKS: Array<{ name: string; deps?: string[]; files?: string[] }> = [
  { name: 'next', deps: ['next'], files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
  { name: 'nuxt', deps: ['nuxt'], files: ['nuxt.config.ts'] },
  { name: 'react', deps: ['react', 'react-dom'] },
  { name: 'vue', deps: ['vue'] },
  { name: 'angular', deps: ['@angular/core'], files: ['angular.json'] },
  { name: 'svelte', deps: ['svelte', '@sveltejs/kit'], files: ['svelte.config.js'] },
  { name: 'express', deps: ['express'] },
  { name: 'fastify', deps: ['fastify'] },
  { name: 'nestjs', deps: ['@nestjs/core'] },
  { name: 'spring', files: ['pom.xml', 'build.gradle'] },
  { name: 'django', files: ['manage.py'] },
  { name: 'flask', deps: ['flask'] },
];

const ROUTE_PATTERNS: Array<{ framework: string; re: RegExp; fileFilter: (f: string) => boolean }> =
  [
    {
      framework: 'express/fastify',
      re: /\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g,
      fileFilter: (f) => /\.(js|ts|mjs|cjs)$/.test(f),
    },
    {
      framework: 'react-router',
      re: /path\s*[:=]\s*['"`]([^'"`]+)['"`]/g,
      fileFilter: (f) => /\.(jsx|tsx|js|ts)$/.test(f),
    },
    {
      framework: 'nestjs',
      re: /@(Get|Post|Put|Patch|Delete)\(\s*['"`]?([^'"`)]*)['"`]?\)/g,
      fileFilter: (f) => /\.ts$/.test(f),
    },
    {
      framework: 'spring',
      re: /@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*)?"([^"]+)"/g,
      fileFilter: (f) => /\.(java|kt)$/.test(f),
    },
    {
      framework: 'flask/django',
      re: /(?:@app\.route|path)\(\s*['"]([^'"]+)['"]/g,
      fileFilter: (f) => /\.py$/.test(f),
    },
  ];

const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-test-id'];

export function analyzeApp(appPath: string): Record<string, unknown> {
  const root = resolve(appPath);
  if (!existsSync(root))
    throw Object.assign(new Error(`Path not found: ${root}`), { error: { code: 'NOT_FOUND' } });
  const pkg = readJson<{
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: unknown;
    scripts?: Record<string, string>;
  }>(join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const frameworks: Evidence[] = [];
  for (const fw of FRAMEWORKS) {
    const evidence: string[] = [];
    for (const d of fw.deps ?? []) if (deps[d]) evidence.push(`dependency ${d}@${deps[d]}`);
    for (const f of fw.files ?? []) if (existsSync(join(root, f))) evidence.push(`file ${f}`);
    if (evidence.length)
      frameworks.push({
        finding: fw.name,
        confidence: Math.min(1, 0.5 + 0.25 * evidence.length),
        evidence,
      });
  }
  const files = walk(
    root,
    (f) =>
      /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|html|java|kt|py)$/.test(f) && statSync(f).size < 400_000,
    4000,
  );

  // routes
  const routes = new Map<string, { path: string; framework: string; files: Set<string> }>();
  const nextRoutes: string[] = [];
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/');
    if (
      /^(src\/)?(app|pages)\/.*\/?(page|route)\.(tsx|jsx|ts|js)$/.test(rel) ||
      /^(src\/)?pages\/.*\.(tsx|jsx)$/.test(rel)
    ) {
      const r =
        '/' +
        rel
          .replace(/^(src\/)?(app|pages)\//, '')
          .replace(/\/(page|route)\.(tsx|jsx|ts|js)$/, '')
          .replace(/\.(tsx|jsx)$/, '')
          .replace(/index$/, '')
          .replace(/\[([^\]]+)\]/g, ':$1');
      nextRoutes.push(r.replace(/\/$/, '') || '/');
    }
    let text: string;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const p of ROUTE_PATTERNS) {
      if (!p.fileFilter(f)) continue;
      for (const m of text.matchAll(p.re)) {
        const path = m[2] ?? m[1];
        if (!path || !path.startsWith('/') || path.length > 120) continue;
        const key = `${p.framework}:${path}`;
        const entry = routes.get(key) ?? { path, framework: p.framework, files: new Set<string>() };
        entry.files.add(rel);
        routes.set(key, entry);
      }
    }
  }
  for (const r of nextRoutes)
    routes.set(`next:${r}`, { path: r, framework: 'next/file-routing', files: new Set() });

  // test-id attribute usage
  const testIds: Record<string, number> = {};
  for (const f of files.filter((x) => /\.(jsx|tsx|vue|svelte|html)$/.test(x))) {
    let text: string;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const attr of TEST_ID_ATTRS) {
      const n = (text.match(new RegExp(`${attr}\\s*=`, 'g')) ?? []).length;
      if (n) testIds[attr] = (testIds[attr] ?? 0) + n;
    }
  }
  const testIdAttribute = Object.entries(testIds).sort((a, b) => b[1] - a[1])[0]?.[0];

  // openapi
  const openapi = walk(root, (f) => /(openapi|swagger)[^/]*\.(json|ya?ml)$/i.test(f), 200).map(
    (f) => relative(root, f),
  );

  // existing tests
  const tests = {
    playwright:
      walk(
        root,
        (f) => /\.(spec|test)\.(ts|js|mjs)$/.test(f) && /playwright|page\./.test(safeRead(f)),
        500,
      ).length + (existsSync(join(root, 'playwright.config.ts')) ? 1 : 0),
    cypress: existsSync(join(root, 'cypress')) || Boolean(deps['cypress']),
    cucumber: walk(root, (f) => f.endsWith('.feature'), 500).length,
    jest: Boolean(deps['jest'] || deps['vitest']),
  };

  // auth hints
  const authEvidence: string[] = [];
  for (const d of [
    'next-auth',
    '@auth/core',
    'passport',
    'keycloak-js',
    '@okta/okta-auth-js',
    'firebase',
    '@azure/msal-browser',
    'jsonwebtoken',
    'express-session',
  ])
    if (deps[d]) authEvidence.push(`dependency ${d}`);
  const loginFiles = files
    .filter((f) => /login|signin|sign-in|auth/i.test(relative(root, f)))
    .slice(0, 10)
    .map((f) => relative(root, f));
  const auth: Evidence = {
    finding: authEvidence.some((e) => /next-auth|@auth\/core|keycloak|okta|msal|firebase/.test(e))
      ? 'sso'
      : loginFiles.length
        ? 'form'
        : 'none',
    confidence: authEvidence.length || loginFiles.length ? 0.6 : 0.3,
    evidence: [...authEvidence, ...loginFiles.map((f) => `file ${f}`)],
  };

  // env + urls
  const envFiles = [
    '.env',
    '.env.example',
    '.env.local',
    '.env.development',
    '.env.staging',
    '.env.production',
  ].filter((f) => existsSync(join(root, f)));
  const urls = new Set<string>();
  for (const f of envFiles)
    for (const m of safeRead(join(root, f)).matchAll(/https?:\/\/[^\s'"]+/g)) urls.add(m[0]);
  const ports = new Set<number>();
  for (const f of [
    'docker-compose.yml',
    'docker-compose.yaml',
    'vite.config.ts',
    'vite.config.js',
    'package.json',
  ].filter((x) => existsSync(join(root, x)))) {
    for (const m of safeRead(join(root, f)).matchAll(
      /(?:port\s*[:=]\s*|-p\s*|--port\s+|localhost:)(\d{4,5})/g,
    ))
      ports.add(Number(m[1]));
  }
  const ci = [
    '.github/workflows',
    '.gitlab-ci.yml',
    'Jenkinsfile',
    'azure-pipelines.yml',
    'bitbucket-pipelines.yml',
  ].filter((f) => existsSync(join(root, f)));

  const routeList = [...routes.values()]
    .map((r) => ({ path: r.path, framework: r.framework, files: [...r.files].slice(0, 3) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const slug = (pkg?.name ?? root.split('/').pop() ?? 'app')
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const guessedUi =
    [...urls].find((u) => !/api/.test(u)) ?? `http://localhost:${[...ports][0] ?? 3000}`;
  const guessedApi = [...urls].find((u) => /api/.test(u)) ?? `${guessedUi.replace(/\/$/, '')}/api`;

  const proposal = {
    slug,
    name: pkg?.name ?? slug,
    layers: [
      ...new Set([
        ...(routeList.length ||
        frameworks.some((f) => /react|vue|angular|svelte|next|nuxt/.test(f.finding))
          ? ['ui']
          : []),
        ...(openapi.length ||
        routeList.some((r) => /express|fastify|nestjs|spring|flask/.test(r.framework))
          ? ['api']
          : []),
        'hybrid',
      ]),
    ],
    browsers: ['chromium'],
    testIdAttribute: testIdAttribute ?? 'data-testid',
    routes: Object.fromEntries(
      routeList
        .filter((r) => !/:/.test(r.path))
        .slice(0, 40)
        .map((r) => [
          r.path === '/'
            ? 'home'
            : r.path
                .replace(/^\//, '')
                .replace(/[^a-z0-9]+/gi, '-')
                .toLowerCase(),
          r.path,
        ]),
    ),
    envs: { default: 'local', available: ['local'] },
    auth: { strategy: auth.finding },
    modules: groupModules(routeList.map((r) => r.path)),
    env: {
      local: { ui: { baseUrl: guessedUi }, api: { baseUrl: guessedApi, openapi: openapi[0] } },
    },
  };

  const checklist = [
    {
      check: 'test-id attribute in templates',
      ok: Boolean(testIdAttribute),
      detail: testIdAttribute
        ? `${testIdAttribute} used ${testIds[testIdAttribute]} times`
        : 'no data-testid/data-test/data-cy attributes found; role/label locators will carry the load',
    },
    {
      check: 'OpenAPI spec available',
      ok: openapi.length > 0,
      detail: openapi.join(', ') || 'none found; API contract tests need a spec',
    },
    { check: 'routes detected', ok: routeList.length > 0, detail: `${routeList.length} route(s)` },
    {
      check: 'existing automated tests',
      ok: tests.playwright > 0 || tests.cucumber > 0 || tests.cypress,
      detail: JSON.stringify(tests),
    },
    { check: 'CI configured', ok: ci.length > 0, detail: ci.join(', ') || 'none' },
    { check: 'environment files', ok: envFiles.length > 0, detail: envFiles.join(', ') || 'none' },
  ];

  return {
    root,
    package: pkg?.name,
    frameworks,
    routes: routeList,
    testIdUsage: testIds,
    testIdAttribute,
    openapi,
    tests,
    auth,
    envFiles,
    urls: [...urls],
    ports: [...ports],
    ci,
    proposal,
    checklist,
  };
}

function groupModules(
  paths: string[],
): Array<{ name: string; routes: string[]; testingTypes: string[] }> {
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const seg =
      p
        .split('/')
        .filter(Boolean)[0]
        ?.replace(/[^a-z0-9-]/gi, '-')
        .toLowerCase() || 'home';
    groups.set(seg, [...(groups.get(seg) ?? []), p]);
  }
  return [...groups.entries()].slice(0, 30).map(([name, routes]) => ({
    name,
    routes: routes.slice(0, 20),
    testingTypes: ['functional', 'smoke', 'regression'],
  }));
}

function safeRead(f: string): string {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* coverage, best practices, locators, change impact                    */
/* ------------------------------------------------------------------ */

interface ProjectYaml {
  routes?: Record<string, string>;
  modules?: Array<{
    name: string;
    path?: string;
    routes?: string[];
    endpoints?: string[];
    tags?: string[];
  }>;
  tags?: { suites?: string[] };
}

function loadProjectYaml(root: string): ProjectYaml {
  return readYaml<ProjectYaml>(join(root, 'automax.project.yaml')) ?? {};
}

export function analyzeCoverage(root: string) {
  const yaml = loadProjectYaml(root);
  const features = walk(join(root, 'features'), (f) => f.endsWith('.feature')).map((f) => ({
    rel: relative(root, f).replace(/\\/g, '/'),
    parsed: parseGherkin(readFileSync(f, 'utf8'), relative(root, f)),
  }));
  const routeNames = Object.entries(yaml.routes ?? {});
  const stepText = features.flatMap((f) =>
    f.parsed.scenarios.flatMap((s) =>
      s.steps.map((st) => ({ feature: f.rel, scenario: s.name, tags: s.tags, text: st.text })),
    ),
  );
  const pageSrc = walk(join(root, 'pages'), (f) => f.endsWith('.ts'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const routes = routeNames.map(([name, path]) => {
    const hits = stepText.filter(
      (s) => s.text.includes(`"${name}"`) || s.text.includes(`"${path}"`),
    );
    const inPom = new RegExp(`goto\\(['"\`]${name}['"\`]\\)`).test(pageSrc);
    const suites = [
      ...new Set(hits.flatMap((h) => h.tags.filter((t) => /^@(smoke|regression|sanity)$/.test(t)))),
    ];
    return { route: name, path, scenarios: hits.length, viaPageObject: inPom, suites };
  });
  const endpoints = (yaml.modules ?? []).flatMap((m) =>
    (m.endpoints ?? []).map((e) => ({ module: m.name, endpoint: e })),
  );
  const endpointRows = endpoints.map((e) => {
    const hits = stepText.filter((s) => s.text.includes(e.endpoint.replace(/^[A-Z]+\s+/, '')));
    return {
      ...e,
      scenarios: hits.length,
      suites: [
        ...new Set(
          hits.flatMap((h) => h.tags.filter((t) => /^@(smoke|regression|sanity)$/.test(t))),
        ),
      ],
    };
  });
  const modules = (yaml.modules ?? []).map((m) => {
    const dir = (m.path ?? m.name).replace(/^features\//, '');
    const fs = features.filter(
      (f) =>
        f.rel.replace(/^features\//, '').startsWith(dir + '/') ||
        f.rel.replace(/^features\//, '') === dir,
    );
    return {
      module: m.name,
      features: fs.length,
      scenarios: fs.reduce((n, f) => n + f.parsed.scenarios.length, 0),
    };
  });
  const uncoveredRoutes = routes
    .filter((r) => r.scenarios === 0 && !r.viaPageObject)
    .map((r) => r.route);
  return {
    routes,
    endpoints: endpointRows,
    modules,
    uncoveredRoutes,
    totals: {
      features: features.length,
      scenarios: stepText.length ? features.reduce((n, f) => n + f.parsed.scenarios.length, 0) : 0,
    },
  };
}

export function analyzeBestPractices(root: string) {
  const yaml = loadProjectYaml(root);
  const suites = (yaml.tags?.suites ?? ['smoke', 'regression', 'sanity']).map((s) => `@${s}`);
  const findings: Array<{
    severity: 'error' | 'warning' | 'info';
    rule: string;
    file: string;
    line?: number;
    message: string;
    fix?: string;
  }> = [];
  const features = walk(join(root, 'features'), (f) => f.endsWith('.feature'));
  let hasA11y = false;
  let hasVisual = false;
  let hasPerf = false;
  const stepCounts = new Map<string, number>();
  for (const f of features) {
    const rel = relative(root, f).replace(/\\/g, '/');
    const text = readFileSync(f, 'utf8');
    const parsed = parseGherkin(text, rel);
    for (const e of parsed.errors)
      findings.push({ severity: 'error', rule: 'gherkin', file: rel, message: e });
    for (const sc of parsed.scenarios) {
      const layers = sc.tags.filter((t) => ['@ui', '@api', '@hybrid'].includes(t));
      if (layers.length !== 1)
        findings.push({
          severity: 'error',
          rule: 'tag-layer',
          file: rel,
          line: sc.line,
          message: `"${sc.name}" needs exactly one layer tag`,
          fix: 'Add @ui, @api or @hybrid at Feature level',
        });
      const st = sc.tags.filter((t) => suites.includes(t));
      if (st.length !== 1)
        findings.push({
          severity: 'error',
          rule: 'tag-suite',
          file: rel,
          line: sc.line,
          message: `"${sc.name}" needs exactly one suite tag (${suites.join(', ')})`,
        });
      if (sc.tags.includes('@a11y')) hasA11y = true;
      if (sc.tags.includes('@visual')) hasVisual = true;
      if (sc.tags.includes('@perf')) hasPerf = true;
      if (sc.keyword.toLowerCase().includes('outline') && !/#\s*title-format:/.test(text))
        findings.push({
          severity: 'warning',
          rule: 'outline-title',
          file: rel,
          line: sc.line,
          message: `Scenario Outline "${sc.name}" has no "# title-format:" comment; rows will be reported as Example #n`,
        });
      for (const step of sc.steps) {
        stepCounts.set(
          step.text.replace(/"[^"]*"/g, '"…"'),
          (stepCounts.get(step.text.replace(/"[^"]*"/g, '"…"')) ?? 0) + 1,
        );
        if (/https?:\/\//.test(step.text))
          findings.push({
            severity: 'warning',
            rule: 'hardcoded-url',
            file: rel,
            line: step.line,
            message: 'Hardcoded URL in a step; use routes from the project yaml',
            fix: 'Replace with `I navigate to the "<route>" page`',
          });
        if (
          /password|secret|token/i.test(step.text) &&
          /"[^"$]{6,}"/.test(step.text) &&
          !/\{\{/.test(step.text)
        )
          findings.push({
            severity: 'warning',
            rule: 'secret-literal',
            file: rel,
            line: step.line,
            message: 'Possible secret literal in a step; use a dataset or {{var}}',
          });
        if (/wait(s)? (for )?\d+ (ms|seconds?)/i.test(step.text))
          findings.push({
            severity: 'warning',
            rule: 'sleep',
            file: rel,
            line: step.line,
            message: 'Fixed wait in a step; prefer auto-waiting assertions or polling steps',
          });
      }
    }
    const literalLogins = parsed.scenarios.filter((s) =>
      s.steps.some((st) => /login with "[^{]+" and "[^{]+"/.test(st.text)),
    );
    if (literalLogins.length >= 2)
      findings.push({
        severity: 'info',
        rule: 'data-driven-candidate',
        file: rel,
        message: `${literalLogins.length} scenarios log in with literal credentials; consider a Scenario Outline + dataset (@data-driven)`,
      });
  }
  for (const f of walk(join(root, 'pages'), (x) => x.endsWith('.ts'))) {
    const rel = relative(root, f).replace(/\\/g, '/');
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/locator\(\s*['"`](\/\/|\.\.|xpath=)/.test(l))
        findings.push({
          severity: 'warning',
          rule: 'xpath-locator',
          file: rel,
          line: i + 1,
          message: 'XPath locator; prefer role/label/test id',
        });
      else if (/page\.locator\(\s*['"`][.#[]/.test(l) && !/heal\.locator/.test(l))
        findings.push({
          severity: 'info',
          rule: 'css-locator',
          file: rel,
          line: i + 1,
          message: 'Raw CSS locator without heal context',
          fix: 'Wrap with this.heal.locator(primary, { role, name, testId, description })',
        });
    });
  }
  if (features.length && !hasA11y)
    findings.push({
      severity: 'info',
      rule: 'coverage-a11y',
      file: 'features/',
      message: 'No @a11y scenario; add one per key page',
    });
  if (features.length && !hasVisual)
    findings.push({
      severity: 'info',
      rule: 'coverage-visual',
      file: 'features/',
      message: 'No @visual baseline scenario',
    });
  if (features.length && !hasPerf)
    findings.push({
      severity: 'info',
      rule: 'coverage-perf',
      file: 'features/',
      message: 'No @perf budget scenario',
    });
  const duplicates = [...stepCounts.entries()]
    .filter(([, n]) => n >= 5)
    .map(([text, n]) => ({ text, uses: n }));
  return {
    findings,
    stats: {
      features: features.length,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
    },
    frequentSteps: duplicates.slice(0, 20),
  };
}

export function analyzeLocators(root: string) {
  const rows: Array<{
    file: string;
    line: number;
    kind: string;
    snippet: string;
    healed: boolean;
  }> = [];
  const files = [
    ...walk(join(root, 'pages'), (f) => f.endsWith('.ts')),
    ...walk(join(root, 'steps'), (f) => f.endsWith('.ts')),
    ...walk(join(root, 'recorded'), (f) => f.endsWith('.ts')),
  ];
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/');
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((l, i) => {
        const kind = /getByRole\(/.test(l)
          ? 'role'
          : /getByLabel\(/.test(l)
            ? 'label'
            : /getByTestId\(/.test(l)
              ? 'testid'
              : /getByPlaceholder\(/.test(l)
                ? 'placeholder'
                : /getByText\(/.test(l)
                  ? 'text'
                  : /locator\(\s*['"`](\/\/|xpath=)/.test(l)
                    ? 'xpath'
                    : /locator\(\s*['"`]/.test(l)
                      ? 'css'
                      : undefined;
        if (kind)
          rows.push({
            file: rel,
            line: i + 1,
            kind,
            snippet: l.trim().slice(0, 140),
            healed: /heal\.locator/.test(l),
          });
      });
  }
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const fragile = rows.filter((r) => (r.kind === 'css' || r.kind === 'xpath') && !r.healed);
  return {
    byKind,
    total: rows.length,
    fragile,
    score: rows.length ? Math.round((100 * (rows.length - fragile.length)) / rows.length) : 100,
  };
}

export function analyzeChangeImpact(root: string, rootDir: string, range: string) {
  let changed: string[] = [];
  try {
    changed = execFileSync('git', ['diff', '--name-only', range], {
      cwd: rootDir,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch (e) {
    throw Object.assign(
      new Error(`git diff failed for range "${range}": ${(e as Error).message.split('\n')[0]}`),
      { error: { code: 'INVALID_ARGS' } },
    );
  }
  const projectRel = relative(rootDir, root).replace(/\\/g, '/');
  const features = walk(join(root, 'features'), (f) => f.endsWith('.feature')).map((f) => ({
    rel: relative(root, f).replace(/\\/g, '/'),
    parsed: parseGherkin(readFileSync(f, 'utf8')),
  }));
  const impacted = new Map<string, Set<string>>();
  const add = (feature: string, why: string) =>
    impacted.set(feature, new Set([...(impacted.get(feature) ?? []), why]));
  const yaml = loadProjectYaml(root);
  for (const file of changed) {
    if (file.startsWith(`${projectRel}/features/`))
      add(file.replace(`${projectRel}/`, ''), 'feature changed');
    if (file.startsWith(`${projectRel}/pages/`) || file.startsWith(`${projectRel}/steps/`)) {
      const base = file
        .split('/')
        .pop()!
        .replace(/\.(steps|page)?\.ts$/i, '')
        .replace(/Page$/, '')
        .toLowerCase();
      for (const f of features)
        if (f.rel.toLowerCase().includes(base)) add(f.rel, `${file} changed`);
    }
    if (file.startsWith(`${projectRel}/data/`))
      for (const f of features)
        if (
          f.parsed.scenarios.some(
            (s) =>
              s.tags.some((t) => t.startsWith('@data')) ||
              s.steps.some((st) => /dataset/.test(st.text)),
          )
        )
          add(f.rel, `data changed: ${file}`);
    if (
      file.startsWith(`${projectRel}/automax.project.yaml`) ||
      file.startsWith(`${projectRel}/envs/`)
    )
      for (const f of features) add(f.rel, `config changed: ${file}`);
    // application source: map by route/module keywords
    for (const m of yaml.modules ?? []) {
      if (file.toLowerCase().includes(`/${m.name}`))
        for (const f of features)
          if (f.rel.includes(`/${m.name}/`)) add(f.rel, `module ${m.name} source changed: ${file}`);
    }
  }
  const rows = [...impacted.entries()].map(([feature, reasons]) => ({
    feature,
    reasons: [...reasons],
  }));
  const tagExpr = rows.length
    ? `re-run: automax run -p <slug> --feature ${rows.map((r) => r.feature).join(' --feature ')}`
    : 'no impacted features detected';
  return { range, changedFiles: changed, impacted: rows, suggestion: tagExpr };
}

export const analyzeTools = [
  defineTool({
    name: 'analyze_project',
    title: 'Analyze an application',
    description:
      'Scan an application repository: framework, routes, OpenAPI spec, test-id attribute, auth hints, env files, CI. Returns evidence, a proposed automax.project.yaml and an onboarding checklist.',
    shape: {
      path: z
        .string()
        .describe('path to the application repo (absolute or relative to the AutoMax repo)'),
    },
    access: 'read',
    domain: 'projects',
    capability: 'analyze',
    annotations: { openWorldHint: false },
    docsPath: '/docs/getting-started/onboard-existing-app',
    handler: async (args, ctx) => {
      const data = analyzeApp(resolve(ctx.rootDir, args.path));
      return {
        text: summarize(`Analysis of ${args.path}`, {
          frameworks: data.frameworks,
          testIdAttribute: data.testIdAttribute,
          routes: (data.routes as unknown[]).length,
          checklist: data.checklist,
          proposal: data.proposal,
        }),
        data,
      };
    },
  }),
  defineTool({
    name: 'analyze_routes',
    title: 'Detect routes',
    description:
      'Routes and endpoints detected in an application repository (framework-specific heuristics).',
    shape: { path: z.string() },
    access: 'read',
    domain: 'projects',
    capability: 'analyze',
    handler: async (args, ctx) => {
      const data = analyzeApp(resolve(ctx.rootDir, args.path));
      return {
        text: summarize('Routes', data.routes),
        data: { routes: data.routes, openapi: data.openapi },
      };
    },
  }),
  defineTool({
    name: 'analyze_coverage',
    title: 'Coverage by scenarios',
    description:
      'Which project routes, module endpoints and modules are exercised by scenarios, by suite tag; lists uncovered routes.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'projects',
    capability: 'analyze',
    handler: async (args, ctx) => {
      const data = analyzeCoverage(projectRoot(ctx.rootDir, args.project));
      return { text: summarize(`Coverage of ${args.project}`, data), data };
    },
  }),
  defineTool({
    name: 'analyze_best_practices',
    title: 'Best-practice checklist',
    description:
      'Tag policy, outline titles, hardcoded URLs/secrets, sleeps, brittle locators in page objects, missing @a11y/@visual/@perf, data-driven candidates.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'projects',
    capability: 'analyze',
    handler: async (args, ctx) => {
      const data = analyzeBestPractices(projectRoot(ctx.rootDir, args.project));
      return {
        text: summarize(
          `Best practices for ${args.project}: ${data.stats.errors} errors, ${data.stats.warnings} warnings`,
          data,
        ),
        data,
      };
    },
  }),
  defineTool({
    name: 'analyze_locators',
    title: 'Locator audit',
    description:
      'Audit locators in pages/, steps/ and recorded/: kinds (role/label/testid/css/xpath), heal wrapping, fragility score.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'projects',
    capability: 'analyze',
    handler: async (args, ctx) => {
      const data = analyzeLocators(projectRoot(ctx.rootDir, args.project));
      return {
        text: summarize(`Locators of ${args.project}: score ${data.score}/100`, data),
        data,
      };
    },
  }),
  defineTool({
    name: 'analyze_change_impact',
    title: 'Change impact',
    description:
      'Map a git diff range (e.g. main..HEAD) to impacted features of a project and suggest what to re-run.',
    shape: { project: z.string(), range: z.string().default('HEAD~1..HEAD') },
    access: 'read',
    domain: 'projects',
    capability: 'analyze',
    handler: async (args, ctx) => {
      const data = analyzeChangeImpact(
        projectRoot(ctx.rootDir, args.project),
        ctx.rootDir,
        args.range,
      );
      return { text: summarize(`Impact of ${args.range} on ${args.project}`, data), data };
    },
  }),
  defineTool({
    name: 'analyze_failure',
    title: 'Explain a failure',
    description:
      'Root-cause hints for a failed scenario: error classification (locator/timing/data/env/product), related heal events, screenshots and suggested next action.',
    shape: { runId: z.string(), fingerprint: z.string() },
    access: 'read',
    domain: 'runs',
    capability: 'analyze',
    handler: async (args, ctx) => {
      const { getRun, lastRun, listScenarioDirs, screenshotUri } = await import('../fs.js');
      const run = args.runId === 'last' ? lastRun(ctx.rootDir) : getRun(ctx.rootDir, args.runId);
      if (!run)
        throw Object.assign(new Error(`Unknown run ${args.runId}`), {
          error: { code: 'NOT_FOUND' },
        });
      const s = listScenarioDirs(run.dir, run.manifest?.projectSlug)
        .filter((x) => x.fingerprint === args.fingerprint)
        .sort((a, b) => b.retry - a.retry)[0];
      if (!s)
        throw Object.assign(new Error(`Scenario ${args.fingerprint} not in run ${run.runId}`), {
          error: { code: 'NOT_FOUND' },
        });
      const err = s.meta?.errorMessage ?? '';
      const kind = /locator|strict mode|waiting for|toBeVisible|getBy/i.test(err)
        ? 'locator'
        : /Timeout|timed out|exceeded/i.test(err)
          ? 'timing'
          : /ECONNREFUSED|ENOTFOUND|5\d\d|network|fetch failed/i.test(err)
            ? 'environment'
            : /expect\(|toEqual|toBe\(|toContain/i.test(err)
              ? 'assertion'
              : /dataset|row|user pool|lease/i.test(err)
                ? 'data'
                : 'unknown';
      const selector =
        /locator\(['"`]([^'"`]+)['"`]\)/.exec(err)?.[1] ??
        /getBy[A-Za-z]+\(([^)]*)\)/.exec(err)?.[0];
      const nextAction =
        kind === 'locator'
          ? 'Check heal events; if a candidate succeeded, propose the healed locator in the page object (agent heal).'
          : kind === 'timing'
            ? 'Inspect before/after screenshots around the failing step; consider a polling step or a longer action timeout for this scenario (@timeout:).'
            : kind === 'environment'
              ? 'Verify env base URLs (project_list_envs) and connectivity; re-run with --har-replay if a HAR exists.'
              : kind === 'assertion'
                ? 'Compare expected vs actual in the API snapshot or screenshot; this may be a product bug worth issue_create.'
                : 'Read the run log and the trace.';
      const data = {
        runId: run.runId,
        fingerprint: s.fingerprint,
        scenario: s.meta?.scenarioName,
        status: s.meta?.status,
        error: err,
        classification: kind,
        selector,
        healEvents: s.healEvents,
        screenshots: s.screenshots.map((sh) => ({
          ...sh,
          uri: screenshotUri(run.runId, s.fingerprint, s.retry, sh.file),
        })),
        lastApiCalls: s.apiSnapshots.slice(-4),
        nextAction,
      };
      return { text: summarize(`Failure analysis: ${kind}`, data), data };
    },
  }),
  defineTool({
    name: 'analyze_suggest_scenarios',
    title: 'Suggest scenarios',
    description:
      'Template-level Gherkin drafts for uncovered routes and endpoints of a project (no LLM required).',
    shape: { project: z.string(), limit: z.number().int().positive().max(50).optional() },
    access: 'read',
    domain: 'projects',
    capability: 'analyze',
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const cov = analyzeCoverage(root);
      const yaml = loadProjectYaml(root);
      const drafts = cov.uncoveredRoutes.slice(0, args.limit ?? 10).map((route) => ({
        route,
        gherkin: `@ui @smoke\nFeature: ${route} page\n  Scenario: The ${route} page loads\n    Given I navigate to the "${route}" page\n    Then the page URL should contain "${yaml.routes?.[route] ?? '/'}"\n`,
      }));
      const endpointDrafts = cov.endpoints
        .filter((e) => e.scenarios === 0)
        .slice(0, args.limit ?? 10)
        .map((e) => ({
          endpoint: e.endpoint,
          gherkin: `@api @smoke\nFeature: ${e.endpoint}\n  Scenario: ${e.endpoint} responds\n    When I send a ${e.endpoint.split(' ')[0] ?? 'GET'} request to "${e.endpoint.split(' ')[1] ?? e.endpoint}"\n    Then the response status should be 200\n`,
        }));
      return {
        text: summarize(`Suggested scenarios for ${args.project}`, {
          routes: drafts,
          endpoints: endpointDrafts,
        }),
        data: { routes: drafts, endpoints: endpointDrafts },
      };
    },
  }),
];
