import { http, HttpResponse, delay } from 'msw';
import * as d from './data';
import type { AgentJob, Schedule, StartRunInput } from '../api/types';

const state = {
  loggedIn: true,
  preferences: {} as Record<string, { key: string; value: unknown; updatedAt: string | null }>,
  runs: [...d.runs],
  schedules: [...d.schedules],
  tokens: [...d.tokens],
  users: [...d.users],
  proposals: [...d.proposals],
  jobs: [...d.agentJobs],
  workspaces: [...d.workspaces],
  featureContent: { ...d.featureContent },
  sessions: [
    {
      id: 'sess-current',
      ip: '127.0.0.1',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      createdAt: '2026-09-16T08:12:00Z',
      lastSeenAt: new Date().toISOString(),
      expiresAt: '2026-09-23T08:12:00Z',
    },
    {
      id: 'sess-laptop',
      ip: '10.0.0.24',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/130.0',
      createdAt: '2026-09-12T15:40:00Z',
      lastSeenAt: '2026-09-15T18:02:00Z',
      expiresAt: '2026-09-22T18:02:00Z',
    },
  ],
  wsMembers: {
    default: [
      { userId: 'u1', username: 'admin', role: 'admin' },
      { userId: 'u2', username: 'maria', role: 'editor' },
      { userId: 'u3', username: 'viewer', role: 'viewer' },
    ],
  } as Record<string, Array<{ userId: string; username: string; role: string }>>,
};

const json = (body: unknown, init?: ResponseInit) => HttpResponse.json(body as any, init);
const notFound = (what: string) =>
  json({ error: { code: 'NOT_FOUND', message: `${what} not found` } }, { status: 404 });

function sse(lines: Array<{ event: string; data: unknown }>, everyMs = 400) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let i = 0;
      for (const l of lines) {
        await new Promise((r) => setTimeout(r, everyMs));
        controller.enqueue(
          enc.encode(`id: ${++i}\nevent: ${l.event}\ndata: ${JSON.stringify(l.data)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}

export const handlers = [
  http.get('/api/health', () => json({ ok: true, driver: 'sqlite', version: '0.1.0-mock' })),
  http.get('/api/auth/me', () =>
    state.loggedIn
      ? json(d.me)
      : json({ error: { code: 'UNAUTHENTICATED', message: 'not signed in' } }, { status: 401 }),
  ),
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { username: string; password: string };
    if (body.password === 'wrong')
      return json(
        {
          error: {
            code: 'AUTH_FAILED',
            message: 'Invalid credentials',
            hint: 'Mock: any password except "wrong" works.',
          },
        },
        { status: 401 },
      );
    state.loggedIn = true;
    return json({ ok: true });
  }),
  http.post('/api/auth/logout', () => {
    state.loggedIn = false;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/auth/setup-status', () => json({ needsSetup: false })),
  http.post('/api/auth/setup', () => json({ ok: true })),

  // Mirrors packages/server/src/routes/me.ts.
  http.get('/api/me/preferences/:key', ({ params }) =>
    json(
      state.preferences[params.key as string] ?? { key: params.key, value: null, updatedAt: null },
    ),
  ),
  http.put('/api/me/preferences/:key', async ({ params, request }) => {
    const { value } = (await request.json()) as { value: unknown };
    const pref = { key: params.key as string, value, updatedAt: new Date().toISOString() };
    state.preferences[pref.key] = pref;
    return json(pref);
  }),
  http.patch('/api/me', async ({ request }) => {
    const b = (await request.json()) as { displayName?: string | null; email?: string | null };
    if (b.displayName !== undefined) d.me.user.displayName = b.displayName || undefined;
    if (b.email !== undefined) d.me.user.email = b.email || undefined;
    return json({ ...d.me.user });
  }),
  http.post('/api/me/password', async ({ request }) => {
    const b = (await request.json()) as { currentPassword: string };
    if (b.currentPassword === 'wrong')
      return json(
        { error: { code: 'INVALID_PASSWORD', message: 'The current password is not correct.' } },
        { status: 400 },
      );
    const others = state.sessions.length - 1;
    state.sessions = state.sessions.filter((x) => x.id === d.me.sessionId);
    return json({ ok: true, otherSessionsSignedOut: others });
  }),
  http.get('/api/me/sessions', () =>
    json(state.sessions.map((x) => ({ ...x, current: x.id === d.me.sessionId }))),
  ),
  http.delete('/api/me/sessions/:id', ({ params }) => {
    state.sessions = state.sessions.filter((x) => x.id !== params.id);
    return json({ ok: true });
  }),
  http.post('/api/me/sessions/revoke-others', () => {
    const revoked = state.sessions.length - 1;
    state.sessions = state.sessions.filter((x) => x.id === d.me.sessionId);
    return json({ ok: true, revoked });
  }),

  http.get('/api/orgs', () => json(d.orgs)),
  http.get('/api/orgs/:org/members', () =>
    json([
      { userId: 'u1', username: 'admin', role: 'owner' },
      { userId: 'u2', username: 'maria', role: 'member' },
    ]),
  ),
  http.get('/api/workspaces', () => json(state.workspaces)),
  http.post('/api/workspaces', async ({ request }) => {
    const b = (await request.json()) as { slug: string; name: string; description?: string };
    const ws = {
      id: `w${state.workspaces.length + 1}`,
      organizationId: 'o1',
      slug: b.slug,
      name: b.name,
      description: b.description,
      projectCount: 0,
      myRole: 'admin' as const,
    };
    state.workspaces.push(ws);
    return json(ws, { status: 201 });
  }),
  http.get('/api/workspaces/:ws/members', ({ params }) =>
    json(state.wsMembers[params.ws as string] ?? []),
  ),
  http.post('/api/workspaces/:ws/members', async ({ params, request }) => {
    const b = (await request.json()) as { username: string; role: string };
    const list = (state.wsMembers[params.ws as string] ??= []);
    const existing = list.find((m) => m.username === b.username);
    if (existing) existing.role = b.role;
    else list.push({ userId: `u-${b.username}`, username: b.username, role: b.role });
    return json(list);
  }),
  http.delete('/api/workspaces/:ws/members/:userId', ({ params }) => {
    state.wsMembers[params.ws as string] = (state.wsMembers[params.ws as string] ?? []).filter(
      (m) => m.userId !== params.userId,
    );
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/projects', ({ request }) => {
    const ws = new URL(request.url).searchParams.get('workspace');
    return json(ws ? d.projects.filter((p) => p.workspace === ws) : d.projects);
  }),
  http.get('/api/projects/:slug', ({ params }) =>
    json(d.projects.find((p) => p.slug === params.slug) ?? d.projects[0]),
  ),
  http.put('/api/projects/:slug', async ({ request }) => json(await request.json())),
  http.post('/api/projects', async ({ request }) => {
    const b = (await request.json()) as { slug: string };
    return json({ ...d.projects[1], ...b }, { status: 201 });
  }),
  http.get('/api/projects/:slug/envs', ({ params }) => json(d.envs[params.slug as string] ?? [])),
  // Mirrors the server upsert: flat EnvBody, creates or edits in place.
  http.put('/api/projects/:slug/envs/:name', async ({ params, request }) => {
    const b = (await request.json()) as {
      uiUrl: string;
      apiUrl: string;
      poolSize?: number;
      vars?: Record<string, string>;
    };
    const list = (d.envs[params.slug as string] ??= []);
    const name = params.name as string;
    const existing = list.find((e) => e.name === name);
    const next = {
      ...(existing ?? { name, secretNames: [], secretsPresent: {}, isDefault: false }),
      ui: { baseUrl: b.uiUrl },
      api: { ...(existing?.api ?? { auth: { type: 'none' } }), baseUrl: b.apiUrl },
      users: { poolSize: b.poolSize ?? existing?.users?.poolSize ?? 2 },
      vars: b.vars ?? existing?.vars ?? {},
    };
    if (existing) Object.assign(existing, next);
    else list.push(next);
    return json({ ok: true });
  }),
  http.get('/api/projects/:slug/datasets', () => json(d.datasets)),
  http.post('/api/projects/:slug/datasets', async () => {
    await delay(300);
    return json({ ...d.datasets[0], id: 'd-new', name: 'uploaded', rowCount: 12 }, { status: 201 });
  }),
  http.post('/api/projects/:slug/datasets/preview', async () =>
    json({
      columns: ['id', 'username', 'password', 'role'],
      rows: [
        { id: 1, username: 'standard_user', password: '***', role: 'standard' },
        { id: 2, username: 'problem_user', password: '***', role: 'problem' },
      ],
    }),
  ),
  http.get('/api/projects/:slug/datasets/:id/rows', () =>
    json({
      rows: [
        { id: 1, username: 'standard_user', password: '***', role: 'standard' },
        { id: 2, username: 'problem_user', password: '***', role: 'problem' },
        { id: 3, username: 'performance_glitch_user', password: '***', role: 'performance' },
      ],
      total: 3,
    }),
  ),
  http.get('/api/projects/:slug/users-pool', () => json(d.pool)),
  http.get('/api/projects/:slug/processes', () => json(d.processes)),
  http.post('/api/projects/:slug/processes/:name/run', ({ params }) => {
    const id = `run-${Date.now()}`;
    state.runs.unshift({
      ...d.runs[0]!,
      id,
      status: 'queued',
      process: params.name as string,
      startedAt: new Date().toISOString(),
      totals: undefined,
    });
    return json({ runId: id }, { status: 202 });
  }),

  http.get('/api/runs', ({ request }) => {
    const u = new URL(request.url);
    let items = state.runs;
    for (const k of ['project', 'env', 'status', 'process']) {
      const v = u.searchParams.get(k);
      if (v) items = items.filter((r: any) => (k === 'project' ? r.projectSlug : r[k]) === v);
    }
    return json({ items, total: items.length });
  }),
  http.post('/api/runs', async ({ request }) => {
    const b = (await request.json()) as StartRunInput;
    const id = `run-${Date.now()}`;
    state.runs.unshift({
      id,
      projectSlug: b.project,
      env: b.env,
      trigger: 'ui',
      status: 'running',
      tagsExpr: b.tags,
      process: b.process,
      layers: b.layers ?? ['ui'],
      browsers: b.browsers ?? ['chromium'],
      startedAt: new Date().toISOString(),
      startedBy: 'admin',
    });
    return json({ runId: id }, { status: 202 });
  }),
  http.get('/api/runs/:id', ({ params }) => {
    const r = state.runs.find((x) => x.id === params.id);
    if (!r) return notFound('run');
    return json({
      ...d.runDetail(r.id),
      ...r,
      scenarios: d.runDetail(r.id).scenarios,
      reportPaths: d.runDetail(r.id).reportPaths,
    });
  }),
  http.post('/api/runs/:id/cancel', ({ params }) => {
    const r = state.runs.find((x) => x.id === params.id);
    if (r) r.status = 'cancelled';
    return json({ ok: true });
  }),
  http.post('/api/runs/:id/rerun', async ({ params, request }) => {
    const from = state.runs.find((x) => x.id === params.id);
    if (!from) return notFound('run');
    const b = (await request.json().catch(() => ({}))) as { scope?: string };
    const id = `run-${Date.now()}`;
    state.runs.unshift({
      ...from,
      id,
      trigger: 'ui',
      status: 'running',
      totals: undefined,
      startedAt: new Date().toISOString(),
    });
    return json({ runId: id, rerunOf: from.id, scope: b.scope ?? 'all' }, { status: 202 });
  }),
  http.post('/api/runs/:id/baselines/accept', async ({ params, request }) => {
    const body = (await request.json()) as { names?: string[]; all?: boolean };
    const names = body.all ? ['demo-shop--ui--chromium/inventory'] : (body.names ?? []);
    return json({
      runId: params.id,
      project: 'demo-shop',
      accepted: names.map((n) => {
        const [runnerProject, name] = n.includes('/')
          ? (n.split('/') as [string, string])
          : ['demo-shop--ui--chromium', n];
        return {
          name,
          runnerProject,
          platform: 'linux',
          reason: 'changed',
          diffRatio: 0.034,
          created: false,
          baseline: `features/__screenshots__/${runnerProject}/linux/${name}.png`,
        };
      }),
    });
  }),
  http.get('/api/runs/:id/scenarios/:sid', ({ params }) =>
    json(d.scenarioDetail(params.id as string, params.sid as string)),
  ),
  http.get('/api/runs/:id/events', () =>
    sse([
      { event: 'status', data: { status: 'running' } },
      {
        event: 'log',
        data: { t: Date.now(), stream: 'out', line: 'Generating BDD tests (bddgen)…' },
      },
      {
        event: 'log',
        data: { t: Date.now(), stream: 'out', line: 'Running 10 tests using 2 workers' },
      },
      { event: 'progress', data: { done: 1, total: 10 } },
      {
        event: 'log',
        data: {
          t: Date.now(),
          stream: 'out',
          line: '  ✓ [demo-shop--ui--chromium] features/auth/login.feature:8 › Successful login (4.2s)',
        },
      },
      { event: 'progress', data: { done: 4, total: 10 } },
      {
        event: 'log',
        data: {
          t: Date.now(),
          stream: 'out',
          line: '  ✘ [demo-shop--ui--chromium] features/auth/login.feature:14 › Failed login – wrong password (6.1s)',
        },
      },
      {
        event: 'log',
        data: {
          t: Date.now(),
          stream: 'err',
          line: "expect(locator).toContainText: Expected 'Username and password do not match'",
        },
      },
      { event: 'progress', data: { done: 10, total: 10 } },
      { event: 'log', data: { t: Date.now(), stream: 'out', line: '9 passed, 1 failed (48.3s)' } },
      { event: 'ingested', data: { runId: 'run-3' } },
      { event: 'done', data: { status: 'failed', exitCode: 1 } },
    ]),
  ),
  http.get('/api/artifacts/compare', ({ request }) => {
    const u = new URL(request.url);
    const before = d.shot(u.searchParams.get('before') ?? 'a', 'before');
    const after = d.shot(u.searchParams.get('after') ?? 'b', 'after');
    return json({
      before,
      after,
      diff: d.shot('diff', 'diff'),
      mismatchRatio: 0.034,
      mismatchPixels: 31_334,
    });
  }),
  http.get(
    '/api/artifacts/:id',
    () =>
      new HttpResponse(new Uint8Array([0x50, 0x4b]), {
        headers: { 'content-type': 'application/zip' },
      }),
  ),

  http.get('/api/projects/:slug/features', () => json(d.features)),
  http.get('/api/projects/:slug/features/*', ({ params }) => {
    const path = (params['0'] as string) ?? '';
    const content =
      state.featureContent[path] ??
      `@ui @regression\nFeature: ${path}\n\n  Scenario: Example\n    Given I am on the login page\n`;
    return json({ path, content });
  }),
  http.put('/api/projects/:slug/features/*', async ({ params, request }) => {
    const path = (params['0'] as string) ?? '';
    const { content } = (await request.json()) as { content: string };
    const diags = lint(content);
    if (diags.some((x) => x.severity === 'error'))
      return json(
        { error: { code: 'LINT_FAILED', message: 'Feature has lint errors' }, diagnostics: diags },
        { status: 422 },
      );
    state.featureContent[path] = content;
    return json({ ok: true });
  }),
  http.post('/api/projects/:slug/features/validate', async ({ request }) => {
    const { content } = (await request.json()) as { content: string };
    return json({ diagnostics: lint(content) });
  }),
  http.get('/api/projects/:slug/steps', () => json(d.steps)),
  http.post('/api/projects/:slug/record', () => json({ jobId: 'rec-1' }, { status: 202 })),
  http.get('/api/projects/:slug/recorded/:file', ({ params }) =>
    json({
      path: `recorded/${params.file}`,
      content:
        "import { test, expect } from '@sdods/core/test';\n\n// @sdods-recording {\"project\":\"demo-shop\",\"env\":\"staging\",\"user\":\"standard\"}\ntest.describe('checkout', { tag: ['@recorded', '@ui', '@regression'] }, () => {\n  test('checkout', async ({ page }) => {\n    await page.goto('/');\n    await page.getByTestId('username').fill('standard_user');\n    await page.getByTestId('password').fill('secret_sauce');\n    await page.getByRole('button', { name: 'Login' }).click();\n    await expect(page).toHaveURL(/inventory/);\n  });\n});\n",
    }),
  ),

  http.get('/api/agents/jobs', () => json(state.jobs)),
  http.post('/api/agents/jobs', async ({ request }) => {
    const b = (await request.json()) as { project: string; kind: string; goal?: string };
    const job: AgentJob = {
      ...d.agentJobs[0]!,
      id: `job-${Date.now()}`,
      kind: b.kind as AgentJob['kind'],
      goal: b.goal,
      status: 'running',
      proposalId: undefined,
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
    };
    state.jobs.unshift(job);
    setTimeout(() => {
      job.status = 'awaiting_review';
      job.proposalId = 'prop-2';
      job.finishedAt = new Date().toISOString();
    }, 4000);
    return json(job, { status: 202 });
  }),
  http.get('/api/agents/jobs/:id', ({ params }) =>
    json(state.jobs.find((j) => j.id === params.id) ?? notFound('job')),
  ),
  // Mirrors the server: CLI output as `log` lines, then one `done` with the --json result.
  http.get('/api/agents/jobs/:id/events', ({ params }) =>
    params.id === 'rec-1'
      ? sse(
          [
            {
              event: 'log',
              data: { stream: 'out', line: 'Launching codegen at https://www.saucedemo.com …' },
            },
            {
              event: 'log',
              data: { stream: 'out', line: 'Recording… close the browser window to finish.' },
            },
            {
              event: 'done',
              data: {
                status: 'done',
                proposalId: null,
                result: { name: 'checkout', spec: 'projects/demo-shop/recorded/checkout.spec.ts' },
              },
            },
          ],
          700,
        )
      : sse(
          [
            {
              event: 'log',
              data: { stream: 'out', line: 'Reading project config and step catalog…' },
            },
            {
              event: 'log',
              data: {
                stream: 'out',
                line: JSON.stringify({
                  type: 'tool',
                  name: 'step_list',
                  input: { project: 'demo-shop' },
                }),
              },
            },
            {
              event: 'log',
              data: {
                stream: 'out',
                line: 'The #login-button locator is fragile (6 failures, 4 heals). Proposing a role locator.',
              },
            },
            {
              event: 'log',
              data: {
                stream: 'out',
                line: JSON.stringify({ type: 'diff', diffText: d.proposals[0]!.diffText }),
              },
            },
            {
              event: 'done',
              data: { status: 'awaiting_review', proposalId: 'prop-2', result: null },
            },
          ],
          600,
        ),
  ),

  http.get('/api/proposals', () => json(state.proposals)),
  http.get('/api/proposals/:id', ({ params }) =>
    json(state.proposals.find((p) => p.id === params.id) ?? notFound('proposal')),
  ),
  http.post('/api/proposals/:id/accept', ({ params }) => {
    const p = state.proposals.find((x) => x.id === params.id);
    if (p) p.status = 'accepted';
    return json({ ok: true, branch: `sdods/${params.id}` });
  }),
  http.post('/api/proposals/:id/reject', ({ params }) => {
    const p = state.proposals.find((x) => x.id === params.id);
    if (p) p.status = 'rejected';
    return json({ ok: true });
  }),

  http.get('/api/projects/:slug/integrations', ({ params }) =>
    json(d.integrations[params.slug as string] ?? []),
  ),
  http.put('/api/projects/:slug/integrations', () => json({ ok: true })),
  http.post('/api/projects/:slug/integrations/:provider/test', async ({ params }) => {
    await delay(500);
    const p = params.provider as string;
    return json(
      p.startsWith('mcp:')
        ? {
            ok: true,
            detail: 'connected',
            tools: ['browser_navigate', 'browser_snapshot', 'browser_click'],
          }
        : {
            ok: p === 'github',
            detail: p === 'github' ? 'authenticated as octocat' : 'JIRA_API_TOKEN missing',
          },
    );
  }),
  http.post('/api/projects/:slug/integrations/sync', async () => {
    await delay(400);
    return json({ synced: 2 });
  }),

  http.get('/api/schedules', ({ request }) => {
    const p = new URL(request.url).searchParams.get('project');
    return json(p ? state.schedules.filter((s) => s.projectSlug === p) : state.schedules);
  }),
  // Mirrors the server: upsert by project + name from the flat ScheduleBody.
  http.post('/api/schedules', async ({ request }) => {
    const b = (await request.json()) as Record<string, any>;
    const view: Partial<Schedule> = {
      ...b,
      projectSlug: b.project,
      overlap: b.overlap ?? 'skip',
      jitterSeconds: b.jitterSeconds ?? 0,
      catchUp: b.catchUp ?? false,
      enabled: b.enabled ?? true,
      notify: b.notify ?? [],
    };
    const i = state.schedules.findIndex((s) => s.projectSlug === b.project && s.name === b.name);
    if (i >= 0) {
      state.schedules[i] = { ...state.schedules[i]!, ...view };
      return json({ id: state.schedules[i]!.id }, { status: 201 });
    }
    const s = {
      ...d.schedules[1]!,
      ...view,
      id: `sch-${Date.now()}`,
      source: 'db',
      lastRunId: null,
      lastStatus: null,
    } as Schedule;
    state.schedules.push(s);
    return json({ id: s.id }, { status: 201 });
  }),
  http.post('/api/schedules/:id/:action', ({ params }) => {
    const i = state.schedules.findIndex((s) => s.id === params.id);
    if (i < 0) return notFound('schedule');
    if (params.action === 'run-now') return json({ runId: `run-${Date.now()}` }, { status: 202 });
    state.schedules[i] = { ...state.schedules[i]!, enabled: params.action === 'resume' };
    return json({ ok: true, enabled: state.schedules[i]!.enabled });
  }),
  http.delete('/api/schedules/:id', ({ params }) => {
    state.schedules = state.schedules.filter((s) => s.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/schedules/:id', ({ params }) => {
    const sch = state.schedules.find((s) => s.id === params.id);
    if (!sch) return notFound('schedule');
    return json({
      ...sch,
      history: [
        {
          id: 'sr1',
          run_id: 'run-2',
          fired_at: '2026-09-03T06:00:00Z',
          status: 'failed',
          note: null,
        },
        {
          id: 'sr2',
          run_id: 'run-x',
          fired_at: '2026-09-02T06:00:00Z',
          status: 'passed',
          note: null,
        },
      ],
    });
  }),

  http.get('/api/users', () => json(state.users)),
  http.post('/api/users', async ({ request }) => {
    const b = (await request.json()) as { username: string; role: any };
    const u = {
      id: `u${Date.now()}`,
      username: b.username,
      role: b.role,
      active: true,
      createdAt: new Date().toISOString(),
    };
    state.users.push(u);
    return json(u, { status: 201 });
  }),
  http.patch('/api/users/:id', async ({ params, request }) => {
    const b = (await request.json()) as Partial<{ role: any; active: boolean }>;
    const u = state.users.find((x) => x.id === params.id);
    if (u) Object.assign(u, b);
    return json(u);
  }),
  http.get('/api/tokens', () => json(state.tokens)),
  http.post('/api/tokens', async ({ request }) => {
    const b = (await request.json()) as { name: string; scopes: string[]; expiresInDays?: number };
    const t = {
      id: `t${Date.now()}`,
      name: b.name,
      prefix: 'amx_mock00000000',
      scopes: b.scopes as any,
      expiresAt: b.expiresInDays
        ? new Date(Date.now() + b.expiresInDays * 86_400_000).toISOString()
        : null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      owner: 'admin',
    };
    state.tokens.unshift(t);
    return json({ ...t, token: 'amx_mock00000000abcdefghijklmnopqrstuvwxyz0123' }, { status: 201 });
  }),
  http.delete('/api/tokens/:id', ({ params }) => {
    const t = state.tokens.find((x) => x.id === params.id);
    if (t) t.revokedAt = new Date().toISOString();
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/mcp/info', () =>
    json({
      url: `${location.origin}/mcp`,
      transport: 'streamable-http',
      version: '0.1.0',
      tools: [
        { name: 'project_list', scope: 'projects:read', description: 'List projects' },
        { name: 'run_tests', scope: 'runs:write', description: 'Run tests' },
        {
          name: 'run_get_scenario',
          scope: 'runs:read',
          description: 'Scenario detail with screenshots',
        },
        { name: 'feature_write', scope: 'features:write', description: 'Propose a feature file' },
        {
          name: 'analyze_project',
          scope: 'projects:read',
          description: 'Analyze an application repo',
        },
      ],
    }),
  ),
  http.post('/mcp', () =>
    json({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [{ name: 'project_list' }, { name: 'run_tests' }, { name: 'run_get_scenario' }],
      },
    }),
  ),
  http.get('/api/stats/trends', () => json(d.trends)),
  http.get('/api/audit', () => json([])),
];

function lint(content: string) {
  const diags: Array<{
    severity: 'error' | 'warning';
    rule: string;
    message: string;
    line?: number;
    fix?: { description: string; insertTag?: string };
  }> = [];
  const tags = content.match(/@[\w:-]+/g) ?? [];
  if (!tags.some((t) => ['@ui', '@api', '@hybrid'].includes(t)))
    diags.push({
      severity: 'error',
      rule: 'tags/layer',
      message: 'Exactly one layer tag (@ui, @api, @hybrid) is required.',
      line: 1,
      fix: { description: 'Add @ui', insertTag: '@ui' },
    });
  if (!tags.some((t) => ['@smoke', '@regression', '@sanity'].includes(t)))
    diags.push({
      severity: 'error',
      rule: 'tags/suite',
      message: 'Exactly one suite tag (@smoke, @regression, @sanity) is required.',
      line: 1,
      fix: { description: 'Add @regression', insertTag: '@regression' },
    });
  if (!/^\s*Feature:/m.test(content))
    diags.push({
      severity: 'error',
      rule: 'gherkin/syntax',
      message: 'Missing "Feature:" keyword.',
      line: 1,
    });
  if (/Scenario Outline:/.test(content) && !/# title-format:/.test(content))
    diags.push({
      severity: 'warning',
      rule: 'outline/title',
      message:
        'Scenario Outline has no "# title-format:" comment; examples will be titled "Example #n".',
      line: content.split('\n').findIndex((l) => l.includes('Scenario Outline:')) + 1,
    });
  return diags;
}
