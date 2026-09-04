import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GitHubIntegrationSchema, type RunRecord } from '@sdods/contracts';
import { GitHubProvider, PR_COMMENT_MARKER } from '../src/github.js';
import { createIntegrationContext } from '../src/context.js';
import { createMemoryStore } from '../src/store.js';
import type { RunSummaryInput, ScenarioSummary } from '../src/types.js';

const API = 'https://api.github.test';
const calls: Array<{ method: string; path: string; body: any }> = [];
let comments: Array<{ id: number; body: string; html_url: string }> = [];
let issueSeq = 100;

const server = setupServer(
  http.get(`${API}/repos/acme/shop`, () =>
    HttpResponse.json({ full_name: 'acme/shop', private: false }),
  ),
  http.post(`${API}/repos/acme/shop/check-runs`, async ({ request }) => {
    const body = await request.json();
    calls.push({ method: 'POST', path: 'check-runs', body });
    return HttpResponse.json(
      { id: 77, html_url: 'https://github.test/acme/shop/runs/77' },
      { status: 201 },
    );
  }),
  http.patch(`${API}/repos/acme/shop/check-runs/77`, async ({ request }) => {
    calls.push({ method: 'PATCH', path: 'check-runs/77', body: await request.json() });
    return HttpResponse.json({ id: 77 });
  }),
  http.get(`${API}/repos/acme/shop/issues/:num/comments`, () => HttpResponse.json(comments)),
  http.post(`${API}/repos/acme/shop/issues/:num/comments`, async ({ request, params }) => {
    const body = (await request.json()) as { body: string };
    calls.push({ method: 'POST', path: `issues/${params.num}/comments`, body });
    const c = {
      id: comments.length + 1,
      body: body.body,
      html_url: `https://github.test/c/${comments.length + 1}`,
    };
    comments.push(c);
    return HttpResponse.json(c, { status: 201 });
  }),
  http.patch(`${API}/repos/acme/shop/issues/comments/:id`, async ({ request, params }) => {
    const body = (await request.json()) as { body: string };
    calls.push({ method: 'PATCH', path: `comments/${params.id}`, body });
    return HttpResponse.json({
      id: Number(params.id),
      html_url: `https://github.test/c/${params.id}`,
      body: body.body,
    });
  }),
  http.post(`${API}/repos/acme/shop/issues`, async ({ request }) => {
    const body = await request.json();
    calls.push({ method: 'POST', path: 'issues', body });
    const number = ++issueSeq;
    return HttpResponse.json(
      { number, html_url: `https://github.test/acme/shop/issues/${number}`, state: 'open' },
      { status: 201 },
    );
  }),
  http.get(`${API}/repos/acme/shop/issues/:num`, ({ params }) =>
    HttpResponse.json({
      number: Number(params.num),
      html_url: `https://github.test/acme/shop/issues/${params.num}`,
      state: Number(params.num) === 42 ? 'closed' : 'open',
    }),
  ),
  http.patch(`${API}/repos/acme/shop/issues/:num`, async ({ request, params }) => {
    calls.push({ method: 'PATCH', path: `issues/${params.num}`, body: await request.json() });
    return HttpResponse.json({ number: Number(params.num), state: 'closed' });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  calls.length = 0;
  comments = [];
  issueSeq = 100;
});
afterAll(() => server.close());

const run: RunRecord = {
  id: 'run-1',
  projectSlug: 'shop',
  env: 'staging',
  trigger: 'ci',
  status: 'failed',
  layers: ['ui'],
  browsers: ['chromium'],
  gitSha: 'abcdef1234567890',
  gitBranch: 'feature/x',
};

function scenario(over: Partial<ScenarioSummary> = {}): ScenarioSummary {
  return {
    fingerprint: 'fp-login',
    featureUri: 'features/ui/login.feature',
    featureName: 'Login',
    scenarioName: 'Successful login',
    line: 12,
    runnerProject: 'shop--ui--chromium',
    layer: 'ui',
    browser: 'chromium',
    suiteTag: '@smoke',
    tags: ['@ui', '@smoke'],
    status: 'failed',
    flaky: false,
    attemptsCount: 1,
    errorMessage: "locator.click: Timeout 15000ms exceeded\nwaiting for locator('#login-button')",
    steps: [
      { index: 0, keyword: 'Given', text: 'I am on the login page', status: 'passed' },
      {
        index: 1,
        keyword: 'When',
        text: 'I login with "standard_user" and "secret"',
        status: 'failed',
        errorMessage: 'Timeout',
      },
    ],
    screenshots: [{ relPath: 'shop/fp-login/r0/scenario-failure.png', phase: 'failure' }],
    jiraKeys: [],
    githubIssues: [],
    ...over,
  };
}

function summary(scenarios: ScenarioSummary[]): RunSummaryInput {
  const failed = scenarios.filter((s) => s.status === 'failed');
  const passed = scenarios.filter((s) => s.status === 'passed');
  return {
    run,
    totals: {
      total: scenarios.length,
      passed: passed.length,
      failed: failed.length,
      skipped: 0,
      timedOut: 0,
      flaky: scenarios.filter((s) => s.flaky).length,
      healed: 0,
      durationMs: 4200,
    },
    scenarios,
    failed,
    flaky: scenarios.filter((s) => s.flaky),
    passed,
    reportUrl: 'https://reports.test/run-1',
  };
}

async function provider(overrides: Record<string, unknown> = {}) {
  const p = new GitHubProvider({ baseUrl: API });
  const cfg = GitHubIntegrationSchema.parse({
    enabled: true,
    owner: 'acme',
    repo: 'shop',
    createIssueOnFailure: 'always',
    ...overrides,
  });
  await p.init(cfg, { token: 'ghp_test' });
  return p;
}

const ciEnv = {
  GITHUB_ACTIONS: 'true',
  GITHUB_SHA: 'abcdef1234567890',
  GITHUB_REF: 'refs/pull/9/merge',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REPOSITORY: 'acme/shop',
  GITHUB_RUN_ID: '555',
  GITHUB_SERVER_URL: 'https://github.test',
};

describe('GitHubProvider', () => {
  it('test() reports the repository', async () => {
    const p = await provider();
    expect(await p.test()).toEqual({ ok: true, detail: 'repo acme/shop reachable (public)' });
  });

  it('publishes a check run with failure annotations and upserts the PR comment', async () => {
    const p = await provider();
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: ciEnv as any });
    const s = summary([
      scenario(),
      scenario({
        fingerprint: 'fp-ok',
        scenarioName: 'Products listed',
        status: 'passed',
        errorMessage: undefined,
      }),
    ]);
    const res = await p.onRunFinished(s, ctx);
    const check = calls.find((c) => c.path === 'check-runs')!;
    expect(check.body.name).toBe('SDODS / shop / chromium');
    expect(check.body.conclusion).toBe('failure');
    expect(check.body.head_sha).toBe('abcdef1234567890');
    expect(check.body.output.annotations).toHaveLength(1);
    expect(check.body.output.annotations[0]).toMatchObject({
      path: 'features/ui/login.feature',
      start_line: 12,
      annotation_level: 'failure',
    });
    const pr = calls.find((c) => c.path === 'issues/9/comments')!;
    expect(pr.body.body).toContain(PR_COMMENT_MARKER);
    expect(pr.body.body).toContain('| 2 | 1 | 1 |');
    expect(res.actions.map((a) => a.kind)).toEqual(['check-run', 'pr-comment', 'issue-created']);

    // second run: PR comment is updated, not duplicated
    calls.length = 0;
    await p.onRunFinished(s, ctx);
    expect(calls.some((c) => c.path === 'comments/1' && c.method === 'PATCH')).toBe(true);
    expect(calls.filter((c) => c.path === 'issues/9/comments' && c.method === 'POST')).toHaveLength(
      0,
    );
  });

  it('creates one issue per fingerprint and comments on repeats; comments/closes when passing again', async () => {
    const p = await provider({ closeOnPass: true });
    const store = createMemoryStore();
    const ctx = createIntegrationContext({
      store,
      env: {} as any,
      publicUrl: 'https://sdods.test',
    });
    const first = await p.onRunFinished(summary([scenario()]), ctx);
    const created = calls.find((c) => c.path === 'issues')!;
    expect(created.body.title).toBe('[SDODS] Login › Successful login failing (chromium)');
    expect(created.body.body).toContain('```gherkin');
    expect(created.body.body).toContain('sdods-fingerprint:fp-login');
    expect(created.body.body).toContain(
      'https://sdods.test/api/runs/run-1/files/shop/fp-login/r0/scenario-failure.png',
    );
    expect(created.body.labels).toEqual(['sdods']);
    expect(first.actions[0]).toMatchObject({ kind: 'issue-created', target: 'acme/shop#101' });

    calls.length = 0;
    const second = await p.onRunFinished(summary([scenario()]), ctx);
    expect(calls.filter((c) => c.path === 'issues')).toHaveLength(0);
    expect(calls.find((c) => c.path === 'issues/101/comments')!.body.body).toContain(
      'Failed again in run `run-1`',
    );
    expect(second.actions[0]).toMatchObject({ kind: 'issue-commented', target: 'acme/shop#101' });

    calls.length = 0;
    const third = await p.onRunFinished(
      summary([scenario({ status: 'passed', errorMessage: undefined })]),
      ctx,
    );
    expect(calls.find((c) => c.path === 'issues/101' && c.method === 'PATCH')!.body).toMatchObject({
      state: 'closed',
    });
    expect(third.actions[0]).toMatchObject({ kind: 'issue-closed' });
    expect(await store.findOpen('shop', 'github', 'fp-login')).toBeUndefined();
  });

  it('respects createIssueOnFailure: smoke and dry-run', async () => {
    const p = await provider({ createIssueOnFailure: 'smoke' });
    const ctx = createIntegrationContext({
      store: createMemoryStore(),
      env: {} as any,
      dryRun: true,
    });
    const res = await p.onRunFinished(
      summary([
        scenario({ suiteTag: '@regression', tags: ['@ui', '@regression'] }),
        scenario({ fingerprint: 'fp-smoke' }),
      ]),
      ctx,
    );
    expect(calls).toHaveLength(0);
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toMatchObject({ kind: 'issue-created', fingerprint: 'fp-smoke' });
    expect(res.actions[0]!.detail).toContain('[dry-run]');
  });

  it('links and syncs issue statuses', async () => {
    const p = await provider();
    const ref = await p.linkIssue('fp-x', '#42');
    expect(ref).toEqual({
      provider: 'github',
      key: 'acme/shop#42',
      url: 'https://github.test/acme/shop/issues/42',
      status: 'closed',
    });
    const synced = await p.syncStatuses([
      {
        id: '1',
        projectSlug: 'shop',
        provider: 'github',
        fingerprint: 'fp-x',
        scenarioName: 'x',
        externalKey: 'acme/shop#7',
        externalUrl: '',
        status: 'open',
        source: 'tag',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    expect(synced[0]!.status).toBe('open');
  });
});
