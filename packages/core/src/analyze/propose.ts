import { basename } from 'node:path';
import { stringify as toYaml } from 'yaml';
import {
  ProjectConfigSchema,
  type AnalysisReport,
  type ChecklistItem,
  type Layer,
  type ProjectProposal,
} from '@sdods/contracts';

export interface ProposeOptions {
  slug?: string;
  name?: string;
  envName?: string;
  browsers?: string[];
  /** which env names to create (default: detected envs, else [envName]) */
  envs?: string[];
}

const RESERVED_SEGMENTS = new Set(['api', 'app', 'src', 'pages']);

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'app';
}

function routeName(path: string): string {
  if (path === '/' || path === '') return 'home';
  const segs = path
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[{}*]/g, '').replace(/[^a-zA-Z0-9]+/g, '-'));
  const name = segs
    .filter(Boolean)
    .map((s, i) => (i > 0 && path.includes(`{${s}}`) ? `by-${s}` : s))
    .join('-')
    .toLowerCase();
  return name || 'home';
}

function moduleOfPath(path: string): string {
  const first = path.split('/').filter(Boolean)[0];
  if (!first || first.startsWith('{')) return 'home';
  const clean = first.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  return RESERVED_SEGMENTS.has(clean) ? 'core' : clean;
}

function pathToConcrete(path: string): string {
  return path.replace(/\{[^}]+\}/g, '1');
}

function prefixOf(path: string): string {
  const seg = path.split('/').filter(Boolean)[0];
  return seg && !seg.startsWith('{') ? `/${seg}` : '/';
}

/** Turn an analysis into a complete, valid project scaffold proposal (nothing is written). */
export function proposeProject(report: AnalysisReport, opts: ProposeOptions = {}): ProjectProposal {
  const notes: string[] = [];
  const pkgName = report.packageManager.workspaces.length ? undefined : undefined;
  const slug = slugify(opts.slug ?? pkgName ?? basename(report.appPath));
  const name = opts.name ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const hasUi =
    report.frameworks.some((f) => f.kind === 'frontend' || f.kind === 'fullstack') ||
    report.routes.some((r) => r.kind === 'page');
  const apiRoutes = report.routes.filter((r) => r.kind === 'api');
  const openapiEndpoints = report.openapi.flatMap((o) =>
    o.endpoints.map((e) => ({ ...e, spec: o.file })),
  );
  const hasApi =
    apiRoutes.length > 0 ||
    openapiEndpoints.length > 0 ||
    report.frameworks.some((f) => f.kind === 'backend');
  const layers: Layer[] = [];
  if (hasUi) layers.push('ui');
  if (hasApi) layers.push('api');
  if (hasUi && hasApi) layers.push('hybrid');
  if (report.existingTests.some((t) => t.framework === 'playwright')) layers.push('recorded');
  if (!layers.length) {
    layers.push('api');
    notes.push(
      'Neither UI nor API was detected with confidence; defaulting to an API layer. Adjust layers: in the yaml.',
    );
  }

  // routes map (name → path) from page routes, de-duplicated by name
  const routes: Record<string, string> = {};
  const pageRoutes = report.routes.filter((r) => r.kind === 'page');
  for (const r of pageRoutes) {
    let key = routeName(r.path);
    let i = 2;
    while (routes[key] && routes[key] !== r.path) key = `${routeName(r.path)}-${i++}`;
    routes[key] = r.path;
  }
  if (hasUi && !routes.home) routes.home = '/';

  // modules: UI by first path segment, API by openapi tag or first segment
  const modules = new Map<
    string,
    {
      name: string;
      layers: Layer[];
      routes: string[];
      endpoints: string[];
      testingTypes: string[];
      tags: string[];
    }
  >();
  const ensure = (m: string, layer: Layer) => {
    const key = slugify(m);
    const mod = modules.get(key) ?? {
      name: key,
      layers: [],
      routes: [],
      endpoints: [],
      testingTypes: ['functional', 'smoke', 'regression'],
      tags: [`@${key}`],
    };
    if (!mod.layers.includes(layer)) mod.layers.push(layer);
    modules.set(key, mod);
    return mod;
  };
  for (const [key, path] of Object.entries(routes)) {
    const mod = ensure(moduleOfPath(path), 'ui');
    if (!mod.routes.includes(key)) mod.routes.push(key);
  }
  const endpointSet = new Set<string>();
  for (const e of openapiEndpoints) {
    const mod = ensure(e.tag ?? moduleOfPath(e.path), 'api');
    if (!mod.endpoints.includes(e.path)) mod.endpoints.push(e.path);
    if (!mod.testingTypes.includes('contract')) mod.testingTypes.push('contract');
    endpointSet.add(e.path);
  }
  for (const r of apiRoutes) {
    if (endpointSet.has(r.path)) continue;
    const mod = ensure(moduleOfPath(r.path.replace(/^\/api\//, '/')), 'api');
    if (!mod.endpoints.includes(r.path)) mod.endpoints.push(r.path);
    endpointSet.add(r.path);
  }
  const authModule = [...modules.values()].find((m) => /auth|login|account|session/.test(m.name));
  if (authModule && !authModule.testingTypes.includes('data-driven'))
    authModule.testingTypes.push('data-driven');

  // envs
  const detectedEnvNames = [
    ...new Set(report.envs.map((e) => e.name).filter((n) => n !== 'example')),
  ];
  const envNames =
    opts.envs ?? (detectedEnvNames.length ? detectedEnvNames : [opts.envName ?? 'local']);
  const defaultEnv = envNames.includes('local') ? 'local' : envNames[0]!;
  const uiBase = report.baseUrls.ui ?? 'http://localhost:3000';
  const apiBase = report.baseUrls.api ?? `${uiBase}/api`;
  const envYamls: Record<string, string> = {};
  for (const envName of envNames) {
    const detected = report.envs.find((e) => e.name === envName);
    const ui = detected?.uiBaseUrl ?? uiBase;
    const api = detected?.apiBaseUrl ?? apiBase;
    const openapi = report.openapi[0]?.file;
    envYamls[envName] = [
      `name: ${envName}`,
      `ui:`,
      `  baseUrl: ${ui}`,
      `api:`,
      `  baseUrl: ${api}`,
      `  headers: { Accept: application/json }`,
      `  auth: { type: none }`,
      ...(openapi
        ? [
            `  # openapi: ${openapi}   # copy the spec next to the project or reference the app path`,
          ]
        : []),
      `users:`,
      `  poolSize: 2`,
      `vars: {}`,
      '',
    ].join('\n');
  }

  const testIdAttribute = report.testIds.attribute ?? 'data-testid';
  const authStrategy =
    report.auth.strategyGuess === 'none'
      ? 'none'
      : report.auth.strategyGuess === 'oauth-client-credentials'
        ? 'oauth-client-credentials'
        : report.auth.strategyGuess;
  const loginPage = report.auth.pages.find((p) => p.startsWith('/'));

  const projectDoc = {
    slug,
    name,
    description: `Generated by sdods analyze from ${report.appPath} (${report.frameworks.map((f) => f.name).join(', ') || 'unknown stack'}).`,
    layers,
    browsers: opts.browsers ?? ['chromium'],
    testIdAttribute,
    routes,
    tags: {
      suites: ['smoke', 'regression', 'sanity'],
      extra: ['contract', 'visual', 'a11y'],
      roles: authStrategy === 'none' ? [] : ['standard', 'admin'],
    },
    envs: { default: defaultEnv, available: envNames },
    modules: [...modules.values()].map((m) => ({
      name: m.name,
      path: m.name,
      layers: m.layers,
      testingTypes: m.testingTypes,
      tags: m.tags,
      ...(m.routes.length ? { routes: m.routes } : {}),
      ...(m.endpoints.length ? { endpoints: m.endpoints } : {}),
    })),
    processes: [
      {
        name: 'pr-check',
        trigger: 'pr',
        tags: '@smoke',
        browsers: ['chromium'],
        gates: { minPassRate: 100 },
      },
      { name: 'nightly-regression', trigger: 'nightly', tags: '@regression' },
    ],
    data: {
      sources: {
        users: { type: 'csv', path: 'data/{env}/users.csv', fallback: 'data/common/users.csv' },
      },
      userPool: { dataset: 'users', roleColumn: 'role', leaseStore: 'file' },
    },
    auth: {
      strategy: authStrategy,
      storageState: true,
      ...(authStrategy === 'form'
        ? {
            form: {
              loginPath: loginPage ?? '/login',
              usernameSelector: `[${testIdAttribute}="username"]`,
              passwordSelector: `[${testIdAttribute}="password"]`,
              submitSelector: `[${testIdAttribute}="login"]`,
            },
          }
        : {}),
    },
    screenshots: {
      policy: {
        default: 'on-failure',
        '@smoke': 'scenario',
        '@regression': 'step',
        '@visual': 'visual',
      },
      viewport: { width: 1280, height: 720 },
    },
    heal: { enabled: true },
    retries: { ci: 2, local: 0 },
  };
  // validate before emitting
  const parsed = ProjectConfigSchema.parse(projectDoc);
  const projectYaml = `# Generated by \`sdods analyze\` on ${report.analyzedAt.slice(0, 10)}. Review routes, modules and auth before committing.\n${toYaml(projectDoc, { lineWidth: 100 })}`;

  // starter features + coverage map
  const starterFeatures: Record<string, string> = {};
  const coverageMap: ProjectProposal['coverageMap'] = [];
  for (const m of modules.values()) {
    const tag = m.tags[0]!;
    if (m.routes.length) {
      const scenarios = m.routes.map((rk) => {
        const path = routes[rk]!;
        coverageMap.push({
          kind: 'route',
          target: rk,
          module: m.name,
          starterFeature: `features/${m.name}/${m.name}.feature`,
        });
        return `  @smoke\n  Scenario: The ${rk} page loads\n    Given I navigate to the "${rk}" page\n    Then the page URL should contain "${prefixOf(path)}"\n`;
      });
      starterFeatures[`features/${m.name}/${m.name}.feature`] =
        `@ui ${tag}\nFeature: ${titleCase(m.name)} pages\n  Generated smoke checks: every known route of the ${m.name} module renders.\n\n${scenarios.join('\n')}`;
    }
    if (m.endpoints.length) {
      const scenarios = m.endpoints.map((ep) => {
        coverageMap.push({
          kind: 'endpoint',
          target: ep,
          module: m.name,
          starterFeature: `features/${m.name}/${m.name}-api.feature`,
        });
        return `  @smoke\n  Scenario: GET ${ep} responds\n    When I send a GET request to "${pathToConcrete(ep)}"\n    Then the response status should be one of "200,201,204,301,302,400,401,403,404,405"\n    And the response time should be under 5000 ms\n`;
      });
      starterFeatures[`features/${m.name}/${m.name}-api.feature`] =
        `@api ${tag}\nFeature: ${titleCase(m.name)} API\n  Generated reachability checks: every known endpoint of the ${m.name} module answers (any non-5xx status).\n\n${scenarios.join('\n')}`;
    }
  }
  if (!Object.keys(starterFeatures).length) {
    starterFeatures['features/health/health.feature'] =
      `@api @health\nFeature: Health\n  @smoke\n  Scenario: The API root responds\n    When I send a GET request to "/"\n    Then the response status should be one of "200,201,204,301,302,401,403,404"\n`;
    notes.push('No routes or endpoints were detected; a generic health feature was generated.');
  }

  const checklist: ChecklistItem[] = [
    ...report.checklist,
    {
      id: 'review-generated-yaml',
      severity: 'info',
      title: 'Review the generated sdods.project.yaml',
      detail: `${parsed.modules.length} module(s), ${Object.keys(routes).length} route(s), ${endpointSet.size} endpoint(s), layers ${layers.join('/')}, testIdAttribute ${testIdAttribute}, auth ${authStrategy}.`,
    },
  ];

  return {
    slug,
    name,
    projectYaml,
    envYamls,
    starterFeatures,
    files: {},
    coverageMap,
    checklist,
    notes,
  };
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
