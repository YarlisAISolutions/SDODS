/* Deterministic mock data for standalone dev and tests. Mirrors the demo-shop project. */
import type {
  AgentJob,
  ApiToken,
  Dataset,
  Environment,
  FeatureFile,
  IntegrationView,
  Me,
  Organization,
  PoolUser,
  ProcessView,
  Project,
  Proposal,
  RunDetail,
  RunListItem,
  ScenarioDetail,
  ScenarioNode,
  Schedule,
  StepDef,
  Trends,
  UserRow,
  Workspace,
} from '../api/types';

const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function shot(
  seed: string,
  phase: string,
  w = 1280,
  h = 720,
): { url: string; w: number; h: number } {
  // SVG data URL so mocks work offline; the hue depends on the seed so before/after differ.
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='hsl(${hue},40%,${phase === 'after' ? 30 : 22}%)'/><rect x='40' y='40' width='${w - 80}' height='60' rx='8' fill='hsl(${hue},60%,50%)'/><text x='60' y='80' font-size='28' fill='white' font-family='sans-serif'>${seed} · ${phase}</text>${phase === 'after' ? `<circle cx='${w - 120}' cy='${h - 120}' r='60' fill='#2dd4bf'/>` : ''}</svg>`;
  return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, w, h };
}

export const me: Me = {
  user: { id: 'u1', username: 'admin', email: 'admin@example.com', role: 'admin', active: true },
  csrfToken: 'csrf-mock',
  scopes: [],
  orgRoles: { automax: 'owner' },
  workspaceRoles: { default: 'admin', 'platform-qa': 'editor' },
};

export const orgs: Organization[] = [
  {
    id: 'o1',
    slug: 'automax',
    name: 'AutoMax',
    description: 'Default organization',
    url: 'https://github.com/siri1410/AutoMax',
    myRole: 'owner',
  },
];

export const workspaces: Workspace[] = [
  {
    id: 'w1',
    organizationId: 'o1',
    slug: 'default',
    name: 'Default workspace',
    description: 'Holds the demo project',
    projectCount: 1,
    myRole: 'admin',
  },
  {
    id: 'w2',
    organizationId: 'o1',
    slug: 'platform-qa',
    name: 'Platform QA',
    description: 'Second workspace',
    projectCount: 1,
    myRole: 'editor',
  },
  {
    id: 'w3',
    organizationId: 'o1',
    slug: 'mobile',
    name: 'Mobile',
    description: 'Viewer-only example',
    projectCount: 0,
    myRole: 'viewer',
  },
];

export const projects: Project[] = [
  {
    slug: 'demo-shop',
    name: 'Demo Shop',
    description: 'SauceDemo UI + JSONPlaceholder API + hybrid',
    workspace: 'default',
    organization: 'automax',
    layers: ['ui', 'api', 'hybrid', 'recorded'],
    browsers: ['chromium', 'firefox', 'webkit'],
    testIdAttribute: 'data-test',
    envs: { default: 'staging', available: ['local', 'staging'] },
    tags: {
      suites: ['smoke', 'regression', 'sanity'],
      extra: ['mock', 'visual', 'a11y', 'perf', 'data-driven', 'pool'],
      roles: ['standard', 'problem', 'performance', 'locked'],
    },
    routes: { login: '/', inventory: '/inventory.html', cart: '/cart.html' },
    modules: [
      {
        name: 'auth',
        title: 'Authentication',
        path: 'features/auth',
        layers: ['ui'],
        testingTypes: ['functional', 'smoke', 'regression', 'data-driven'],
        tags: ['@auth'],
        owner: 'qa-web',
        routes: ['login'],
        endpoints: [],
      },
      {
        name: 'inventory',
        title: 'Inventory',
        path: 'features/inventory',
        layers: ['ui'],
        testingTypes: ['functional', 'regression', 'visual', 'accessibility'],
        tags: ['@inventory'],
        routes: ['inventory'],
        endpoints: [],
      },
      {
        name: 'cart',
        title: 'Cart',
        path: 'features/cart',
        layers: ['ui'],
        testingTypes: ['functional'],
        tags: ['@cart'],
        routes: ['cart'],
        endpoints: [],
      },
      {
        name: 'posts-api',
        title: 'Posts API',
        path: 'features/api',
        layers: ['api'],
        testingTypes: ['functional', 'contract', 'smoke', 'regression'],
        tags: ['@posts'],
        routes: [],
        endpoints: ['GET /posts', 'POST /posts'],
      },
      {
        name: 'hybrid',
        title: 'Hybrid',
        path: 'features/hybrid',
        layers: ['hybrid'],
        testingTypes: ['integration'],
        tags: ['@hybrid-demo'],
        routes: [],
        endpoints: [],
      },
    ],
    processes: [
      {
        name: 'pr-check',
        title: 'Pull request check',
        trigger: 'pr',
        tags: '@smoke',
        browsers: ['chromium'],
        harMode: 'replay',
        failOnFlaky: false,
        gates: { minPassRate: 100, perfBudgets: false, a11y: false },
        notify: [],
      },
      {
        name: 'nightly-regression',
        title: 'Nightly regression',
        trigger: 'nightly',
        tags: '@regression',
        browsers: ['chromium', 'firefox', 'webkit'],
        failOnFlaky: false,
        gates: { perfBudgets: false, a11y: false },
        notify: ['github'],
        schedule: '0 2 * * *',
      },
      {
        name: 'release-gate',
        title: 'Release gate',
        trigger: 'release',
        tags: '@smoke or @regression',
        failOnFlaky: true,
        gates: { minPassRate: 100, maxFlaky: 0, perfBudgets: true, a11y: true },
        notify: [],
      },
      {
        name: 'api-contract',
        title: 'API contract',
        trigger: 'merge',
        layers: ['api'],
        tags: '@contract or @smoke',
        failOnFlaky: false,
        gates: { perfBudgets: false, a11y: false },
        notify: [],
      },
    ],
    screenshots: {
      policy: {
        default: 'on-failure',
        '@smoke': 'scenario',
        '@regression': 'step',
        '@visual': 'visual',
      },
      fullPage: false,
      mask: ['[data-test="shopping-cart-badge"]'],
      viewport: { width: 1280, height: 720 },
      onlyOnFailure: false,
    },
    integrations: {
      github: { enabled: false, owner: 'siri1410', repo: 'AutoMax' },
      jira: { enabled: false, projectKey: 'DEMO' },
    },
    mcp: {
      servers: {
        playwright: {
          transport: 'stdio',
          command: 'npx',
          args: ['playwright', 'mcp', '--headless'],
        },
      },
    },
  },
  {
    slug: 'billing-portal',
    name: 'Billing Portal',
    workspace: 'platform-qa',
    organization: 'automax',
    layers: ['ui', 'api'],
    browsers: ['chromium'],
    testIdAttribute: 'data-testid',
    envs: { default: 'local', available: ['local'] },
    tags: { suites: ['smoke', 'regression'], extra: [], roles: ['admin'] },
    routes: { home: '/' },
    modules: [
      {
        name: 'invoices',
        testingTypes: ['functional'],
        tags: ['@invoices'],
        routes: [],
        endpoints: [],
      },
    ],
    processes: [],
    screenshots: {
      policy: { default: 'on-failure' },
      fullPage: false,
      mask: [],
      viewport: { width: 1280, height: 720 },
      onlyOnFailure: false,
    },
    integrations: {},
    mcp: { servers: {} },
  },
];

export const envs: Record<string, Environment[]> = {
  'demo-shop': [
    {
      name: 'staging',
      description: 'Public sandboxes',
      ui: { baseUrl: 'https://www.saucedemo.com' },
      api: { baseUrl: 'https://jsonplaceholder.typicode.com', auth: { type: 'none' } },
      users: { poolSize: 4 },
      vars: { defaultProduct: 'Sauce Labs Backpack' },
      secretNames: ['DEMO_SHOP_PASSWORD'],
      secretsPresent: { DEMO_SHOP_PASSWORD: true },
      isDefault: true,
    },
    {
      name: 'local',
      ui: { baseUrl: 'https://www.saucedemo.com' },
      api: { baseUrl: 'https://jsonplaceholder.typicode.com', auth: { type: 'none' } },
      users: { poolSize: 2 },
      vars: {},
      secretNames: ['DEMO_SHOP_PASSWORD'],
      secretsPresent: { DEMO_SHOP_PASSWORD: false },
      isDefault: false,
    },
  ],
  'billing-portal': [
    {
      name: 'local',
      ui: { baseUrl: 'http://localhost:3000' },
      api: { baseUrl: 'http://localhost:3000/api', auth: { type: 'bearer' } },
      secretNames: ['API_TOKEN'],
      secretsPresent: { API_TOKEN: false },
      isDefault: true,
    },
  ],
};

export const datasets: Dataset[] = [
  {
    id: 'd1',
    name: 'users',
    envKey: '*',
    kind: 'csv',
    storage: 'file',
    sourcePath: 'data/common/users.csv',
    columns: ['id', 'username', 'password', 'role'],
    rowCount: 4,
    updatedAt: '2026-09-03T10:00:00Z',
  },
  {
    id: 'd2',
    name: 'products',
    envKey: '*',
    kind: 'json',
    storage: 'file',
    sourcePath: 'data/common/products.json',
    columns: ['name', 'price'],
    rowCount: 6,
  },
  {
    id: 'd3',
    name: 'posts',
    envKey: 'staging',
    kind: 'yaml',
    storage: 'file',
    sourcePath: 'data/staging/posts.yaml',
    columns: ['title', 'body', 'userId'],
    rowCount: 3,
  },
];

export const pool: PoolUser[] = [
  {
    id: 'p1',
    username: 'standard_user',
    role: 'standard',
    secretRef: 'DEMO_SHOP_PASSWORD',
    enabled: true,
    leased: true,
    leaseOwner: 'run-3:0',
  },
  {
    id: 'p2',
    username: 'problem_user',
    role: 'problem',
    secretRef: 'DEMO_SHOP_PASSWORD',
    enabled: true,
    leased: false,
  },
  {
    id: 'p3',
    username: 'performance_glitch_user',
    role: 'performance',
    secretRef: 'DEMO_SHOP_PASSWORD',
    enabled: true,
    leased: false,
  },
  {
    id: 'p4',
    username: 'locked_out_user',
    role: 'locked',
    secretRef: 'DEMO_SHOP_PASSWORD',
    enabled: false,
    leased: false,
  },
];

export const processes: ProcessView[] = projects[0]!.processes.map((p, i) => ({
  ...p,
  source: 'project',
  lastStatus: i === 0 ? 'passed' : i === 1 ? 'failed' : null,
  lastRunId: i < 2 ? `run-${3 - i}` : null,
  lastRunAt: '2026-09-03T02:00:00Z',
}));

const totals = (passed: number, failed: number, skipped = 0, flaky = 0) => ({
  total: passed + failed + skipped,
  passed,
  failed,
  skipped,
  timedOut: 0,
  flaky,
  healed: flaky ? 1 : 0,
  durationMs: 0,
});

export const runs: RunListItem[] = [
  {
    id: 'run-3',
    projectSlug: 'demo-shop',
    env: 'staging',
    trigger: 'ui',
    status: 'running',
    suiteTag: '@regression',
    tagsExpr: '@regression',
    process: 'nightly-regression',
    layers: ['ui', 'api'],
    browsers: ['chromium', 'firefox'],
    gitBranch: 'main',
    gitSha: 'a823e20f',
    startedAt: new Date(Date.now() - 90_000).toISOString(),
    totals: totals(9, 1, 0, 1),
    startedBy: 'admin',
  },
  {
    id: 'run-2',
    projectSlug: 'demo-shop',
    env: 'staging',
    trigger: 'schedule',
    status: 'failed',
    suiteTag: '@regression',
    tagsExpr: '@regression',
    process: 'nightly-regression',
    layers: ['ui', 'api', 'hybrid'],
    browsers: ['chromium', 'firefox', 'webkit'],
    gitBranch: 'main',
    gitSha: '544d3fcb',
    startedAt: '2026-09-03T02:00:00Z',
    finishedAt: '2026-09-03T02:14:12Z',
    durationMs: 852_000,
    totals: totals(41, 2, 1, 2),
  },
  {
    id: 'run-1',
    projectSlug: 'demo-shop',
    env: 'staging',
    trigger: 'ci',
    status: 'passed',
    suiteTag: '@smoke',
    tagsExpr: '@smoke',
    process: 'pr-check',
    layers: ['ui', 'api'],
    browsers: ['chromium'],
    gitBranch: 'feature/cart',
    gitSha: 'f463876a',
    startedAt: '2026-09-02T18:20:00Z',
    finishedAt: '2026-09-02T18:23:40Z',
    durationMs: 220_000,
    totals: totals(12, 0),
  },
  {
    id: 'run-0',
    projectSlug: 'billing-portal',
    env: 'local',
    trigger: 'cli',
    status: 'passed',
    suiteTag: '@smoke',
    layers: ['api'],
    browsers: [],
    startedAt: '2026-09-01T09:00:00Z',
    finishedAt: '2026-09-01T09:01:00Z',
    durationMs: 60_000,
    totals: totals(3, 0),
  },
];

const scenario = (
  id: string,
  module: string,
  featureUri: string,
  featureName: string,
  name: string,
  status: ScenarioNode['status'],
  extra: Partial<ScenarioNode> = {},
): ScenarioNode => ({
  id,
  fingerprint: id.padEnd(16, '0'),
  module,
  featureUri,
  featureName,
  scenarioName: name,
  pwProject: 'demo-shop--ui--chromium',
  layer: 'ui',
  browser: 'chromium',
  suiteTag: '@regression',
  tags: ['@ui', '@regression', `@${module}`],
  jiraKeys: [],
  status,
  attemptsCount: 1,
  flaky: false,
  healed: 0,
  visual: false,
  durationMs: 4200,
  ...extra,
});

export const scenarios: ScenarioNode[] = [
  scenario(
    's-login-ok',
    'auth',
    'features/auth/login.feature',
    'Login',
    'Successful login',
    'passed',
    { suiteTag: '@smoke', tags: ['@ui', '@smoke', '@auth'] },
  ),
  scenario(
    's-login-locked',
    'auth',
    'features/auth/login.feature',
    'Login',
    'Failed login – locked_out_user',
    'passed',
    { exampleIndex: 0 },
  ),
  scenario(
    's-login-wrong',
    'auth',
    'features/auth/login.feature',
    'Login',
    'Failed login – wrong password',
    'failed',
    {
      exampleIndex: 1,
      errorMessage: "expect(locator).toContainText: Expected 'Username and password do not match'",
      jiraKeys: ['DEMO-12'],
      tags: ['@ui', '@regression', '@auth', '@jira:DEMO-12'],
    },
  ),
  scenario(
    's-inv-list',
    'inventory',
    'features/inventory/inventory.feature',
    'Inventory',
    'Products are displayed',
    'passed',
    { healed: 1, attemptsCount: 2, flaky: true },
  ),
  scenario(
    's-inv-visual',
    'inventory',
    'features/inventory/inventory.feature',
    'Inventory',
    'Inventory page visual baseline',
    'passed',
    { visual: true, tags: ['@ui', '@regression', '@visual', '@inventory'] },
  ),
  scenario(
    's-inv-sort',
    'inventory',
    'features/inventory/inventory.feature',
    'Inventory',
    'Sort products by price',
    'passed',
    { browser: 'firefox', pwProject: 'demo-shop--ui--firefox' },
  ),
  scenario(
    's-cart-add',
    'cart',
    'features/cart/cart.feature',
    'Cart',
    'Add a product to the cart',
    'skipped',
  ),
  scenario(
    's-api-list',
    'posts-api',
    'features/api/posts.feature',
    'Posts API',
    'List posts',
    'passed',
    {
      layer: 'api',
      pwProject: 'demo-shop--api',
      browser: undefined,
      tags: ['@api', '@smoke', '@posts'],
      suiteTag: '@smoke',
    },
  ),
  scenario(
    's-api-create',
    'posts-api',
    'features/api/posts.feature',
    'Posts API',
    'Create a post and read it back',
    'passed',
    {
      layer: 'api',
      pwProject: 'demo-shop--api',
      browser: undefined,
      tags: ['@api', '@regression', '@posts', '@contract'],
    },
  ),
  scenario(
    's-hybrid',
    'hybrid',
    'features/hybrid/seed-then-verify.feature',
    'Seed then verify',
    'API seeds, UI verifies',
    'passed',
    {
      layer: 'hybrid',
      pwProject: 'demo-shop--hybrid--chromium',
      tags: ['@hybrid', '@regression', '@hybrid-demo'],
    },
  ),
];

export function runDetail(id: string): RunDetail {
  const base = runs.find((r) => r.id === id) ?? runs[1]!;
  return {
    ...base,
    command: `automax run -p ${base.projectSlug} -e ${base.env} -t "${base.tagsExpr ?? '@smoke'}"`,
    artifactsDir: `.automax/runs/${base.id}`,
    exitCode: base.status === 'failed' ? 1 : 0,
    reportPaths: {
      html: `/reports/${base.id}/index.html`,
      junit: `/api/runs/${base.id}/files/junit.xml`,
      messages: `/api/runs/${base.id}/files/messages.ndjson`,
      dashboard: `/api/runs/${base.id}/files/dashboard/index.html`,
    },
    scenarios:
      base.projectSlug === 'demo-shop'
        ? scenarios
        : [
            scenario(
              's-bp',
              'invoices',
              'features/invoices/list.feature',
              'Invoices',
              'List invoices',
              'passed',
              {
                layer: 'api',
                pwProject: 'billing-portal--api',
                tags: ['@api', '@smoke', '@invoices'],
              },
            ),
          ],
  };
}

export function scenarioDetail(runId: string, sid: string): ScenarioDetail {
  const s = scenarios.find((x) => x.id === sid) ?? scenarios[0]!;
  const art = (
    name: string,
    phase: string,
    stepIndex: number | null,
    seed: string,
    kind = 'screenshot',
  ) => {
    const sh = shot(seed, phase);
    return {
      id: `${sid}-${name}`,
      url: sh.url,
      kind,
      phase,
      stepIndex,
      fileName: name,
      width: sh.w,
      height: sh.h,
      mediaType: 'image/png',
    };
  };
  const uiSteps = [
    { keyword: 'Given', text: 'I am on the login page' },
    { keyword: 'When', text: 'I login with "standard_user" and "{{standardPassword}}"' },
    { keyword: 'Then', text: 'I should see the inventory page' },
  ];
  const failedIdx = s.status === 'failed' ? 2 : -1;
  const steps = (
    s.layer === 'api'
      ? [
          { keyword: 'When', text: 'I send a GET request to "/posts/1"' },
          { keyword: 'Then', text: 'the response status should be 200' },
          { keyword: 'And', text: 'the response JSON path "userId" should equal "1"' },
        ]
      : uiSteps
  ).map((st, i) => ({
    id: `${sid}-step-${i}`,
    stepIndex: i,
    kind: 'step' as const,
    keyword: st.keyword,
    text: st.text,
    status: (i === failedIdx
      ? 'failed'
      : i > failedIdx && failedIdx >= 0
        ? 'skipped'
        : 'passed') as ScenarioDetail['status'],
    durationMs: 800 + i * 350,
    errorMessage: i === failedIdx ? s.errorMessage : undefined,
    errorStack:
      i === failedIdx
        ? `${s.errorMessage}\n    at LoginPage.assertError (projects/demo-shop/pages/LoginPage.ts:31:5)`
        : undefined,
    definitionLocation:
      s.layer === 'api'
        ? 'packages/core/src/steps/api.steps.ts:42'
        : `projects/demo-shop/pages/LoginPage.ts:${20 + i * 5}`,
    layerHint: (s.layer === 'api' ? 'api' : 'ui') as 'api' | 'ui',
    apiSnapshot:
      s.layer === 'api' && i === 0
        ? {
            request: {
              method: 'GET',
              url: 'https://jsonplaceholder.typicode.com/posts/1',
              headers: { accept: 'application/json', authorization: '***' },
            },
            response: {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'application/json; charset=utf-8' },
              body: { userId: 1, id: 1, title: 'sunt aut facere', body: 'quia et suscipit' },
              responseTime: 133,
            },
            startedAt: '2026-09-03T02:01:00Z',
          }
        : undefined,
    before:
      s.layer !== 'api'
        ? art(`${String(i).padStart(2, '0')}-before.png`, 'before', i, `${s.scenarioName}-${i}`)
        : undefined,
    after:
      s.layer !== 'api'
        ? art(`${String(i).padStart(2, '0')}-after.png`, 'after', i, `${s.scenarioName}-${i}`)
        : undefined,
    visual:
      s.visual && i === 2
        ? {
            name: 'inventory',
            expected: art('inventory-expected.png', 'expected', i, 'inventory-expected'),
            actual: art('inventory-actual.png', 'actual', i, 'inventory-actual'),
            diff: art('inventory-diff.png', 'diff', i, 'inventory-diff'),
          }
        : undefined,
    heals:
      s.healed && i === 1
        ? [
            {
              fingerprint: s.fingerprint,
              runId,
              stepIndex: 1,
              action: 'click' as const,
              description: 'login button',
              pageUrl: 'https://www.saucedemo.com/',
              originalSelector: '#login-button',
              context: { role: 'button', name: 'Login' },
              strategyUsed: 'role',
              healedSelector: "getByRole('button', { name: 'Login' })",
              candidates: [
                {
                  strategy: 'role',
                  selector: "getByRole('button', { name: 'Login' })",
                  score: 0.98,
                },
                { strategy: 'testid', selector: "getByTestId('login-button')", score: 0.95 },
              ],
              succeeded: true,
              durationMs: 312,
              at: '2026-09-03T02:01:03Z',
            },
          ]
        : [],
  }));
  const attempt = (n: number, status: ScenarioDetail['status']) => ({
    id: `${sid}-a${n}`,
    attempt: n,
    status,
    durationMs: 4200,
    errorMessage: status === 'failed' ? (s.errorMessage ?? 'Timeout') : undefined,
    steps,
    scenarioStart:
      s.layer !== 'api'
        ? art('scenario-start.png', 'scenario-start', null, `${s.scenarioName}-start`)
        : undefined,
    scenarioEnd:
      s.layer !== 'api'
        ? art('scenario-end.png', 'scenario-end', null, `${s.scenarioName}-end`)
        : undefined,
    failure:
      status === 'failed'
        ? art('failure.png', 'failure', null, `${s.scenarioName}-fail`)
        : undefined,
    trace:
      status === 'failed' || n > 0
        ? {
            id: `${sid}-trace`,
            url: `/api/artifacts/${sid}-trace`,
            kind: 'trace',
            fileName: 'trace.zip',
            mediaType: 'application/zip',
          }
        : undefined,
  });
  return {
    ...s,
    attempts:
      s.attemptsCount > 1 ? [attempt(0, 'failed'), attempt(1, s.status)] : [attempt(0, s.status)],
    issueLinks: s.jiraKeys.map((k) => ({
      provider: 'jira' as const,
      key: k,
      url: `https://acme.atlassian.net/browse/${k}`,
      status: 'open',
    })),
  };
}

export const features: FeatureFile[] = [
  {
    path: 'auth/login.feature',
    module: 'auth',
    name: 'Login',
    tags: ['@ui', '@auth'],
    scenarios: 2,
  },
  {
    path: 'auth/data-driven-login.feature',
    module: 'auth',
    name: 'Data-driven login',
    tags: ['@ui', '@regression', '@data-driven', '@auth'],
    scenarios: 1,
  },
  {
    path: 'inventory/inventory.feature',
    module: 'inventory',
    name: 'Inventory',
    tags: ['@ui', '@inventory'],
    scenarios: 4,
  },
  { path: 'cart/cart.feature', module: 'cart', name: 'Cart', tags: ['@ui', '@cart'], scenarios: 1 },
  {
    path: 'api/posts.feature',
    module: 'posts-api',
    name: 'Posts API',
    tags: ['@api', '@posts'],
    scenarios: 6,
  },
  {
    path: 'hybrid/seed-then-verify.feature',
    module: 'hybrid',
    name: 'Seed then verify',
    tags: ['@hybrid', '@hybrid-demo'],
    scenarios: 1,
  },
];

export const featureContent: Record<string, string> = {
  'auth/login.feature': `@ui @auth
Feature: Login
  As a shopper I want to log in so that I can see the inventory.

  Background:
    Given I am on the login page

  @smoke @user:standard
  Scenario: Successful login
    When I login with "standard_user" and "{{standardPassword}}"
    Then the page URL should contain "/inventory.html"

  @regression
  Scenario Outline: Failed login
    # title-format: <username> → <error>
    When I login with "<username>" and "<password>"
    Then I should see the login error "<error>"

    Examples:
      | username        | password     | error                                     |
      | locked_out_user | secret_sauce | Sorry, this user has been locked out.     |
      | standard_user   | wrong        | Username and password do not match        |
`,
  'api/posts.feature': `@api @posts
Feature: Posts API

  @smoke
  Scenario: List posts
    When I send a GET request to "/posts"
    Then the response status should be 200
    And the response JSON path "$.length" should equal "100"

  @regression @contract
  Scenario: Create a post and read it back
    When I send a POST request to "/posts" with body:
      """json
      { "title": "AutoMax", "body": "hello", "userId": 1 }
      """
    Then the response status should be 201
    And I save the response JSON path "id" as "postId"
    And the response should match the JSON schema "schemas/post.schema.json"
`,
};

export const steps: StepDef[] = [
  {
    keyword: 'Given',
    pattern: 'I am on the login page',
    file: 'projects/demo-shop/pages/LoginPage.ts',
    line: 18,
    source: 'project',
  },
  {
    keyword: 'When',
    pattern: 'I login with {string} and {string}',
    file: 'projects/demo-shop/pages/LoginPage.ts',
    line: 24,
    source: 'project',
  },
  {
    keyword: 'Then',
    pattern: 'I should see the login error {string}',
    file: 'projects/demo-shop/pages/LoginPage.ts',
    line: 30,
    source: 'project',
  },
  {
    keyword: 'Given',
    pattern: 'I navigate to the {string} page',
    file: 'packages/core/src/steps/ui.steps.ts',
    line: 12,
    source: 'core',
  },
  {
    keyword: 'When',
    pattern: 'I click the {string} {role}',
    file: 'packages/core/src/steps/ui.steps.ts',
    line: 20,
    source: 'core',
  },
  {
    keyword: 'When',
    pattern: 'I fill the {string} field with {string}',
    file: 'packages/core/src/steps/ui.steps.ts',
    line: 28,
    source: 'core',
  },
  {
    keyword: 'Then',
    pattern: 'I should see the text {string}',
    file: 'packages/core/src/steps/ui.steps.ts',
    line: 40,
    source: 'core',
  },
  {
    keyword: 'Then',
    pattern: 'the page URL should contain {string}',
    file: 'packages/core/src/steps/ui.steps.ts',
    line: 48,
    source: 'core',
  },
  {
    keyword: 'When',
    pattern: 'I send a {method} request to {string}',
    file: 'packages/core/src/steps/api.steps.ts',
    line: 30,
    source: 'core',
  },
  {
    keyword: 'When',
    pattern: 'I send a {method} request to {string} with body:',
    file: 'packages/core/src/steps/api.steps.ts',
    line: 36,
    source: 'core',
  },
  {
    keyword: 'Then',
    pattern: 'the response status should be {int}',
    file: 'packages/core/src/steps/api.steps.ts',
    line: 50,
    source: 'core',
  },
  {
    keyword: 'Then',
    pattern: 'the response JSON path {string} should equal {string}',
    file: 'packages/core/src/steps/api.steps.ts',
    line: 56,
    source: 'core',
  },
  {
    keyword: 'When',
    pattern: 'I save the response JSON path {string} as {string}',
    file: 'packages/core/src/steps/api.steps.ts',
    line: 70,
    source: 'core',
  },
  {
    keyword: 'Then',
    pattern: 'the response should match the JSON schema {string}',
    file: 'packages/core/src/steps/api.steps.ts',
    line: 64,
    source: 'core',
  },
  {
    keyword: 'Given',
    pattern: 'I load dataset {string} row {int}',
    file: 'packages/core/src/steps/data.steps.ts',
    line: 10,
    source: 'core',
  },
  {
    keyword: 'Given',
    pattern: 'I use a leased user with role {string}',
    file: 'packages/core/src/steps/data.steps.ts',
    line: 22,
    source: 'core',
  },
];

export const agentJobs: AgentJob[] = [
  {
    id: 'job-2',
    projectSlug: 'demo-shop',
    kind: 'heal',
    goal: 'Heal "Failed login – wrong password"',
    status: 'awaiting_review',
    provider: 'claude',
    model: 'claude-opus-5',
    costUsd: 0.42,
    turns: 9,
    proposalId: 'prop-2',
    summary: 'Replaced #login-button with getByRole and tightened the error assertion.',
    startedAt: '2026-09-03T02:20:00Z',
    finishedAt: '2026-09-03T02:24:00Z',
  },
  {
    id: 'job-1',
    projectSlug: 'demo-shop',
    kind: 'generate',
    goal: 'Checkout with a discount code',
    status: 'accepted',
    provider: 'fake',
    model: 'fake',
    costUsd: 0,
    turns: 4,
    proposalId: 'prop-1',
    summary: 'Added checkout.feature with 3 scenarios reusing 5 existing steps.',
    startedAt: '2026-09-02T12:00:00Z',
    finishedAt: '2026-09-02T12:03:00Z',
  },
];

export const proposals: Proposal[] = [
  {
    id: 'prop-2',
    role: 'healer',
    project: 'demo-shop',
    status: 'pending',
    summary: 'Replace fragile #login-button locator with a role locator.',
    files: [{ path: 'projects/demo-shop/pages/LoginPage.ts', op: 'modify' }],
    diffText: `diff --git a/projects/demo-shop/pages/LoginPage.ts b/projects/demo-shop/pages/LoginPage.ts
--- a/projects/demo-shop/pages/LoginPage.ts
+++ b/projects/demo-shop/pages/LoginPage.ts
@@ -12,7 +12,8 @@ export class LoginPage extends BasePage {
-  readonly submit = this.page.locator('#login-button');
+  readonly submit = this.heal.locator(this.page.getByRole('button', { name: 'Login' }), {
+    role: 'button', name: 'Login', testId: 'login-button', description: 'login button',
+  });
`,
    costUsd: 0.42,
    createdAt: '2026-09-03T02:24:00Z',
  },
  {
    id: 'prop-1',
    role: 'generator',
    project: 'demo-shop',
    status: 'accepted',
    summary: 'checkout.feature + CheckoutPage',
    files: [
      { path: 'projects/demo-shop/features/cart/checkout.feature', op: 'add' },
      { path: 'projects/demo-shop/pages/CheckoutPage.ts', op: 'add' },
    ],
    createdAt: '2026-09-02T12:03:00Z',
  },
];

export const integrations: Record<string, IntegrationView[]> = {
  'demo-shop': [
    {
      provider: 'github',
      enabled: true,
      config: {
        owner: 'siri1410',
        repo: 'AutoMax',
        checkRun: true,
        prComment: true,
        createIssueOnFailure: 'smoke',
        labels: ['automax'],
      },
      secretEnv: { token: 'GITHUB_TOKEN' },
      secretsPresent: { GITHUB_TOKEN: true },
      lastSyncAt: '2026-09-03T02:15:00Z',
    },
    {
      provider: 'jira',
      enabled: false,
      config: {
        baseUrl: 'https://acme.atlassian.net',
        projectKey: 'DEMO',
        issueType: 'Bug',
        transitionOnPass: 'Done',
      },
      secretEnv: { email: 'JIRA_EMAIL', token: 'JIRA_API_TOKEN' },
      secretsPresent: { JIRA_EMAIL: false, JIRA_API_TOKEN: false },
    },
    {
      provider: 'mcp:playwright',
      enabled: true,
      config: { transport: 'stdio', command: 'npx', args: ['playwright', 'mcp', '--headless'] },
      secretEnv: {},
      secretsPresent: {},
    },
    {
      provider: 'mcp:github',
      enabled: false,
      config: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        allowedTools: ['search_issues', 'create_issue'],
      },
      secretEnv: { GITHUB_PERSONAL_ACCESS_TOKEN: 'GITHUB_TOKEN' },
      secretsPresent: { GITHUB_TOKEN: true },
    },
  ],
  'billing-portal': [],
};

export const schedules: Schedule[] = [
  {
    id: 'sch-1',
    projectSlug: 'demo-shop',
    name: 'smoke-hourly',
    cron: '0 * * * *',
    timezone: 'UTC',
    tags: '@smoke',
    browsers: ['chromium'],
    harMode: 'replay',
    overlap: 'skip',
    jitterSeconds: 0,
    catchUp: false,
    enabled: false,
    notify: [],
    nextRunAt: null,
    lastRunId: null,
    lastStatus: null,
    source: 'yaml',
  },
  {
    id: 'sch-2',
    projectSlug: 'demo-shop',
    name: 'nightly-matrix',
    cron: '0 2 * * *',
    timezone: 'America/New_York',
    tags: '@regression',
    browsers: ['chromium', 'firefox', 'webkit'],
    overlap: 'skip',
    jitterSeconds: 60,
    catchUp: false,
    enabled: true,
    notify: ['github'],
    nextRunAt: '2026-09-04T06:00:00Z',
    lastRunId: 'run-2',
    lastStatus: 'failed',
    source: 'db',
  },
];

export const users: UserRow[] = [
  {
    id: 'u1',
    username: 'admin',
    email: 'admin@example.com',
    role: 'admin',
    active: true,
    lastLoginAt: '2026-09-03T08:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'u2',
    username: 'maria',
    email: 'maria@example.com',
    role: 'editor',
    active: true,
    lastLoginAt: '2026-09-02T15:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
  },
  { id: 'u3', username: 'viewer', role: 'viewer', active: true, createdAt: '2026-09-02T00:00:00Z' },
];

export const tokens: ApiToken[] = [
  {
    id: 't1',
    name: 'ci',
    prefix: 'amx_9f2ab1c0d3e4',
    scopes: ['runs:ingest', 'runs:read'],
    expiresAt: '2026-12-01T00:00:00Z',
    lastUsedAt: '2026-09-03T02:15:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    owner: 'admin',
  },
  {
    id: 't2',
    name: 'claude-code',
    prefix: 'amx_11aa22bb33cc',
    scopes: ['projects:read', 'runs:read', 'runs:write', 'features:read', 'features:write'],
    lastUsedAt: null,
    createdAt: '2026-09-02T00:00:00Z',
    owner: 'admin',
  },
];

export const trends: Trends = {
  runs: Array.from({ length: 14 }, (_, i) => ({
    runId: `r${i}`,
    startedAt: new Date(Date.now() - (13 - i) * 86_400_000).toISOString(),
    passRate: [0.92, 0.95, 0.9, 1, 0.97, 0.88, 0.99, 1, 0.94, 0.96, 1, 0.93, 0.95, 0.9][i]!,
    durationMs: 600_000 + ((i * 37) % 11) * 20_000,
    flakyRate: [0.02, 0.04, 0.03, 0, 0.02, 0.06, 0.01, 0, 0.03, 0.02, 0, 0.04, 0.03, 0.05][i]!,
    process: i % 2 ? 'nightly-regression' : 'pr-check',
    env: 'staging',
  })),
  flaky: [
    {
      fingerprint: 's-inv-list',
      scenarioName: 'Products are displayed',
      featureUri: 'features/inventory/inventory.feature',
      pwProject: 'demo-shop--ui--webkit',
      flakyRate: 0.25,
      runsCount: 20,
      quarantined: false,
    },
    {
      fingerprint: 's-login-wrong',
      scenarioName: 'Failed login – wrong password',
      featureUri: 'features/auth/login.feature',
      pwProject: 'demo-shop--ui--chromium',
      flakyRate: 0.1,
      runsCount: 20,
      quarantined: false,
    },
  ],
  locators: [
    {
      selector: '#login-button',
      pageHint: '/',
      failCount: 6,
      healCount: 4,
      lastStrategy: 'role',
      suggestedSelector: "getByRole('button', { name: 'Login' })",
    },
    {
      selector: '.inventory_item:nth-child(3) button',
      pageHint: '/inventory.html',
      failCount: 3,
      healCount: 1,
      lastStrategy: 'testid',
      suggestedSelector: "getByTestId('add-to-cart-sauce-labs-bolt-t-shirt')",
    },
  ],
  health: [
    { process: 'pr-check', score: 0.97, passRate: 1, flaky: 0.01, fragility: 0.05 },
    { process: 'nightly-regression', score: 0.88, passRate: 0.95, flaky: 0.04, fragility: 0.1 },
    { process: 'release-gate', score: 0.91, passRate: 0.98, flaky: 0.02, fragility: 0.08 },
  ],
};

export const png1x1 = PNG_1x1;
