import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectConfigSchema, WorkspaceFileSchema } from '@sdods/contracts/schemas';
import type { SdodsDb } from '../src/create-db.js';
import { computeInsights } from '../src/insights.js';
import {
  countUsers,
  createApiToken,
  createSession,
  createUser,
  deleteAllUsers,
  deleteSession,
  deleteSessionsForUser,
  ensureRoles,
  getSession,
  getUserByUsername,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
} from '../src/repos/auth.js';
import {
  addWorkspaceMember,
  bootstrapOwner,
  effectiveRoleForWorkspace,
  listModules,
  listProcesses,
  listUserOrgs,
  listUserWorkspaces,
  listWorkspaces,
  syncHierarchy,
} from '../src/repos/hierarchy.js';
import { bumpLocatorStats, recomputeFlakyStats } from '../src/repos/improvement.js';
import {
  createAgentJob,
  listProposals,
  recordScheduleRun,
  updateAgentJob,
  upsertProposal,
  upsertSchedule,
  listSchedules,
  audit,
  listAudit,
  upsertIssueLink,
  findOpenIssueLink,
} from '../src/repos/platform.js';
import { ensureProject, getProjectBySlug, listProjects } from '../src/repos/projects.js';
import { upsertRun } from '../src/repos/runs.js';
import {
  leasePoolUser,
  poolStatus,
  releaseLease,
  releaseLeasesByHolder,
  upsertPoolUser,
  loadDatasetRows,
  upsertDataset,
} from '../src/repos/test-data.js';
import { newId } from '../src/ids.js';
import { enc, nowIso } from '../src/col.js';
import { testDb } from './helpers.js';

describe('repos', () => {
  let adb: SdodsDb;
  beforeAll(async () => {
    adb = await testDb();
  });
  afterAll(() => adb.close());

  it('users, sessions and free scoped api tokens', async () => {
    await ensureRoles(adb.db);
    const adminId = await createUser(adb.db, adb.driver, {
      username: 'admin',
      passwordHash: 'x',
      role: 'admin',
    });
    const editorId = await createUser(adb.db, adb.driver, {
      username: 'eve',
      passwordHash: 'y',
      role: 'editor',
    });
    expect((await getUserByUsername(adb.db, 'admin'))?.role).toBe('admin');

    const s = await createSession(adb.db, { userId: adminId, ttlMs: 60_000 });
    expect((await getSession(adb.db, s.token))?.userId).toBe(adminId);
    await deleteSession(adb.db, s.token);
    expect(await getSession(adb.db, s.token)).toBeNull();

    const tok = await createApiToken(adb.db, {
      userId: editorId,
      name: 'ci',
      scopes: ['runs:read', 'runs:ingest'],
      expiresInDays: 30,
      ownerRole: 'editor',
    });
    expect(tok.token.startsWith('amx_')).toBe(true);
    const resolved = await resolveApiToken(adb.db, tok.token);
    expect(resolved?.username).toBe('eve');
    expect(resolved?.scopes.sort()).toEqual(['runs:ingest', 'runs:read']);
    await expect(
      createApiToken(adb.db, {
        userId: editorId,
        name: 'bad',
        scopes: ['users:admin'],
        ownerRole: 'editor',
      }),
    ).rejects.toThrow(/exceed/);
    expect((await listApiTokens(adb.db, editorId))[0]?.prefix).toBe(tok.prefix);
    await revokeApiToken(adb.db, tok.id);
    expect(await resolveApiToken(adb.db, tok.token)).toBeNull();
    expect(await resolveApiToken(adb.db, 'nope')).toBeNull();
  });

  it('hierarchy sync, memberships, effective roles and owner bootstrap', async () => {
    const wf = WorkspaceFileSchema.parse({
      organization: { slug: 'acme', name: 'Acme' },
      workspaces: [
        { slug: 'default', name: 'Default' },
        { slug: 'qa', name: 'QA' },
      ],
      defaultWorkspace: 'default',
      defaults: { processes: [{ name: 'pr-check', trigger: 'pr', tags: '@smoke' }] },
    });
    const shop = ProjectConfigSchema.parse({
      slug: 'shop',
      name: 'Shop',
      layers: ['ui', 'api'],
      envs: { default: 'staging', available: ['staging'] },
      modules: [{ name: 'checkout', owner: 'team-a', routes: ['/checkout'] }],
      processes: [{ name: 'nightly', trigger: 'nightly', tags: '@regression' }],
    });
    const admin = ProjectConfigSchema.parse({
      slug: 'admin',
      name: 'Admin',
      workspace: 'qa',
      layers: ['ui'],
      envs: { default: 'local', available: ['local'] },
    });
    const res = await syncHierarchy(adb.db, adb.driver, {
      workspaceFile: wf,
      projects: [{ config: shop }, { config: admin }],
    });
    expect(Object.keys(res.workspaces).sort()).toEqual(['default', 'qa']);
    expect(res.modules).toBe(1);
    expect(res.processes).toBe(3); // 2 workspace-level + 1 project-level
    const projects = await listProjects(adb.db);
    expect(projects.find((p) => p.slug === 'shop')?.workspaceId).toBe(res.workspaces.default);
    expect(projects.find((p) => p.slug === 'admin')?.workspaceId).toBe(res.workspaces.qa);
    expect((await listModules(adb.db, res.projects.shop!))[0]?.name).toBe('checkout');
    expect((await listProcesses(adb.db, { projectId: res.projects.shop! }))[0]?.name).toBe(
      'nightly',
    );
    expect((await listProcesses(adb.db, { workspaceId: res.workspaces.qa! }))[0]?.name).toBe(
      'pr-check',
    );
    // re-sync is idempotent
    const again = await syncHierarchy(adb.db, adb.driver, {
      workspaceFile: wf,
      projects: [{ config: shop }],
    });
    expect(again.projects.shop).toBe(res.projects.shop);
    expect((await listWorkspaces(adb.db)).length).toBe(2);

    const eve = (await getUserByUsername(adb.db, 'eve'))!;
    const admin1 = (await getUserByUsername(adb.db, 'admin'))!;
    expect(await listUserWorkspaces(adb.db, eve.id, 'editor')).toEqual([]);
    await addWorkspaceMember(adb.db, res.workspaces.qa!, eve.id, 'editor');
    const ws = await listUserWorkspaces(adb.db, eve.id, 'editor');
    expect(ws.map((w) => [w.slug, w.role])).toEqual([['qa', 'editor']]);
    expect(
      await effectiveRoleForWorkspace(adb.db, eve.id, res.workspaces.default!, 'editor'),
    ).toBeNull();
    expect(await effectiveRoleForWorkspace(adb.db, eve.id, res.workspaces.default!, 'admin')).toBe(
      'admin',
    );
    const granted = await bootstrapOwner(adb.db, admin1.id);
    expect(granted).toEqual(['acme']);
    expect(await bootstrapOwner(adb.db, eve.id)).toEqual([]);
    expect((await listUserOrgs(adb.db, admin1.id))[0]?.role).toBe('owner');
    expect((await listUserWorkspaces(adb.db, admin1.id, 'editor')).map((w) => w.role)).toEqual([
      'admin',
      'admin',
    ]);
  });

  it('datasets and user pool leases', async () => {
    const projectId = (await getProjectBySlug(adb.db, 'shop'))!.id;
    await upsertDataset(adb.db, adb.driver, {
      projectId,
      name: 'products',
      kind: 'json',
      rows: [{ sku: 'A' }],
    });
    await upsertDataset(adb.db, adb.driver, {
      projectId,
      envKey: 'staging',
      name: 'products',
      kind: 'json',
      rows: [{ sku: 'S1' }, { sku: 'S2' }],
    });
    expect(await loadDatasetRows(adb.db, projectId, 'products', 'staging')).toEqual([
      { sku: 'S1' },
      { sku: 'S2' },
    ]);
    expect(await loadDatasetRows(adb.db, projectId, 'products', 'local')).toEqual([{ sku: 'A' }]);
    expect(await loadDatasetRows(adb.db, projectId, 'nope', 'local')).toBeNull();

    await upsertPoolUser(adb.db, adb.driver, {
      projectId,
      envName: 'staging',
      username: 'u1',
      role: 'standard',
    });
    await upsertPoolUser(adb.db, adb.driver, {
      projectId,
      envName: 'staging',
      username: 'u2',
      role: 'standard',
    });
    const l1 = await leasePoolUser(adb.db, {
      projectId,
      envName: 'staging',
      role: 'standard',
      holder: 'run1:0',
      ttlMs: 60_000,
    });
    const l2 = await leasePoolUser(adb.db, {
      projectId,
      envName: 'staging',
      role: 'standard',
      holder: 'run1:1',
      ttlMs: 60_000,
    });
    expect(l1?.username).not.toBe(l2?.username);
    expect(
      await leasePoolUser(adb.db, {
        projectId,
        envName: 'staging',
        role: 'standard',
        holder: 'run1:2',
        ttlMs: 60_000,
      }),
    ).toBeNull();
    // same holder gets the same user back
    expect(
      (
        await leasePoolUser(adb.db, {
          projectId,
          envName: 'staging',
          role: 'standard',
          holder: 'run1:0',
          ttlMs: 60_000,
        })
      )?.username,
    ).toBe(l1?.username);
    expect((await poolStatus(adb.db, projectId, 'staging')).filter((u) => u.leased)).toHaveLength(
      2,
    );
    await releaseLease(adb.db, l1!.leaseId);
    expect(await releaseLeasesByHolder(adb.db, 'run1:1')).toBe(1);
    expect((await poolStatus(adb.db, projectId, 'staging')).filter((u) => u.leased)).toHaveLength(
      0,
    );
  });

  it('platform rows: proposals, agent jobs, schedules, issue links, audit', async () => {
    const projectId = (await getProjectBySlug(adb.db, 'shop'))!.id;
    const pid = newId();
    await upsertProposal(adb.db, {
      id: pid,
      projectId,
      role: 'generator',
      manifest: { files: [] },
      summary: 'x',
    });
    expect((await listProposals(adb.db, { projectId }))[0]?.id).toBe(pid);
    const jobId = await createAgentJob(adb.db, { projectId, kind: 'generate', goal: 'login' });
    await updateAgentJob(adb.db, jobId, {
      status: 'awaiting_review',
      proposalId: pid,
      costUsd: 0.42,
      turns: 7,
    });
    const sid = await upsertSchedule(adb.db, adb.driver, {
      projectId,
      name: 'nightly',
      cronExpr: '0 2 * * *',
      runInput: { tags: '@regression' },
    });
    await recordScheduleRun(adb.db, { scheduleId: sid, status: 'fired' });
    expect((await listSchedules(adb.db, projectId))[0]?.cronExpr).toBe('0 2 * * *');
    await upsertIssueLink(adb.db, {
      projectId,
      provider: 'jira',
      fingerprint: 'fp1',
      externalKey: 'DEMO-9',
      status: 'open',
    });
    expect((await findOpenIssueLink(adb.db, projectId, 'jira', 'fp1'))?.externalKey).toBe('DEMO-9');
    await audit(adb.db, {
      action: 'run.start',
      actorType: 'cli',
      targetType: 'run',
      targetId: 'r',
    });
    expect((await listAudit(adb.db, { limit: 1 }))[0]?.action).toBe('run.start');
  });

  it('insights: flakiness, fragility, env stability and suite health (golden numbers)', async () => {
    const projectId = await ensureProject(adb.db, adb.driver, 'ins', 'Insights');
    const mk = async (
      runIdx: number,
      status: 'passed' | 'failed',
      flaky = false,
      error: string | null = null,
    ) => {
      const runId = `ins-run-${runIdx}`;
      await upsertRun(adb.db, adb.driver, {
        id: runId,
        projectId,
        envName: 'staging',
        status: 'passed',
        startedAt: new Date(Date.parse('2026-02-01T00:00:00Z') + runIdx * 3_600_000).toISOString(),
      });
      await adb.db
        .insertInto('scenarios')
        .values({
          id: newId(),
          run_id: runId,
          project_id: projectId,
          natural_key: `p:${runIdx}`,
          fingerprint: 'fp-a',
          source: 'gherkin',
          feature_uri: 'features/ui/a.feature',
          feature_name: 'A',
          scenario_name: 'A works',
          module: 'ui',
          examples_row: null,
          runner_project: 'ins--ui--chromium',
          layer: 'ui',
          browser: 'chromium',
          suite_tag: '@smoke',
          tags_json: enc.json(['@ui']),
          jira_keys_json: enc.json([]),
          status,
          attempts_count: flaky ? 2 : 1,
          flaky: enc.bool(adb.driver, flaky) as number,
          duration_ms: 1000 + runIdx * 100,
          error_message: error,
          error_stack: null,
          started_at: null,
          finished_at: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .execute();
    };
    // 10 runs: P P F P(flaky) P F P P P P  → flakyRetries=1, flips: P→F, F→P, P→F, F→P = 4 → (1+4)/10 = 0.5
    const seq: Array<['passed' | 'failed', boolean]> = [
      ['passed', false],
      ['passed', false],
      ['failed', false],
      ['passed', true],
      ['passed', false],
      ['failed', false],
      ['passed', false],
      ['passed', false],
      ['passed', false],
      ['passed', false],
    ];
    for (let i = 0; i < seq.length; i++)
      await mk(
        i,
        seq[i]![0],
        seq[i]![1],
        seq[i]![0] === 'failed' ? 'Error: net::ERR_CONNECTION_REFUSED' : null,
      );
    await bumpLocatorStats(adb.db, projectId, { selector: '#a', fails: 2, heals: 4, uses: 10 });
    await recomputeFlakyStats(adb.db, adb.driver, {
      projectId,
      fingerprint: 'fp-a',
      runnerProject: 'ins--ui--chromium',
    });
    const ins = await computeInsights(adb.db, { projectSlug: 'ins', window: 30 });
    expect(ins.runsConsidered).toBe(10);
    expect(ins.scenarios[0]).toMatchObject({
      fingerprint: 'fp-a',
      runs: 10,
      passed: 7,
      failed: 2,
      flaky: 1,
      flakinessScore: 0.5,
      quarantineCandidate: true,
    });
    expect(ins.locators[0]).toMatchObject({ selector: '#a', fragility: 0.4, hot: true });
    expect(ins.envs[0]).toMatchObject({
      env: 'staging',
      runs: 10,
      envAttributedFailures: 0,
      stability: 1,
    });
    expect(ins.passRate).toBe(0.8);
    // 0.5*0.8 + 0.2*(1-0.5) + 0.2*(1-0.4) + 0.1*1 = 0.4 + 0.1 + 0.12 + 0.1 = 0.72
    expect(ins.suiteHealth).toBe(0.72);
    expect(ins.suiteHealthTrend).toHaveLength(10);
  });
});

describe('users reset', () => {
  let adb: SdodsDb;
  beforeAll(async () => {
    adb = await testDb();
  });
  afterAll(() => adb.close());

  it('removes users and what hangs off them, and keeps the hierarchy', async () => {
    const res = await syncHierarchy(adb.db, adb.driver, {
      workspaceFile: WorkspaceFileSchema.parse({
        organization: { slug: 'acme', name: 'Acme' },
        workspaces: [{ slug: 'default', name: 'Default' }],
        defaultWorkspace: 'default',
      }),
      projects: [],
    });
    const adminId = await createUser(adb.db, adb.driver, {
      username: 'admin',
      passwordHash: 'x',
      role: 'admin',
    });
    const eveId = await createUser(adb.db, adb.driver, {
      username: 'eve',
      passwordHash: 'y',
      role: 'editor',
    });
    await bootstrapOwner(adb.db, adminId);
    await addWorkspaceMember(adb.db, res.workspaces.default!, eveId, 'editor');
    const adminSession = await createSession(adb.db, { userId: adminId, ttlMs: 60_000 });
    const eveSession = await createSession(adb.db, { userId: eveId, ttlMs: 60_000 });
    const tok = await createApiToken(adb.db, {
      userId: eveId,
      name: 'ci',
      scopes: ['runs:read'],
      ownerRole: 'editor',
    });

    // a password change signs only that user out
    await deleteSessionsForUser(adb.db, adminId);
    expect(await getSession(adb.db, adminSession.token)).toBeNull();
    expect((await getSession(adb.db, eveSession.token))?.userId).toBe(eveId);

    expect(await deleteAllUsers(adb.db)).toBe(2);
    expect(await countUsers(adb.db)).toBe(0);
    expect(await getSession(adb.db, eveSession.token)).toBeNull();
    expect(await resolveApiToken(adb.db, tok.token)).toBeNull();
    expect(await (adb.db as any).selectFrom('org_members').selectAll().execute()).toEqual([]);
    expect(await (adb.db as any).selectFrom('workspace_members').selectAll().execute()).toEqual([]);
    expect((await listWorkspaces(adb.db)).map((w) => w.slug)).toEqual(['default']);

    // the next admin takes over the organization left without an owner
    const nextId = await createUser(adb.db, adb.driver, {
      username: 'admin',
      passwordHash: 'z',
      role: 'admin',
    });
    expect(await bootstrapOwner(adb.db, nextId)).toEqual(['acme']);
  });
});
