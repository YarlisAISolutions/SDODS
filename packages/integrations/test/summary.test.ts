import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fingerprint } from '@automax/contracts';
import { buildRunSummaryFromFiles } from '../src/summary.js';
import { selectIssueScreenshots } from '../src/context.js';
import { IssueDedupe } from '../src/dedupe.js';
import { FileIssueLinkStore } from '../src/store.js';
import { detectCi } from '../src/secrets.js';

const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6 });

/** Cucumber messages the way playwright-bdd's message reporter emits them (prefixed uri, attempt ids). */
function ndjson(): string {
  const uri = '[shop--ui--chromium]:features/ui/login.feature';
  const env = [
    { meta: { protocolVersion: '24.0.0' } },
    {
      gherkinDocument: {
        uri,
        feature: {
          name: 'Login',
          children: [
            { scenario: { id: 'sc-1', location: { line: 5 }, name: 'Successful login' } },
            {
              scenario: {
                id: 'sc-2',
                location: { line: 12 },
                name: 'Failed login',
                examples: [{ tableBody: [{ id: 'row-1' }, { id: 'row-2' }] }],
              },
            },
          ],
        },
      },
    },
    {
      pickle: {
        id: 'p1',
        uri,
        name: 'Successful login',
        tags: [{ name: '@ui' }, { name: '@smoke' }],
        astNodeIds: ['sc-1'],
        steps: [
          { id: 'ps1', text: 'I am on the login page', type: 'Context' },
          { id: 'ps2', text: 'I login', type: 'Action' },
        ],
      },
    },
    {
      pickle: {
        id: 'p2',
        uri,
        name: 'Failed login',
        tags: [{ name: '@ui' }, { name: '@regression' }, { name: '@jira:SHOP-7' }],
        astNodeIds: ['sc-2', 'row-2'],
        steps: [{ id: 'ps3', text: 'I login badly', type: 'Action' }],
      },
    },
    {
      testCase: {
        id: 'tc1',
        pickleId: 'p1',
        testSteps: [
          { id: 'h1', hookId: 'hook-1' },
          { id: 'ts1', pickleStepId: 'ps1' },
          { id: 'ts2', pickleStepId: 'ps2' },
        ],
      },
    },
    { testCase: { id: 'tc2', pickleId: 'p2', testSteps: [{ id: 'ts3', pickleStepId: 'ps3' }] } },
    { testRunStarted: { timestamp: ts(1000) } },
    // scenario 1: fails on attempt 0, passes on attempt 1 → flaky
    {
      testCaseStarted: { id: 'tc1-attempt-0', testCaseId: 'tc1', attempt: 0, timestamp: ts(1000) },
    },
    {
      testStepFinished: {
        testCaseStartedId: 'tc1-attempt-0',
        testStepId: 'h1',
        testStepResult: { status: 'PASSED', duration: ts(10) },
      },
    },
    {
      testStepFinished: {
        testCaseStartedId: 'tc1-attempt-0',
        testStepId: 'ts1',
        testStepResult: { status: 'PASSED', duration: ts(100) },
      },
    },
    {
      attachment: {
        testCaseStartedId: 'tc1-attempt-0',
        testStepId: 'ts2',
        fileName: 'automax/shot/step/01/before',
        mediaType: 'image/png',
        body: 'AA==',
        contentEncoding: 'BASE64',
      },
    },
    {
      testStepFinished: {
        testCaseStartedId: 'tc1-attempt-0',
        testStepId: 'ts2',
        testStepResult: {
          status: 'FAILED',
          duration: ts(300),
          message: 'boom',
          exception: { message: 'locator.click: Timeout', stackTrace: 'at x' },
        },
      },
    },
    {
      attachment: {
        testCaseStartedId: 'tc1-attempt-0',
        fileName: 'automax/shot/scenario/failure',
        mediaType: 'image/png',
        body: 'AA==',
        contentEncoding: 'BASE64',
      },
    },
    {
      testCaseFinished: {
        testCaseStartedId: 'tc1-attempt-0',
        willBeRetried: true,
        timestamp: ts(1500),
      },
    },
    {
      testCaseStarted: { id: 'tc1-attempt-1', testCaseId: 'tc1', attempt: 1, timestamp: ts(2000) },
    },
    {
      testStepFinished: {
        testCaseStartedId: 'tc1-attempt-1',
        testStepId: 'ts1',
        testStepResult: { status: 'PASSED', duration: ts(90) },
      },
    },
    {
      testStepFinished: {
        testCaseStartedId: 'tc1-attempt-1',
        testStepId: 'ts2',
        testStepResult: { status: 'PASSED', duration: ts(120) },
      },
    },
    {
      attachment: {
        testCaseStartedId: 'tc1-attempt-1',
        fileName: 'automax/shot/scenario/end',
        mediaType: 'image/png',
        body: 'AA==',
        contentEncoding: 'BASE64',
      },
    },
    {
      testCaseFinished: {
        testCaseStartedId: 'tc1-attempt-1',
        willBeRetried: false,
        timestamp: ts(2400),
      },
    },
    // scenario 2 (example row 2): fails
    {
      testCaseStarted: { id: 'tc2-attempt-0', testCaseId: 'tc2', attempt: 0, timestamp: ts(3000) },
    },
    {
      testStepFinished: {
        testCaseStartedId: 'tc2-attempt-0',
        testStepId: 'ts3',
        testStepResult: {
          status: 'FAILED',
          duration: ts(50),
          exception: { message: 'expected 1 to be 2' },
        },
      },
    },
    {
      attachment: {
        testCaseStartedId: 'tc2-attempt-0',
        fileName: 'trace',
        mediaType: 'application/zip',
        url: 'pw-output/tc2/trace.zip',
      },
    },
    {
      testCaseFinished: {
        testCaseStartedId: 'tc2-attempt-0',
        willBeRetried: false,
        timestamp: ts(3200),
      },
    },
    { testRunFinished: { success: false, timestamp: ts(3300) } },
  ];
  return env.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'automax-sum-'));
  const runDir = join(dir, 'run-abc');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({
      runId: 'run-abc',
      projectSlug: 'shop',
      env: 'staging',
      layers: ['ui'],
      browsers: ['chromium'],
      trigger: 'cli',
      startedAt: '2026-09-03T10:00:00.000Z',
      finishedAt: '2026-09-03T10:00:05.000Z',
      command: 'automax run',
      automaxVersion: '0.1.0',
      git: { sha: 'abc123', branch: 'main' },
      exitCode: 1,
    }),
  );
  writeFileSync(join(runDir, 'messages.ndjson'), ndjson());
  return runDir;
}

describe('buildRunSummaryFromFiles', () => {
  it('reconstructs scenarios, attempts, flaky flags, tags, screenshots and totals from a run dir', () => {
    const s = buildRunSummaryFromFiles(makeRunDir(), { reportUrl: 'https://r.test/run-abc' });
    expect(s.run).toMatchObject({
      id: 'run-abc',
      projectSlug: 'shop',
      env: 'staging',
      status: 'failed',
      gitSha: 'abc123',
    });
    expect(s.totals).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      timedOut: 0,
      flaky: 1,
      healed: 0,
      durationMs: 5000,
    });
    expect(s.scenarios).toHaveLength(2);

    const login = s.scenarios.find((x) => x.scenarioName === 'Successful login')!;
    expect(login).toMatchObject({
      status: 'passed',
      flaky: true,
      attemptsCount: 2,
      browser: 'chromium',
      layer: 'ui',
      suiteTag: '@smoke',
      line: 5,
      pwProject: 'shop--ui--chromium',
      featureUri: 'features/ui/login.feature',
      featureName: 'Login',
    });
    expect(login.steps.map((st) => [st.keyword, st.text, st.status])).toEqual([
      ['Given', 'I am on the login page', 'passed'],
      ['When', 'I login', 'passed'],
    ]);
    expect(login.screenshots.map((x) => x.phase)).toEqual(['scenario-end']);
    expect(login.fingerprint).toBe(
      fingerprint({
        project: 'shop',
        featureUri: 'features/ui/login.feature',
        scenarioName: 'Successful login',
        exampleIndex: null,
        layer: 'ui',
      }),
    );

    const failed = s.failed[0]!;
    expect(failed).toMatchObject({
      scenarioName: 'Failed login',
      exampleIndex: 1,
      line: 12,
      errorMessage: 'expected 1 to be 2',
      jiraKeys: ['SHOP-7'],
      tracePath: 'pw-output/tc2/trace.zip',
    });
    expect(s.flaky.map((x) => x.scenarioName)).toEqual(['Successful login']);
    expect(s.passed.map((x) => x.scenarioName)).toEqual(['Successful login']);
    expect(s.reportUrl).toBe('https://r.test/run-abc');
  });

  it('selects issue screenshots by relevance', () => {
    const picked = selectIssueScreenshots({
      screenshots: [
        { relPath: 'a/scenario-start.png', phase: 'scenario-start' },
        { relPath: 'a/00-before.png', phase: 'before', stepIndex: 0 },
        { relPath: 'a/01-before.png', phase: 'before', stepIndex: 1 },
        { relPath: 'a/01-after.png', phase: 'after', stepIndex: 1 },
        { relPath: 'a/scenario-failure.png', phase: 'failure' },
      ],
    } as any);
    expect(picked.map((p) => p.relPath)).toEqual([
      'a/scenario-failure.png',
      'a/01-before.png',
      'a/01-after.png',
      'a/scenario-start.png',
    ]);
  });
});

describe('FileIssueLinkStore + IssueDedupe', () => {
  it('persists links to disk and decides create/comment/skip', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'automax-links-')), 'links.json');
    const store = new FileIssueLinkStore(file);
    const dedupe = new IssueDedupe(store, { reopenAfterDays: 7 });
    expect((await dedupe.decide('shop', 'github', 'fp')).action).toBe('create');
    await store.save({
      projectSlug: 'shop',
      provider: 'github',
      fingerprint: 'fp',
      scenarioName: 'x',
      externalKey: 'acme/shop#1',
      externalUrl: 'u',
      status: 'open',
      source: 'auto',
    });
    const again = new FileIssueLinkStore(file);
    expect(await new IssueDedupe(again).decide('shop', 'github', 'fp')).toMatchObject({
      action: 'comment',
      link: { externalKey: 'acme/shop#1' },
    });
    const link = (await again.findOpen('shop', 'github', 'fp'))!;
    await again.save({ ...link, status: 'closed', closedAt: new Date().toISOString() });
    expect(
      (await new IssueDedupe(again, { reopenAfterDays: 7 }).decide('shop', 'github', 'fp')).action,
    ).toBe('skip');
    expect(
      (await new IssueDedupe(again, { reopenAfterDays: 0 }).decide('shop', 'github', 'fp')).action,
    ).toBe('create');
  });
});

describe('detectCi', () => {
  it('reads GitHub Actions context', () => {
    const ci = detectCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: 'refs/pull/12/merge',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_RUN_ID: '9',
      GITHUB_SHA: 'sha',
      GITHUB_HEAD_REF: 'feat',
    } as any);
    expect(ci).toMatchObject({
      provider: 'github',
      isPullRequest: true,
      prNumber: 12,
      sha: 'sha',
      branch: 'feat',
      runUrl: 'https://github.com/acme/shop/actions/runs/9',
      repository: 'acme/shop',
    });
    expect(detectCi({} as any)).toEqual({ provider: undefined, isPullRequest: false });
  });
});
