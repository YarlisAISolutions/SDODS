import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
let repoLabels: Array<{ name: string }> = [{ name: 'sdods' }];
let searchItems: Array<{ number: number; html_url: string; body: string; state: string }> = [];
const searches: string[] = [];

const server = setupServer(
  http.get(`${API}/repos/acme/shop`, () =>
    HttpResponse.json({ full_name: 'acme/shop', private: false }),
  ),
  http.get(`${API}/search/issues`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    searches.push(q);
    return HttpResponse.json({
      total_count: searchItems.length,
      incomplete_results: false,
      items: searchItems,
    });
  }),
  http.get(`${API}/repos/acme/shop/labels`, () => HttpResponse.json(repoLabels)),
  http.post(`${API}/repos/acme/shop/labels`, async ({ request }) => {
    const body = (await request.json()) as { name: string };
    calls.push({ method: 'POST', path: 'labels', body });
    return HttpResponse.json({ name: body.name }, { status: 201 });
  }),
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
  repoLabels = [{ name: 'sdods' }];
  searchItems = [];
  searches.length = 0;
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

/** A trace may be named by its local path, never linked or uploaded anywhere a reader can fetch it. */
function expectNoRemoteTrace(body: string) {
  expect(body).not.toMatch(/https?:\/\/\S*trace[^\s)]*\.zip/);
  expect(body).not.toMatch(/\]\([^)]*trace[^)]*\)/);
  expect(body).not.toMatch(/show-trace\s+['"]?https?:/);
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
    const second = await p.onRunFinished(
      { ...summary([scenario()]), run: { ...run, id: 'run-2' } },
      ctx,
    );
    expect(calls.filter((c) => c.path === 'issues')).toHaveLength(0);
    expect(calls.find((c) => c.path === 'issues/101/comments')!.body.body).toContain(
      'Failed again in run `run-2`',
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

  // ── issue #82 ──────────────────────────────────────────────────────────────

  it('test() reports configured labels the repository is missing', async () => {
    repoLabels = [{ name: 'sdods' }, { name: 'bug' }];
    const p = await provider({ labels: ['sdods', 'type:bug', 'source:e2e'] });
    const res = await p.test();
    expect(res.ok).toBe(false);
    expect(res.labels).toEqual({ missing: ['type:bug', 'source:e2e'], created: [] });
    expect(res.detail).toContain('missing labels: type:bug, source:e2e');
    expect(res.detail).toContain('--create-labels');
    expect(calls.filter((c) => c.path === 'labels')).toHaveLength(0);
  });

  it('test({ createMissingLabels }) creates exactly the missing labels', async () => {
    repoLabels = [{ name: 'SDODS' }];
    const p = await provider({ labels: ['sdods', 'type:bug', 'source:e2e'] });
    const res = await p.test({ createMissingLabels: true });
    expect(res.ok).toBe(true);
    expect(res.labels).toEqual({ missing: [], created: ['type:bug', 'source:e2e'] });
    expect(calls.filter((c) => c.path === 'labels').map((c) => c.body.name)).toEqual([
      'type:bug',
      'source:e2e',
    ]);
  });

  it('reuses an open issue found by fingerprint search when the local store is empty', async () => {
    searchItems = [
      {
        number: 7,
        html_url: 'https://github.test/acme/shop/issues/7',
        state: 'open',
        body: 'older body\n<!-- sdods-fingerprint:fp-login -->',
      },
    ];
    const p = await provider();
    const store = createMemoryStore(); // a fresh CI runner: no .sdods/issue-links.json
    const ctx = createIntegrationContext({ store, env: {} as any });
    const res = await p.onRunFinished(summary([scenario()]), ctx);
    expect(searches).toEqual([
      'repo:acme/shop is:issue is:open in:body "sdods-fingerprint:fp-login"',
    ]);
    expect(calls.filter((c) => c.path === 'issues')).toHaveLength(0);
    expect(calls.find((c) => c.path === 'issues/7/comments')!.body.body).toContain(
      'Failed again in run `run-1`',
    );
    expect(res.actions[0]).toMatchObject({ kind: 'issue-commented', target: 'acme/shop#7' });
    expect(await store.findOpen('shop', 'github', 'fp-login')).toMatchObject({
      externalKey: 'acme/shop#7',
      source: 'auto',
    });
  });

  it('creates an issue when search hits do not carry the exact fingerprint marker', async () => {
    searchItems = [
      {
        number: 8,
        html_url: 'https://github.test/acme/shop/issues/8',
        state: 'open',
        body: 'sdods-fingerprint:fp-login-other',
      },
    ];
    const p = await provider();
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: {} as any });
    const res = await p.onRunFinished(summary([scenario()]), ctx);
    expect(calls.filter((c) => c.path === 'issues')).toHaveLength(1);
    expect(res.actions[0]).toMatchObject({ kind: 'issue-created', target: 'acme/shop#101' });
  });

  it('does not comment twice for the same run', async () => {
    const p = await provider();
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: {} as any });
    await p.onRunFinished(summary([scenario()]), ctx);
    calls.length = 0;
    const again = await p.onRunFinished(summary([scenario()]), ctx);
    expect(calls).toHaveLength(0);
    expect(again.actions[0]).toMatchObject({ kind: 'skipped' });
  });

  it('links video.webm but only names trace.zip locally, with a credentials warning', async () => {
    const p = await provider();
    const artifactsDir = join(process.cwd(), '.sdods', 'runs', 'run-1');
    const ctx = createIntegrationContext({
      store: createMemoryStore(),
      env: {} as any,
      publicUrl: 'https://sdods.test',
    });
    await p.onRunFinished(
      {
        ...summary([
          scenario({
            videoPath: 'runner-output/login-chromium/video.webm',
            tracePath: 'runner-output/login-chromium/trace.zip',
          }),
        ]),
        run: { ...run, artifactsDir },
      },
      ctx,
    );
    const body: string = calls.find((c) => c.path === 'issues')!.body.body;
    expect(body).toContain('### Video and trace');
    expect(body).toContain(
      '- Video: https://sdods.test/api/runs/run-1/files/runner-output/login-chromium/video.webm',
    );
    expect(body).toContain('`.sdods/runs/run-1/runner-output/login-chromium/trace.zip`');
    expect(body).toContain('contains credentials');
    expect(body).toContain(
      'npx playwright show-trace .sdods/runs/run-1/runner-output/login-chromium/trace.zip',
    );
    expectNoRemoteTrace(body);
  });

  it('names the trace inside the CI run artifacts without linking it', async () => {
    const p = await provider();
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: ciEnv as any });
    await p.onRunFinished(
      summary([scenario({ tracePath: 'runner-output/login-chromium/trace.zip' })]),
      { ...ctx, ci: { ...ctx.ci, isPullRequest: false, sha: undefined } },
    );
    const body: string = calls.find((c) => c.path === 'issues')!.body.body;
    expect(body).toContain('`run-1/runner-output/login-chromium/trace.zip`');
    expect(body).toContain('contains credentials');
    expect(body).toContain(
      'npx playwright show-trace run-1/runner-output/login-chromium/trace.zip',
    );
    expect(body).not.toContain('- Video:');
    expectNoRemoteTrace(body);
  });

  it('never uploads trace.zip to a release, even with uploadToRelease set', async () => {
    const uploads: string[] = [];
    const record = ({ request }: { request: Request }) => {
      const name = new URL(request.url).searchParams.get('name') ?? '';
      uploads.push(name);
      return HttpResponse.json(
        {
          browser_download_url: `https://github.test/acme/shop/releases/download/evidence/${name}`,
        },
        { status: 201 },
      );
    };
    server.use(
      http.get(`${API}/repos/acme/shop/releases/tags/evidence`, () => HttpResponse.json({ id: 5 })),
      http.post(`${API}/repos/acme/shop/releases/5/assets`, record),
      http.post('https://uploads.github.com/repos/acme/shop/releases/5/assets', record),
    );
    const artifactsDir = mkdtempSync(join(tmpdir(), 'sdods-gh-trace-'));
    const media = {
      'runner-output/login-chromium/video.webm': 'webm',
      'runner-output/login-chromium/trace.zip': 'PK Cookie: __session=s3cr3t',
      'shop/fp-login/r0/scenario-failure.png': 'png',
    };
    for (const [rel, text] of Object.entries(media)) {
      mkdirSync(join(artifactsDir, rel, '..'), { recursive: true });
      writeFileSync(join(artifactsDir, rel), text);
    }
    const p = await provider({ uploadToRelease: 'evidence' });
    const ctx = createIntegrationContext({
      store: createMemoryStore(),
      env: {} as any,
      publicUrl: 'https://sdods.test',
    });
    await p.onRunFinished(
      {
        ...summary([
          scenario({
            videoPath: 'runner-output/login-chromium/video.webm',
            tracePath: 'runner-output/login-chromium/trace.zip',
          }),
        ]),
        run: { ...run, artifactsDir },
      },
      ctx,
    );
    // The screenshot and the video are still published; the trace never is.
    expect(uploads).toEqual(['run-1-scenario-failure.png', 'run-1-video.webm']);
    const body: string = calls.find((c) => c.path === 'issues')!.body.body;
    expect(body).toContain(
      '- Video: https://github.test/acme/shop/releases/download/evidence/run-1-video.webm',
    );
    expectNoRemoteTrace(body);
  });
});
