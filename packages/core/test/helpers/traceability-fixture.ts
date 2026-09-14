import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Gherkin from '@cucumber/gherkin';
import * as Messages from '@cucumber/messages';
import { parse as parseYaml } from 'yaml';
import { ProjectConfigSchema } from '@sdods/contracts';

/**
 * A small repository with one project (`shop`) whose scenarios carry `@req:` tags, and helpers that
 * write run directories the way `sdods run` does: `run.json` plus cucumber messages NDJSON.
 * Shared by the core export tests and the CLI test.
 */

export const PROJECT_YAML = `slug: shop
name: Shop
layers: [ui, api]
browsers: [chromium, firefox]
envs: { default: staging, available: [staging, prod] }
traceability:
  requirements: requirements.yaml
  link: https://jira.example.com/browse/{id}
`;

export const REQUIREMENTS_YAML = `requirements:
  - id: AUTH-1
    title: A registered user can sign in
  - id: AUTH-2
    title: A locked account cannot sign in
  - id: ORD-1
    title: A customer can place an order
  - id: ORD-2
    title: A customer can cancel an order
  - id: PAY-1
    title: Card payments are captured
`;

export const FEATURES: Record<string, string> = {
  'features/auth/login.feature': `@ui @req:AUTH-1
Feature: Login

  @smoke
  Scenario: Valid login
    Given I open the login page
    When I sign in as "standard"
    Then I see the products

  @regression @req:AUTH-2
  Scenario: Locked user
    Given I open the login page
    When I sign in as "locked"
    Then I see the error "locked"
`,
  'features/api/orders.feature': `@api
Feature: Orders

  # title-format: Create order <item>
  @smoke @req:ORD-1
  Scenario Outline: Create order
    When I send a POST request to "/orders" with item "<item>"
    Then the response status should be 201

    Examples:
      | item   |
      | apple  |
      | banana |

  @regression @req:ORD-2
  Scenario: Cancel order
    When I send a DELETE request to "/orders/1"
    Then the response status should be 204

  @smoke
  Scenario: Health
    When I send a GET request to "/health"
    Then the response status should be 200
`,
};

/** Write the repository; returns the repo root and the parsed project (with `root`). */
export function writeTraceRepo(root: string, projectYaml = PROJECT_YAML) {
  writeFileSync(join(root, 'package.json'), '{}');
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  writeFileSync(join(proj, 'sdods.project.yaml'), projectYaml);
  for (const env of ['staging', 'prod'])
    writeFileSync(
      join(proj, 'envs', `${env}.yaml`),
      'ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000 }\n',
    );
  writeFileSync(join(proj, 'requirements.yaml'), REQUIREMENTS_YAML);
  for (const [rel, text] of Object.entries(FEATURES)) {
    mkdirSync(join(proj, rel, '..'), { recursive: true });
    writeFileSync(join(proj, rel), text);
  }
  return { root, projectRoot: proj, project: loadProject(proj) };
}

export function loadProject(projectRoot: string) {
  const raw = parseYaml(readFileSync(join(projectRoot, 'sdods.project.yaml'), 'utf8'));
  return { ...ProjectConfigSchema.parse(raw), root: projectRoot };
}

export interface FixtureAttempt {
  runnerProject: string;
  feature: string;
  scenario: string;
  /** 1-based Examples row for outlines */
  example?: number;
  attempt?: number;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  /** ISO start time */
  start: string;
  durationMs: number;
  error?: string;
  /** add an AFTER_TEST_CASE hook step with this result (after-hooks run even for skipped steps) */
  afterHook?: 'PASSED' | 'FAILED';
  /** per Gherkin step results, overriding `status` for the steps (missing entries are SKIPPED) */
  stepStatuses?: Array<'PASSED' | 'FAILED' | 'SKIPPED'>;
}

/**
 * Cucumber messages for the given attempts, shaped like playwright-bdd's reporter output: pickle
 * uris are `[<runner project>]:projects/shop/<feature>`, every attempt has its own
 * testCaseStarted/testStepFinished/testCaseFinished, and attachments sit in between.
 */
export function messagesFor(attempts: FixtureAttempt[], projectsPrefix = 'projects/shop'): string {
  const newId = Messages.IdGenerator.incrementing();
  const lines: unknown[] = [{ meta: { protocolVersion: '32.2.0' } }];
  const pickleFor = new Map<string, Messages.Pickle>();
  const emitted = new Set<string>();
  const ts = (iso: string) => {
    const ms = Date.parse(iso);
    return { seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6 };
  };

  for (const a of attempts) {
    const key = `${a.runnerProject}|${a.feature}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    const envelopes = Gherkin.generateMessages(
      FEATURES[a.feature]!,
      `[${a.runnerProject}]:${projectsPrefix}/${a.feature}`,
      Messages.SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
      { includeSource: false, includeGherkinDocument: true, includePickles: true, newId },
    );
    const doc = envelopes.find((e) => e.gherkinDocument)!.gherkinDocument!;
    lines.push({ gherkinDocument: doc });
    const scenarios = new Map<string, string>();
    for (const child of doc.feature!.children)
      if (child.scenario) scenarios.set(child.scenario.id, child.scenario.name);
    const perScenario = new Map<string, number>();
    for (const e of envelopes) {
      if (!e.pickle) continue;
      lines.push({ pickle: e.pickle });
      const name = scenarios.get(e.pickle.astNodeIds[0]!)!;
      const n = (perScenario.get(name) ?? 0) + 1;
      perScenario.set(name, n);
      pickleFor.set(`${key}|${name}|${n}`, e.pickle);
    }
  }

  for (const a of attempts) {
    const pickle = pickleFor.get(`${a.runnerProject}|${a.feature}|${a.scenario}|${a.example ?? 1}`);
    if (!pickle) throw new Error(`fixture: no pickle for ${a.feature} / ${a.scenario}`);
    const testCaseId = newId();
    const steps: Array<{ id: string; pickleStepId?: string; hookId?: string; status: string }> =
      pickle.steps.map((s, i) => ({
        id: newId(),
        pickleStepId: s.id,
        status: a.stepStatuses
          ? (a.stepStatuses[i] ?? 'SKIPPED')
          : a.status === 'FAILED'
            ? i === 0
              ? 'FAILED'
              : 'SKIPPED'
            : a.status,
      }));
    if (a.afterHook) steps.push({ id: newId(), hookId: 'hook-finalize', status: a.afterHook });
    lines.push({
      testCase: {
        id: testCaseId,
        pickleId: pickle.id,
        testSteps: steps.map(({ status: _s, ...step }) => step),
      },
    });
    const startedId = newId();
    lines.push({
      testCaseStarted: {
        id: startedId,
        testCaseId,
        attempt: a.attempt ?? 0,
        timestamp: ts(a.start),
      },
    });
    const each = Math.floor(a.durationMs / Math.max(steps.length, 1));
    steps.forEach(({ status, ...step }) => {
      lines.push({ testStepStarted: { testCaseStartedId: startedId, testStepId: step.id } });
      lines.push({
        testStepFinished: {
          testCaseStartedId: startedId,
          testStepId: step.id,
          testStepResult: {
            status,
            duration: { seconds: 0, nanos: each * 1e6 },
            ...(status === 'FAILED' ? { message: a.error ?? 'boom\n    at step' } : {}),
          },
        },
      });
    });
    lines.push({
      attachment: { testCaseStartedId: startedId, body: 'aGVsbG8=', contentEncoding: 'BASE64' },
    });
    lines.push({
      testCaseFinished: {
        testCaseStartedId: startedId,
        timestamp: ts(new Date(Date.parse(a.start) + a.durationMs).toISOString()),
        willBeRetried: false,
      },
    });
  }
  return `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
}

export interface FixtureRun {
  runId: string;
  env?: string;
  project?: string;
  startedAt: string;
  attempts?: FixtureAttempt[];
}

/** `<artifactsRoot>/<runId>/run.json` (+ `messages.ndjson` when attempts are given). */
export function writeRun(artifactsRoot: string, run: FixtureRun): string {
  const dir = join(artifactsRoot, run.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify(
      {
        runId: run.runId,
        projectSlug: run.project ?? 'shop',
        env: run.env ?? 'staging',
        tagsExpr: '@smoke or @regression',
        layers: ['ui', 'api'],
        browsers: ['chromium', 'firefox'],
        trigger: 'ci',
        git: { sha: '0123456789abcdef0123456789abcdef01234567', branch: 'main', dirty: false },
        ci: { provider: 'github', runId: '42', url: 'https://ci.example.com/runs/42' },
        startedAt: run.startedAt,
        finishedAt: new Date(Date.parse(run.startedAt) + 60_000).toISOString(),
        command: 'run -p shop -e staging',
        sdodsVersion: '0.7.2',
        exitCode: 1,
      },
      null,
      2,
    ),
  );
  if (run.attempts) writeFileSync(join(dir, 'messages.ndjson'), messagesFor(run.attempts));
  return dir;
}

/** The outcomes the golden files describe. */
export const STANDARD_ATTEMPTS: FixtureAttempt[] = [
  // AUTH-1 (inherited from the Feature): Valid login passes on both browsers.
  {
    runnerProject: 'shop--ui--chromium',
    feature: 'features/auth/login.feature',
    scenario: 'Valid login',
    status: 'PASSED',
    start: '2026-09-01T10:00:00.000Z',
    durationMs: 1200,
  },
  {
    runnerProject: 'shop--ui--firefox',
    feature: 'features/auth/login.feature',
    scenario: 'Valid login',
    status: 'PASSED',
    start: '2026-09-01T10:00:02.000Z',
    durationMs: 1500,
  },
  // AUTH-2: flaky on chromium (failed, then passed on retry), failed on firefox.
  {
    runnerProject: 'shop--ui--chromium',
    feature: 'features/auth/login.feature',
    scenario: 'Locked user',
    attempt: 0,
    status: 'FAILED',
    start: '2026-09-01T10:00:04.000Z',
    durationMs: 900,
  },
  {
    runnerProject: 'shop--ui--chromium',
    feature: 'features/auth/login.feature',
    scenario: 'Locked user',
    attempt: 1,
    status: 'PASSED',
    start: '2026-09-01T10:00:06.000Z',
    durationMs: 800,
  },
  {
    runnerProject: 'shop--ui--firefox',
    feature: 'features/auth/login.feature',
    scenario: 'Locked user',
    status: 'FAILED',
    start: '2026-09-01T10:00:08.000Z',
    durationMs: 1000,
    error: 'expected "locked" to be visible\n    at login.steps.ts:12',
  },
  // ORD-1: an outline, both example rows pass.
  {
    runnerProject: 'shop--api',
    feature: 'features/api/orders.feature',
    scenario: 'Create order',
    example: 1,
    status: 'PASSED',
    start: '2026-09-01T10:00:10.000Z',
    durationMs: 300,
  },
  {
    runnerProject: 'shop--api',
    feature: 'features/api/orders.feature',
    scenario: 'Create order',
    example: 2,
    status: 'PASSED',
    start: '2026-09-01T10:00:11.000Z',
    durationMs: 350,
  },
  // Untraced, skipped.
  {
    runnerProject: 'shop--api',
    feature: 'features/api/orders.feature',
    scenario: 'Health',
    status: 'SKIPPED',
    start: '2026-09-01T10:00:12.000Z',
    durationMs: 0,
  },
  // ORD-2 (Cancel order) never ran; PAY-1 has no scenario.
];
