import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachmentNames } from '@sdods/contracts/names';
import type { SdodsDb } from '../src/create-db.js';
import { ingestRun, moduleFromUri, selectorFromError, splitUri } from '../src/ingest/index.js';
import { getRun, getRunScenarios, getScenarioDetail } from '../src/repos/runs.js';
import { listFlakyStats, listHealEvents, listLocatorStats } from '../src/repos/improvement.js';
import { ensureProject } from '../src/repos/projects.js';
import {
  buildMessages,
  buildPwJson,
  TINY_PNG_BASE64,
  testDb,
  writeRun,
  type StepSpec,
} from './helpers.js';

const PW = 'demo-shop--ui--chromium';

describe('ingest helpers', () => {
  it('parses uri prefix, module and locator selectors', () => {
    expect(splitUri('[demo-shop--ui--chromium]:features/ui/login.feature')).toEqual({
      runnerProject: 'demo-shop--ui--chromium',
      uri: 'features/ui/login.feature',
    });
    expect(moduleFromUri('features/ui/login.feature')).toBe('ui');
    expect(moduleFromUri('features/login.feature')).toBeNull();
    expect(moduleFromUri('projects/x/features/checkout/pay.feature')).toBe('checkout');
    expect(
      selectorFromError(
        "locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for locator('#login-button')\n",
      ),
    ).toBe("locator('#login-button')");
    expect(
      selectorFromError("Error: strict mode violation: getByRole('button') resolved to 2 elements"),
    ).toBe("getByRole('button')");
    expect(selectorFromError('boom')).toBeNull();
  });
});

describe('cucumber NDJSON ingest', () => {
  let adb: SdodsDb;
  beforeAll(async () => {
    adb = await testDb();
    await ensureProject(adb.db, adb.driver, 'demo-shop', 'Demo Shop');
  });
  afterAll(() => adb.close());

  it('simple-pass: scenarios, steps, hooks, module, totals', async () => {
    const ndjson = buildMessages(
      [
        {
          uri: 'features/ui/login.feature',
          name: 'Login',
          tags: ['@ui'],
          scenarios: [
            {
              name: 'Successful login',
              tags: ['@smoke', '@jira:DEMO-1'],
              steps: [
                { keyword: 'Given', text: 'I am on the login page' },
                { keyword: 'When', text: 'I login with "a" and "b"' },
                { keyword: 'Then', text: 'I should see the inventory' },
              ],
            },
            {
              name: 'Failed login',
              tags: ['@regression'],
              exampleRows: 2,
              steps: [
                { keyword: 'Given', text: 'I am on the login page' },
                { keyword: 'Then', text: 'I should see the login error "<x>"' },
              ],
            },
          ],
        },
      ],
      { runnerProject: PW },
    );
    const { root } = writeRun('run-simple', { 'messages.ndjson': ndjson });
    const res = await ingestRun(adb, { runId: 'run-simple', artifactsRoot: root });
    expect(res.projectSlug).toBe('demo-shop');
    expect(res.scenarios).toBe(3); // 1 + 2 example rows
    expect(res.attempts).toBe(3);
    expect(res.totals).toMatchObject({ total: 3, passed: 3, failed: 0, flaky: 0 });
    expect(res.status).toBe('passed');

    const run = await getRun(adb.db, 'run-simple');
    expect(run?.env).toBe('staging');
    expect(run?.status).toBe('passed');
    expect(run?.totals?.total).toBe(3);

    const scenarios = await getRunScenarios(adb.db, 'run-simple');
    const login = scenarios.find((s) => s.scenarioName === 'Successful login')!;
    expect(login.layer).toBe('ui');
    expect(login.browser).toBe('chromium');
    expect(login.module).toBe('ui');
    expect(login.suiteTag).toBe('@smoke');
    expect(login.jiraKeys).toEqual(['DEMO-1']);
    expect(login.tags).toContain('@ui');
    expect(login.featureUri).toBe('features/ui/login.feature');
    const detail = await getScenarioDetail(adb.db, login.id);
    expect(detail?.attempts).toHaveLength(1);
    const steps = detail!.attempts[0]!.steps;
    expect(steps.map((s) => s.kind)).toEqual(['hook', 'step', 'step', 'step']);
    expect(steps.filter((s) => s.kind === 'step').map((s) => s.stepIndex)).toEqual([0, 1, 2]);
    expect(steps[1]!.keyword).toBe('Given');
    expect(steps.every((s) => s.status === 'passed')).toBe(true);
    const outlineRows = scenarios.filter((s) => s.scenarioName.startsWith('Failed login'));
    expect(outlineRows.map((s) => s.exampleIndex).sort()).toEqual([1, 2]);
    expect(new Set(outlineRows.map((s) => s.fingerprint)).size).toBe(2);
  });

  it('a passing hook does not turn skipped steps into a pass; a failing hook fails', async () => {
    const steps: StepSpec[] = [
      { keyword: 'Given', text: 'I am on the login page' },
      { keyword: 'Then', text: 'I should see the inventory' },
    ];
    const ndjson = buildMessages(
      [
        {
          uri: 'features/ui/hooks.feature',
          name: 'Hooks',
          tags: ['@ui'],
          scenarios: [
            // @skip:<browser>: every Gherkin step skipped, the before and after hooks still pass.
            {
              name: 'Skipped with hooks',
              tags: ['@smoke'],
              steps,
              attempts: [['SKIPPED', 'SKIPPED']],
              afterHook: 'PASSED',
            },
            {
              name: 'Passed then after-hook failed',
              tags: ['@smoke'],
              steps,
              afterHook: 'FAILED',
            },
            { name: 'Passed with hooks', tags: ['@smoke'], steps, afterHook: 'PASSED' },
          ],
        },
      ],
      { runnerProject: PW },
    );
    const { root } = writeRun('run-hooks', { 'messages.ndjson': ndjson });
    const res = await ingestRun(adb, { runId: 'run-hooks', artifactsRoot: root });
    const scenarios = await getRunScenarios(adb.db, 'run-hooks');
    const status = Object.fromEntries(scenarios.map((s) => [s.scenarioName, s.status]));
    expect(status).toEqual({
      'Skipped with hooks': 'skipped',
      'Passed then after-hook failed': 'failed',
      'Passed with hooks': 'passed',
    });
    expect(res.totals).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
  });

  it('a scenario skipped part-way (test.skip() in a step) is skipped, not passed', async () => {
    const ndjson = buildMessages(
      [
        {
          uri: 'features/ui/skip-midway.feature',
          name: 'Skip midway',
          tags: ['@ui'],
          scenarios: [
            // playwright-bdd: earlier steps PASSED, the step that called test.skip() and the rest SKIPPED
            {
              name: 'Skipped part-way',
              tags: ['@smoke'],
              steps: [
                { keyword: 'Given', text: 'I am on the login page' },
                { keyword: 'When', text: 'the feature flag is off' },
                { keyword: 'Then', text: 'I should see the inventory' },
              ],
              attempts: [['PASSED', 'SKIPPED', 'SKIPPED']],
              afterHook: 'PASSED',
            },
          ],
        },
      ],
      { runnerProject: PW },
    );
    const { root } = writeRun('run-skip-midway', { 'messages.ndjson': ndjson });
    const res = await ingestRun(adb, { runId: 'run-skip-midway', artifactsRoot: root });
    const [sc] = await getRunScenarios(adb.db, 'run-skip-midway');
    expect(sc!.status).toBe('skipped');
    expect(res.totals).toMatchObject({ total: 1, passed: 0, skipped: 1 });
  });

  it('retry-flaky: attempt history, flaky flag, locator stats, idempotent re-ingest', async () => {
    const ndjson = buildMessages(
      [
        {
          uri: 'features/ui/cart.feature',
          name: 'Cart',
          tags: ['@ui'],
          scenarios: [
            {
              name: 'Add to cart',
              tags: ['@regression'],
              steps: [
                { keyword: 'Given', text: 'I am on the inventory page' },
                { keyword: 'When', text: 'I add the first product' },
                { keyword: 'Then', text: 'the cart badge shows 1' },
              ],
              attempts: [
                ['PASSED', 'FAILED', 'PASSED'],
                ['PASSED', 'PASSED', 'PASSED'],
              ],
            },
          ],
        },
      ],
      { runnerProject: PW },
    );
    const { root } = writeRun('run-flaky', { 'messages.ndjson': ndjson });
    const first = await ingestRun(adb, { runId: 'run-flaky', artifactsRoot: root });
    expect(first.attempts).toBe(2);
    expect(first.totals).toMatchObject({ total: 1, passed: 0, failed: 0, flaky: 1 });
    expect(first.status).toBe('passed');
    const scenarios = await getRunScenarios(adb.db, 'run-flaky');
    expect(scenarios[0]!.flaky).toBe(true);
    expect(scenarios[0]!.attemptsCount).toBe(2);
    expect(scenarios[0]!.status).toBe('passed');
    expect(scenarios[0]!.attempts.map((a) => a.status)).toEqual(['failed', 'passed']);
    expect(scenarios[0]!.attempts[0]!.willBeRetried).toBe(true);
    expect(scenarios[0]!.attempts[0]!.errorMessage).toMatch(/Timeout/);

    const project = await adb.db
      .selectFrom('projects')
      .select(['id'])
      .where('slug', '=', 'demo-shop')
      .executeTakeFirstOrThrow();
    const locators = await listLocatorStats(adb.db, project.id);
    const l = locators.find((x) => x.selector === "locator('#login-button')");
    expect(l?.failCount).toBe(1);

    // second ingest of the same file is skipped (sha tracked) and counts do not change
    const again = await ingestRun(adb, { runId: 'run-flaky', artifactsRoot: root });
    expect(again.filesSkipped.length).toBe(1);
    const count = await sql<{
      n: number;
    }>`select count(*) as n from scenario_attempts where run_id = 'run-flaky'`.execute(adb.db);
    expect(Number(count.rows[0]!.n)).toBe(2);
    expect(
      (await listLocatorStats(adb.db, project.id)).find(
        (x) => x.selector === "locator('#login-button')",
      )?.failCount,
    ).toBe(1);

    // --replace re-reads the file and still converges
    const replaced = await ingestRun(adb, {
      runId: 'run-flaky',
      artifactsRoot: root,
      replace: true,
    });
    expect(replaced.attempts).toBe(2);
    const count2 = await sql<{
      n: number;
    }>`select count(*) as n from scenario_attempts where run_id = 'run-flaky'`.execute(adb.db);
    expect(Number(count2.rows[0]!.n)).toBe(2);

    const flaky = await listFlakyStats(adb.db, project.id);
    const stat = flaky.find((f) => f.scenarioName === 'Add to cart');
    expect(stat?.flakyCount).toBe(1);
    expect(stat?.flakyRate).toBeGreaterThan(0);
  });

  it('two-shards: totals merge across files', async () => {
    const a = buildMessages(
      [
        {
          uri: 'features/api/posts.feature',
          name: 'Posts',
          tags: ['@api'],
          scenarios: [
            {
              name: 'List posts',
              tags: ['@smoke'],
              steps: [
                { keyword: 'When', text: 'I send a GET request to "/posts"' },
                { keyword: 'Then', text: 'the response status should be 200' },
              ],
            },
          ],
        },
      ],
      { runnerProject: 'demo-shop--api' },
    );
    const b = buildMessages(
      [
        {
          uri: 'features/api/posts.feature',
          name: 'Posts',
          tags: ['@api'],
          scenarios: [
            {
              name: 'Create post',
              tags: ['@regression'],
              steps: [
                {
                  keyword: 'When',
                  text: 'I send a POST request to "/posts"',
                  status: 'FAILED',
                  error: 'expect(received).toBe(expected)\n\nExpected: 201\nReceived: 500',
                },
              ],
            },
          ],
        },
      ],
      { runnerProject: 'demo-shop--api', startMs: Date.parse('2026-09-03T10:05:00.000Z') },
    );
    const { root } = writeRun(
      'run-shards',
      { 'messages.shard-1.ndjson': a, 'messages.shard-2.ndjson': b },
      { layers: ['api'], browsers: [], shardTotal: 2 },
    );
    const res = await ingestRun(adb, { runId: 'run-shards', artifactsRoot: root });
    expect(res.filesIngested).toHaveLength(2);
    expect(res.totals).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(res.status).toBe('failed');
    const run = await getRun(adb.db, 'run-shards');
    expect(run?.totalsRaw.ingested_files).toHaveLength(2);
    const scenarios = await getRunScenarios(adb.db, 'run-shards');
    expect(scenarios.every((s) => s.layer === 'api' && s.browser === null)).toBe(true);
    expect(scenarios.find((s) => s.scenarioName === 'Create post')?.errorMessage).toMatch(
      /Expected: 201/,
    );
  });

  it('with-attachments: screenshots to disk, api snapshots, heal events, meta', async () => {
    const meta = { fingerprint: 'x', testId: 't1', tags: ['@ui'] };
    const ndjson = buildMessages(
      [
        {
          uri: 'features/ui/login.feature',
          name: 'Login',
          tags: ['@ui'],
          scenarios: [
            {
              name: 'Login with heal',
              tags: ['@regression'],
              steps: [
                {
                  keyword: 'Given',
                  text: 'I am on the login page',
                  attachments: [
                    {
                      name: attachmentNames.shotStep(0, 'before'),
                      mediaType: 'image/png',
                      body: TINY_PNG_BASE64,
                      encoding: 'BASE64',
                    },
                    {
                      name: attachmentNames.shotStep(0, 'after'),
                      mediaType: 'image/png',
                      body: TINY_PNG_BASE64,
                      encoding: 'BASE64',
                    },
                    {
                      name: attachmentNames.meta,
                      mediaType: 'application/json',
                      body: JSON.stringify(meta),
                    },
                  ],
                },
                {
                  keyword: 'When',
                  text: 'I send a GET request to "/users/1"',
                  attachments: [
                    {
                      name: attachmentNames.api(1, 1, 'request'),
                      mediaType: 'application/json',
                      body: JSON.stringify({
                        method: 'GET',
                        url: 'https://api/users/1',
                        headers: { Authorization: '***' },
                      }),
                    },
                    {
                      name: attachmentNames.api(1, 1, 'response'),
                      mediaType: 'application/json',
                      body: JSON.stringify({
                        status: 200,
                        statusText: 'OK',
                        headers: {},
                        body: { id: 1 },
                        responseTime: 42,
                      }),
                    },
                  ],
                },
                {
                  keyword: 'Then',
                  text: 'I click the "Login" button',
                  attachments: [
                    {
                      name: attachmentNames.heal(2, 1),
                      mediaType: 'application/json',
                      body: JSON.stringify({
                        stepIndex: 2,
                        action: 'click',
                        description: 'login button',
                        pageUrl: 'https://x/',
                        originalSelector: '#login-button',
                        context: { role: 'button', name: 'Login' },
                        strategyUsed: 'role',
                        healedSelector: "getByRole('button', { name: 'Login' })",
                        candidates: [
                          {
                            strategy: 'role',
                            selector: "getByRole('button', { name: 'Login' })",
                            score: 1,
                          },
                        ],
                        succeeded: true,
                        durationMs: 312,
                        at: '2026-09-03T10:00:01.000Z',
                      }),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      { runnerProject: PW },
    );
    const { root } = writeRun('run-att', { 'messages.ndjson': ndjson });
    const res = await ingestRun(adb, { runId: 'run-att', artifactsRoot: root });
    expect(res.artifacts).toBeGreaterThanOrEqual(6);
    expect(res.healEvents).toBe(1);
    expect(res.totals.healed).toBe(1);
    const scenarios = await getRunScenarios(adb.db, 'run-att');
    const detail = await getScenarioDetail(adb.db, scenarios[0]!.id);
    const attempt = detail!.attempts[0]!;
    const shots = attempt.artifacts.filter((a) => a.kind === 'screenshot');
    expect(shots.map((a) => a.phase).sort()).toEqual(['after', 'before']);
    expect(shots[0]!.width).toBe(1);
    const abs = join(root, shots[0]!.relPath);
    expect(existsSync(abs)).toBe(true);
    expect(shots[0]!.relPath).toMatch(
      /^run-att\/demo-shop\/[0-9a-f]{16}\/r0\/00-(before|after)\.png$/,
    );
    const apiStep = attempt.steps.find((s) => s.stepIndex === 1)!;
    expect(apiStep.apiSnapshot).toMatchObject({
      request: { method: 'GET' },
      response: { status: 200 },
    });
    expect(apiStep.layerHint).toBe('api');
    expect(attempt.heals).toHaveLength(1);
    expect(attempt.heals[0]!.healedSelector).toContain('getByRole');
    const project = await adb.db
      .selectFrom('projects')
      .select(['id'])
      .where('slug', '=', 'demo-shop')
      .executeTakeFirstOrThrow();
    const events = await listHealEvents(adb.db, { projectId: project.id, runId: 'run-att' });
    expect(events).toHaveLength(1);
    const loc = (await listLocatorStats(adb.db, project.id)).find(
      (l) => l.selector === '#login-button',
    );
    expect(loc?.healCount).toBe(1);
    expect(loc?.suggestedSelector).toContain('getByRole');
    // files on disk: meta.json + api json
    const dir = join(root, 'run-att', 'demo-shop');
    const fp = readdirSync(dir)[0]!;
    const files = readdirSync(join(dir, fp, 'r0'));
    expect(files).toContain('meta.json');
    expect(files).toContain('api');
    expect(JSON.parse(readFileSync(join(dir, fp, 'r0', 'meta.json'), 'utf8'))).toEqual(meta);
  });

  it('runner-json: recorded specs ingest with attempts and flaky detection', async () => {
    const json = buildPwJson({
      projectName: 'demo-shop--recorded--chromium',
      file: 'projects/demo-shop/recorded/checkout.spec.ts',
      title: 'checkout happy path',
      results: [
        {
          status: 'failed',
          retry: 0,
          error: "locator.click: Timeout 5000ms exceeded.\nwaiting for getByTestId('checkout')",
        },
        { status: 'passed', retry: 1 },
      ],
    });
    const { root, runDir } = writeRun(
      'run-pw',
      { 'runner-results.json': json },
      { layers: ['recorded'] },
    );
    writeFileSync(join(runDir, 'runner-results.json'), json);
    const res = await ingestRun(adb, { runId: 'run-pw', artifactsRoot: root });
    expect(res.scenarios).toBe(1);
    expect(res.attempts).toBe(2);
    expect(res.totals).toMatchObject({ total: 1, flaky: 1, passed: 0, failed: 0 });
    const scenarios = await getRunScenarios(adb.db, 'run-pw');
    expect(scenarios[0]!.source).toBe('runner-json');
    expect(scenarios[0]!.layer).toBe('recorded');
    expect(scenarios[0]!.module).toBe('recorded');
    expect(scenarios[0]!.flaky).toBe(true);
    const detail = await getScenarioDetail(adb.db, scenarios[0]!.id);
    expect(detail!.attempts[0]!.steps.map((s) => s.text)).toEqual(['goto /', 'click login']);
  });

  it('still ingests a run directory written before the engine-neutral rename', async () => {
    const json = buildPwJson({
      file: 'recorded/legacy.spec.ts',
      title: 'legacy checkout',
      project: 'demo-shop--recorded--chromium',
      results: [{ status: 'passed', retry: 0 }],
    });
    // Pre-rename layout: pw-results.json beside a playwright-report/ directory.
    const { root, runDir } = writeRun('run-legacy', {}, { layers: ['recorded'] });
    writeFileSync(join(runDir, 'pw-results.json'), json);
    mkdirSync(join(runDir, 'playwright-report'), { recursive: true });
    writeFileSync(join(runDir, 'playwright-report', 'index.html'), '<html></html>');

    const res = await ingestRun(adb, { runId: 'run-legacy', artifactsRoot: root });
    expect(res.scenarios).toBe(1);
    const scenarios = await getRunScenarios(adb.db, 'run-legacy');
    expect(scenarios[0]!.source).toBe('runner-json');
  });

  it('fails clearly when nothing to ingest', async () => {
    const { root } = writeRun('run-empty', {});
    await expect(ingestRun(adb, { runId: 'run-empty', artifactsRoot: root })).rejects.toThrow(
      /No messages/,
    );
  });
});
