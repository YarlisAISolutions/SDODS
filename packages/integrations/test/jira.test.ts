import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JiraIntegrationSchema, type RunRecord } from '@sdods/contracts';
import { JiraProvider } from '../src/jira.js';
import { createIntegrationContext } from '../src/context.js';
import { createMemoryStore } from '../src/store.js';
import type { RunSummaryInput, ScenarioSummary } from '../src/types.js';

const BASE = 'https://acme.atlassian.test';
const calls: Array<{ method: string; path: string; body: any; headers: Record<string, string> }> =
  [];
let jqlIssues: any[] = [];
let seq = 0;

const server = setupServer(
  http.get(`${BASE}/rest/api/3/myself`, ({ request }) => {
    calls.push({
      method: 'GET',
      path: 'myself',
      body: null,
      headers: Object.fromEntries(request.headers),
    });
    return HttpResponse.json({ displayName: 'SDODS Bot' });
  }),
  http.get(`${BASE}/rest/api/3/project/SHOP`, () =>
    HttpResponse.json({ key: 'SHOP', name: 'Shop' }),
  ),
  http.post(`${BASE}/rest/api/3/search/jql`, async ({ request }) => {
    calls.push({ method: 'POST', path: 'search/jql', body: await request.json(), headers: {} });
    return HttpResponse.json({ issues: jqlIssues });
  }),
  http.post(`${BASE}/rest/api/3/issue`, async ({ request }) => {
    calls.push({ method: 'POST', path: 'issue', body: await request.json(), headers: {} });
    return HttpResponse.json({ id: '1', key: `SHOP-${++seq}` }, { status: 201 });
  }),
  http.post(`${BASE}/rest/api/3/issue/:key/attachments`, async ({ request, params }) => {
    const form = await request.formData();
    calls.push({
      method: 'POST',
      path: `issue/${params.key}/attachments`,
      body: form.getAll('file').map((f) => (f as File).name),
      headers: Object.fromEntries(request.headers),
    });
    return HttpResponse.json([{ id: '9' }]);
  }),
  http.post(`${BASE}/rest/api/3/issue/:key/comment`, async ({ request, params }) => {
    calls.push({
      method: 'POST',
      path: `issue/${params.key}/comment`,
      body: await request.json(),
      headers: {},
    });
    return HttpResponse.json({ id: '1' }, { status: 201 });
  }),
  http.get(`${BASE}/rest/api/3/issue/:key`, ({ params }) =>
    HttpResponse.json({
      key: params.key,
      fields: {
        status: { statusCategory: { key: params.key === 'SHOP-42' ? 'done' : 'indeterminate' } },
      },
    }),
  ),
  http.get(`${BASE}/rest/api/3/issue/:key/transitions`, () =>
    HttpResponse.json({
      transitions: [
        { id: '31', name: 'Done' },
        { id: '21', name: 'In Progress' },
      ],
    }),
  ),
  http.post(`${BASE}/rest/api/3/issue/:key/transitions`, async ({ request, params }) => {
    calls.push({
      method: 'POST',
      path: `issue/${params.key}/transitions`,
      body: await request.json(),
      headers: {},
    });
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  calls.length = 0;
  jqlIssues = [];
});
afterAll(() => server.close());

const run: RunRecord = {
  id: 'run-7',
  projectSlug: 'shop',
  env: 'staging',
  trigger: 'cli',
  status: 'failed',
  layers: ['ui'],
  browsers: ['chromium'],
};

function scenario(over: Partial<ScenarioSummary> = {}): ScenarioSummary {
  return {
    fingerprint: 'fp-cart',
    featureUri: 'features/ui/cart.feature',
    featureName: 'Cart',
    scenarioName: 'Add product',
    pwProject: 'shop--ui--chromium',
    layer: 'ui',
    browser: 'chromium',
    suiteTag: '@regression',
    tags: ['@ui', '@regression', '@jira:SHOP-42'],
    status: 'failed',
    flaky: false,
    attemptsCount: 1,
    errorMessage: 'expect(received).toBe(expected)',
    steps: [{ index: 0, keyword: 'When', text: 'I add the product', status: 'failed' }],
    screenshots: [
      { relPath: 'shop/fp-cart/r0/scenario-failure.png', phase: 'failure' },
      { relPath: 'shop/fp-cart/r0/00-after.png', phase: 'after', stepIndex: 0 },
    ],
    jiraKeys: ['SHOP-42'],
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
      flaky: 0,
      healed: 0,
      durationMs: 1000,
    },
    scenarios,
    failed,
    flaky: [],
    passed,
  };
}

async function provider(over: Record<string, unknown> = {}) {
  const p = new JiraProvider();
  const cfg = JiraIntegrationSchema.parse({
    enabled: true,
    baseUrl: BASE,
    projectKey: 'SHOP',
    createIssueOnFailure: 'always',
    transitionOnPass: 'Done',
    ...over,
  });
  await p.init(cfg, { token: 'tok', email: 'bot@acme.test' });
  return p;
}

describe('JiraProvider', () => {
  it('authenticates with basic auth and tests the project', async () => {
    const p = await provider();
    const res = await p.test();
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('SDODS Bot');
    expect(calls[0]!.headers.authorization).toBe(
      `Basic ${Buffer.from('bot@acme.test:tok').toString('base64')}`,
    );
  });

  it('creates an issue with ADF description, attachments (size-capped) and links tagged scenarios', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdods-jira-'));
    const runDir = join(dir, 'run-7');
    for (const rel of ['shop/fp-cart/r0/scenario-failure.png', 'shop/fp-cart/r0/00-after.png']) {
      const file = join(runDir, rel);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, Buffer.alloc(rel.includes('after') ? 2 * 1024 * 1024 : 1024));
    }
    const p = await provider({ maxAttachmentMb: 1 });
    const store = createMemoryStore();
    const ctx = createIntegrationContext({ store, artifactsRoot: dir, env: {} as any });
    const res = await p.onRunFinished(summary([scenario()]), ctx);
    const created = calls.find((c) => c.path === 'issue')!;
    expect(created.body.fields.project.key).toBe('SHOP');
    expect(created.body.fields.summary).toBe('[SDODS] Cart › Add product failing (chromium)');
    expect(created.body.fields.description.type).toBe('doc');
    expect(JSON.stringify(created.body.fields.description)).toContain('sdods-fingerprint:fp-cart');
    const attach = calls.find((c) => c.path === 'issue/SHOP-1/attachments')!;
    expect(attach.headers['x-atlassian-token']).toBe('no-check');
    expect(attach.body).toEqual(['failure-scenario-failure.png']); // 2 MB file exceeds the 1 MB cap
    expect(res.actions.map((a) => a.kind)).toEqual(['issue-created']);
    const links = await store.list('shop', 'jira');
    expect(links.map((l) => [l.externalKey, l.source, l.status])).toEqual([
      ['SHOP-1', 'auto', 'open'],
      ['SHOP-42', 'tag', 'closed'],
    ]);
  });

  it('falls back to JQL to find an existing issue and comments instead of creating', async () => {
    jqlIssues = [
      { key: 'SHOP-9', fields: { status: { statusCategory: { key: 'indeterminate' } } } },
    ];
    const p = await provider({ linkTaggedScenarios: false });
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: {} as any });
    const res = await p.onRunFinished(summary([scenario()]), ctx);
    expect(calls.find((c) => c.path === 'search/jql')!.body.jql).toContain(
      'sdods-fingerprint:fp-cart',
    );
    expect(calls.filter((c) => c.path === 'issue')).toHaveLength(0);
    expect(calls.find((c) => c.path === 'issue/SHOP-9/comment')).toBeTruthy();
    expect(res.actions[0]).toMatchObject({ kind: 'issue-commented', target: 'SHOP-9' });
  });

  it('transitions an open issue when the scenario passes again', async () => {
    const p = await provider({ linkTaggedScenarios: false });
    const store = createMemoryStore();
    await store.save({
      projectSlug: 'shop',
      provider: 'jira',
      fingerprint: 'fp-cart',
      scenarioName: 'Add product',
      externalKey: 'SHOP-3',
      externalUrl: `${BASE}/browse/SHOP-3`,
      status: 'open',
      source: 'auto',
    });
    const ctx = createIntegrationContext({ store, env: {} as any });
    const res = await p.onRunFinished(
      summary([scenario({ status: 'passed', errorMessage: undefined })]),
      ctx,
    );
    expect(
      calls.find((c) => c.path === 'issue/SHOP-3/transitions' && c.method === 'POST')!.body,
    ).toEqual({ transition: { id: '31' } });
    expect(res.actions[0]).toMatchObject({
      kind: 'transition',
      target: 'SHOP-3',
      detail: '→ Done',
    });
    expect(await store.findOpen('shop', 'jira', 'fp-cart')).toBeUndefined();
  });

  it('syncs statuses in batches with key in (...)', async () => {
    jqlIssues = [{ key: 'SHOP-1', fields: { status: { statusCategory: { key: 'done' } } } }];
    const p = await provider();
    const refs = await p.syncStatuses([
      {
        id: 'a',
        projectSlug: 'shop',
        provider: 'jira',
        fingerprint: 'f',
        scenarioName: 's',
        externalKey: 'SHOP-1',
        externalUrl: '',
        status: 'open',
        source: 'auto',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    expect(calls[0]!.body.jql).toBe('key in (SHOP-1)');
    expect(refs[0]!.status).toBe('closed');
  });
});
