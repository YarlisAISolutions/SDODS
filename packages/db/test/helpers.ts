import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, createMemoryDb, type SdodsDb } from '../src/create-db.js';
import { migrateToLatest } from '../src/migrate.js';

/** Open + migrate an in-memory sqlite DB, or Postgres when DATABASE_URL is set (DB_DRIVER=postgres). */
export async function testDb(): Promise<SdodsDb> {
  const adb =
    process.env.DB_DRIVER === 'postgres' && process.env.DATABASE_URL
      ? createDb({ driver: 'postgres', databaseUrl: process.env.DATABASE_URL })
      : createMemoryDb();
  await migrateToLatest(adb);
  if (adb.driver === 'postgres') {
    // isolate runs: wipe rows between suites
    const { TABLES_IN_FK_ORDER } = await import('../src/schema.js');
    for (const t of [...TABLES_IN_FK_ORDER].reverse())
      await (adb.db as any).deleteFrom(t).execute();
  }
  return adb;
}

export function tmpDir(prefix = 'sdods-db-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ── cucumber message fixture builder (mirrors playwright-bdd's message reporter) ────────────
export interface StepSpec {
  keyword: 'Given' | 'When' | 'Then' | 'And';
  text: string;
  status?: 'PASSED' | 'FAILED' | 'SKIPPED';
  durationMs?: number;
  error?: string;
  attachments?: Array<{
    name: string;
    mediaType: string;
    body: string;
    encoding?: 'IDENTITY' | 'BASE64';
  }>;
}

export interface ScenarioSpec {
  name: string;
  tags?: string[];
  steps: StepSpec[];
  /** attempts: each entry gives the statuses of the steps for that attempt (default: one attempt from step.status) */
  attempts?: Array<Array<'PASSED' | 'FAILED' | 'SKIPPED'>>;
  exampleRows?: number; // > 0 → scenario outline with N example rows
}

export interface FeatureSpec {
  uri: string; // e.g. features/ui/login.feature
  name: string;
  tags?: string[];
  scenarios: ScenarioSpec[];
}

export interface BuildOptions {
  pwProject: string; // e.g. demo-shop--ui--chromium
  startMs?: number;
  shard?: number;
}

let idCounter = 0;
const nid = (p: string) => `${p}-${(++idCounter).toString(36)}`;
const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6 });
const dur = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6 });

/** Build an NDJSON string with the same envelope shapes playwright-bdd emits. */
export function buildMessages(features: FeatureSpec[], opts: BuildOptions): string {
  const lines: unknown[] = [];
  const t0 = opts.startMs ?? Date.parse('2026-09-03T10:00:00.000Z');
  let clock = t0;
  lines.push({
    meta: {
      protocolVersion: '28.0.0',
      implementation: { name: 'playwright-bdd', version: '9.2.0' },
      runtime: { name: 'node', version: '22' },
      os: { name: 'darwin' },
      cpu: { name: 'arm64' },
    },
  });
  lines.push({ testRunStarted: { timestamp: ts(clock) } });
  const hookBefore = nid('hook');
  lines.push({
    hook: {
      id: hookBefore,
      type: 'BEFORE_TEST_CASE',
      name: 'BeforeScenario',
      sourceReference: { uri: 'packages/core/src/shots/hooks.ts', location: { line: 10 } },
    },
  });

  for (const f of features) {
    const uri = `[${opts.pwProject}]:${f.uri}`;
    const children: any[] = [];
    const scenarioAst = new Map<
      ScenarioSpec,
      { id: string; stepIds: string[]; rowIds: string[] }
    >();
    let line = 3;
    for (const sc of f.scenarios) {
      const id = nid('sc');
      const stepIds = sc.steps.map(() => nid('ast'));
      const rowIds = Array.from({ length: sc.exampleRows ?? 0 }, () => nid('row'));
      children.push({
        scenario: {
          id,
          keyword: sc.exampleRows ? 'Scenario Outline' : 'Scenario',
          name: sc.name,
          location: { line: line++ },
          tags: (sc.tags ?? []).map((t) => ({ name: t, id: nid('tag'), location: { line } })),
          steps: sc.steps.map((s, i) => ({
            id: stepIds[i],
            keyword: `${s.keyword} `,
            keywordType: s.keyword === 'And' ? 'Conjunction' : 'Context',
            text: s.text,
            location: { line: line++ },
          })),
          examples: sc.exampleRows
            ? [
                {
                  id: nid('ex'),
                  keyword: 'Examples',
                  name: '',
                  location: { line: line++ },
                  tags: [],
                  tableHeader: {
                    id: nid('hdr'),
                    location: { line },
                    cells: [{ value: 'x', location: { line } }],
                  },
                  tableBody: rowIds.map((rid, i) => ({
                    id: rid,
                    location: { line: line++ },
                    cells: [{ value: String(i + 1), location: { line } }],
                  })),
                },
              ]
            : [],
        },
      });
      scenarioAst.set(sc, { id, stepIds, rowIds });
    }
    lines.push({
      gherkinDocument: {
        uri,
        feature: {
          name: f.name,
          keyword: 'Feature',
          language: 'en',
          location: { line: 1 },
          tags: (f.tags ?? []).map((t) => ({ name: t, id: nid('tag'), location: { line: 1 } })),
          children,
          description: '',
        },
        comments: [],
      },
    });

    for (const sc of f.scenarios) {
      const ast = scenarioAst.get(sc)!;
      const rows = sc.exampleRows ? ast.rowIds : [null];
      rows.forEach((rowId, rowIdx) => {
        const pickleId = nid('pickle');
        const pickleSteps = sc.steps.map((s, i) => ({
          id: nid('ps'),
          text: s.text,
          type: 'Context',
          astNodeIds: [ast.stepIds[i]],
        }));
        const tags = [...(f.tags ?? []), ...(sc.tags ?? [])].map((t) => ({
          name: t,
          astNodeId: nid('tag'),
        }));
        lines.push({
          pickle: {
            id: pickleId,
            uri,
            name: sc.exampleRows ? `${sc.name} (Example #${rowIdx + 1})` : sc.name,
            language: 'en',
            steps: pickleSteps,
            tags,
            astNodeIds: rowId ? [ast.id, rowId] : [ast.id],
          },
        });
        const testCaseId = nid('tc');
        const testSteps = [
          { id: `${testCaseId}-before-0`, hookId: hookBefore },
          ...pickleSteps.map((ps, i) => ({
            id: `${testCaseId}-step-${i}`,
            pickleStepId: ps.id,
            stepDefinitionIds: [],
          })),
        ];
        lines.push({ testCase: { id: testCaseId, pickleId, testSteps } });
        const attempts = sc.attempts ?? [sc.steps.map((s) => s.status ?? 'PASSED')];
        attempts.forEach((statuses, attempt) => {
          const tcsId = `${testCaseId}-attempt-${attempt}`;
          clock += 5;
          lines.push({ testCaseStarted: { id: tcsId, attempt, testCaseId, timestamp: ts(clock) } });
          // hook
          lines.push({
            testStepStarted: {
              testCaseStartedId: tcsId,
              testStepId: `${testCaseId}-before-0`,
              timestamp: ts(clock),
            },
          });
          clock += 3;
          lines.push({
            testStepFinished: {
              testCaseStartedId: tcsId,
              testStepId: `${testCaseId}-before-0`,
              testStepResult: { duration: dur(3), status: 'PASSED' },
              timestamp: ts(clock),
            },
          });
          let failed = false;
          sc.steps.forEach((s, i) => {
            const stepId = `${testCaseId}-step-${i}`;
            const status = failed ? 'SKIPPED' : (statuses[i] ?? 'PASSED');
            lines.push({
              testStepStarted: {
                testCaseStartedId: tcsId,
                testStepId: stepId,
                timestamp: ts(clock),
              },
            });
            const d = s.durationMs ?? 20;
            clock += d;
            const result: any = { duration: dur(d), status };
            if (status === 'FAILED') {
              failed = true;
              const msg =
                s.error ??
                `Error: locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for locator('#login-button')\n`;
              result.message = msg;
              result.exception = { type: 'Error', message: msg, stackTrace: msg };
            }
            for (const a of s.attachments ?? []) {
              lines.push({
                attachment: {
                  testCaseStartedId: tcsId,
                  testStepId: stepId,
                  mediaType: a.mediaType,
                  fileName: a.name,
                  body: a.body,
                  contentEncoding: a.encoding ?? 'IDENTITY',
                  timestamp: ts(clock),
                },
              });
            }
            lines.push({
              testStepFinished: {
                testCaseStartedId: tcsId,
                testStepId: stepId,
                testStepResult: result,
                timestamp: ts(clock),
              },
            });
          });
          clock += 2;
          const willBeRetried = failed && attempt < attempts.length - 1;
          lines.push({
            testCaseFinished: { testCaseStartedId: tcsId, willBeRetried, timestamp: ts(clock) },
          });
        });
      });
    }
  }
  clock += 10;
  lines.push({ testRunFinished: { timestamp: ts(clock), success: true } });
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/** 1x1 transparent PNG */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Write a run directory with run.json and message files; returns root + runDir. */
export function writeRun(
  runId: string,
  files: Record<string, string>,
  manifest?: Record<string, unknown>,
): { root: string; runDir: string } {
  const root = tmpDir('sdods-runs-');
  const runDir = join(root, runId);
  mkdirSync(runDir, { recursive: true });
  if (manifest !== null) {
    writeFileSync(
      join(runDir, 'run.json'),
      JSON.stringify({
        runId,
        projectSlug: 'demo-shop',
        env: 'staging',
        layers: ['ui'],
        browsers: ['chromium'],
        trigger: 'cli',
        startedAt: '2026-09-03T10:00:00.000Z',
        command: 'sdods run',
        sdodsVersion: '0.1.0',
        ...(manifest ?? {}),
      }),
    );
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(join(runDir, name), content);
  return { root, runDir };
}

/** Minimal Playwright JSON reporter output for the recorded layer. */
export function buildPwJson(opts: {
  projectName: string;
  file: string;
  title: string;
  results: Array<{ status: 'passed' | 'failed'; retry: number; error?: string }>;
}): string {
  return JSON.stringify({
    config: { rootDir: '/tmp/pw' },
    suites: [
      {
        title: opts.file,
        file: opts.file,
        specs: [
          {
            title: opts.title,
            file: opts.file,
            line: 3,
            tags: ['recorded', 'regression'],
            tests: [
              {
                id: 'abc123',
                projectName: opts.projectName,
                retries: 1,
                results: opts.results.map((r, i) => ({
                  status: r.status,
                  retry: r.retry,
                  duration: 1200 + i,
                  startTime: new Date(
                    Date.parse('2026-09-03T11:00:00.000Z') + i * 2000,
                  ).toISOString(),
                  error: r.error ? { message: r.error, stack: r.error } : undefined,
                  errors: r.error ? [{ message: r.error }] : [],
                  attachments: [],
                  steps: [
                    { title: 'goto /', category: 'test.step', duration: 100 },
                    {
                      title: 'click login',
                      category: 'test.step',
                      duration: 50,
                      error: r.error ? { message: r.error } : undefined,
                    },
                  ],
                })),
                status:
                  opts.results.some((r) => r.status === 'failed') &&
                  opts.results[opts.results.length - 1]!.status === 'passed'
                    ? 'flaky'
                    : opts.results[opts.results.length - 1]!.status === 'passed'
                      ? 'expected'
                      : 'unexpected',
              },
            ],
          },
        ],
        suites: [],
      },
    ],
  });
}
