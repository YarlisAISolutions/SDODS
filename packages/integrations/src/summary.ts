import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  fingerprint as makeFingerprint,
  parseAttachmentName,
  parseRunnerProjectName,
  runFiles,
  scenarioFiles,
  type RunManifest,
  type RunRecord,
  type RunTotals,
  type SuiteStatus,
} from '@sdods/contracts';
import type { RunSummaryInput, ScenarioSummary, ScreenshotRef, StepSummary } from './types.js';

/**
 * Build a RunSummaryInput from the files in a run directory (`.sdods/runs/<runId>`), so
 * `sdods integrations notify --from-files` works without a database.
 * Reads run.json (manifest), summary.json (optional totals) and messages*.ndjson (cucumber messages).
 */
export function buildRunSummaryFromFiles(
  runDir: string,
  opts: { projectSlug?: string; reportUrl?: string } = {},
): RunSummaryInput {
  const manifest = readJson<RunManifest>(join(runDir, runFiles.manifest));
  const runId = manifest?.runId ?? basename(runDir);
  const projectSlug = opts.projectSlug ?? manifest?.projectSlug ?? 'unknown';
  const ndjsonFiles = listNdjson(runDir);
  const scenarios = ndjsonFiles.flatMap((f) =>
    parseMessages(readFileSync(f, 'utf8'), { runDir, projectSlug }),
  );
  const totals = computeTotals(scenarios, manifest);
  const run: RunRecord = {
    id: runId,
    projectSlug,
    env: manifest?.env ?? 'unknown',
    trigger: manifest?.trigger ?? 'cli',
    status: totals.failed > 0 ? 'failed' : manifest?.exitCode === 130 ? 'cancelled' : 'passed',
    suiteTag: manifest?.suiteTag,
    tagsExpr: manifest?.tagsExpr,
    layers: manifest?.layers ?? [],
    browsers: manifest?.browsers ?? [],
    gitSha: manifest?.git?.sha,
    gitBranch: manifest?.git?.branch,
    ciProvider: manifest?.ci?.provider,
    ciRunId: manifest?.ci?.runId,
    ciUrl: manifest?.ci?.url,
    startedAt: manifest?.startedAt,
    finishedAt: manifest?.finishedAt,
    durationMs: totals.durationMs,
    totals,
    artifactsDir: runDir,
    exitCode: manifest?.exitCode,
  };
  const failed = scenarios.filter((s) => s.status === 'failed' || s.status === 'timedOut');
  const flaky = scenarios.filter((s) => s.flaky);
  const passed = scenarios.filter((s) => s.status === 'passed');
  return { run, totals, scenarios, failed, flaky, passed, runDir, reportUrl: opts.reportUrl };
}

function listNdjson(runDir: string): string[] {
  const out: string[] = [];
  const main = join(runDir, runFiles.messages);
  if (existsSync(main)) out.push(main);
  for (let i = 1; i <= 64; i++) {
    const f = join(runDir, runFiles.messagesShard(i));
    if (existsSync(f)) out.push(f);
  }
  return out;
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function computeTotals(scenarios: ScenarioSummary[], manifest?: RunManifest): RunTotals {
  const totals: RunTotals = {
    total: scenarios.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    flaky: 0,
    healed: 0,
    durationMs: 0,
  };
  for (const s of scenarios) {
    if (s.status === 'passed') totals.passed++;
    else if (s.status === 'failed') totals.failed++;
    else if (s.status === 'timedOut') totals.timedOut++;
    else if (s.status === 'skipped') totals.skipped++;
    if (s.flaky) totals.flaky++;
  }
  if (manifest?.startedAt && manifest.finishedAt) {
    totals.durationMs = Math.max(
      0,
      Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt),
    );
  } else {
    totals.durationMs = scenarios.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  }
  return totals;
}

// ── cucumber messages (minimal, tolerant) ─────────────────────────────────────

interface Envelope {
  gherkinDocument?: { uri?: string; feature?: { name?: string; children?: any[] } };
  pickle?: {
    id: string;
    uri: string;
    name: string;
    tags?: Array<{ name: string }>;
    steps?: Array<{ id: string; text: string; type?: string; astNodeIds?: string[] }>;
    astNodeIds?: string[];
  };
  testCase?: {
    id: string;
    pickleId: string;
    testSteps?: Array<{ id: string; pickleStepId?: string; hookId?: string }>;
  };
  testCaseStarted?: { id: string; testCaseId: string; attempt?: number; timestamp?: Ts };
  testStepStarted?: { testCaseStartedId: string; testStepId: string; timestamp?: Ts };
  testStepFinished?: {
    testCaseStartedId: string;
    testStepId: string;
    testStepResult?: {
      status?: string;
      duration?: { seconds?: number; nanos?: number };
      message?: string;
      exception?: { message?: string; stackTrace?: string };
    };
    timestamp?: Ts;
  };
  testCaseFinished?: { testCaseStartedId: string; willBeRetried?: boolean; timestamp?: Ts };
  attachment?: {
    testCaseStartedId?: string;
    testStepId?: string;
    fileName?: string;
    mediaType?: string;
    url?: string;
    body?: string;
    contentEncoding?: string;
  };
}
type Ts = { seconds?: number; nanos?: number };

interface AttemptState {
  scenarioKey: string;
  attempt: number;
  steps: StepSummary[];
  status: SuiteStatus;
  error?: string;
  stack?: string;
  startedAt?: number;
  finishedAt?: number;
  screenshots: ScreenshotRef[];
  tracePath?: string;
  willBeRetried?: boolean;
}

export function parseMessages(
  text: string,
  opts: { runDir?: string; projectSlug: string },
): ScenarioSummary[] {
  const docs = new Map<
    string,
    { name: string; lines: Map<string, number>; examplesIndex: Map<string, number> }
  >();
  const pickles = new Map<string, NonNullable<Envelope['pickle']>>();
  const testCases = new Map<string, NonNullable<Envelope['testCase']>>();
  const attempts = new Map<string, AttemptState>();
  const scenarios = new Map<
    string,
    { pickle: NonNullable<Envelope['pickle']>; runnerProject: string; attempts: AttemptState[] }
  >();
  const stepStarts = new Map<string, number>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let env: Envelope;
    try {
      env = JSON.parse(trimmed) as Envelope;
    } catch {
      continue;
    }
    if (env.gherkinDocument?.uri) {
      const lines = new Map<string, number>();
      const examplesIndex = new Map<string, number>();
      const walk = (children: any[] | undefined) => {
        for (const c of children ?? []) {
          const node = c.scenario ?? c.background;
          if (node?.id) lines.set(node.id, node.location?.line ?? 0);
          if (c.scenario?.examples) {
            let idx = 0;
            for (const ex of c.scenario.examples)
              for (const row of ex.tableBody ?? []) examplesIndex.set(row.id, idx++);
          }
          if (c.rule) walk(c.rule.children);
        }
      };
      walk(env.gherkinDocument.feature?.children);
      docs.set(splitUri(env.gherkinDocument.uri).uri, {
        name: env.gherkinDocument.feature?.name ?? '',
        lines,
        examplesIndex,
      });
    } else if (env.pickle) {
      pickles.set(env.pickle.id, env.pickle);
    } else if (env.testCase) {
      testCases.set(env.testCase.id, env.testCase);
    } else if (env.testCaseStarted) {
      const tc = testCases.get(env.testCaseStarted.testCaseId);
      const pickle = tc && pickles.get(tc.pickleId);
      if (!tc || !pickle) continue;
      const { runnerProject, uri } = splitUri(pickle.uri);
      const key = `${runnerProject}:${pickle.id}`;
      const state: AttemptState = {
        scenarioKey: key,
        attempt: env.testCaseStarted.attempt ?? 0,
        steps: [],
        status: 'passed',
        startedAt: tsMs(env.testCaseStarted.timestamp),
        screenshots: [],
      };
      attempts.set(env.testCaseStarted.id, state);
      const entry = scenarios.get(key) ?? {
        pickle: { ...pickle, uri },
        runnerProject,
        attempts: [],
      };
      entry.attempts.push(state);
      scenarios.set(key, entry);
    } else if (env.testStepStarted) {
      stepStarts.set(
        `${env.testStepStarted.testCaseStartedId}:${env.testStepStarted.testStepId}`,
        tsMs(env.testStepStarted.timestamp) ?? 0,
      );
    } else if (env.testStepFinished) {
      const state = attempts.get(env.testStepFinished.testCaseStartedId);
      if (!state) continue;
      const entry = scenarios.get(state.scenarioKey);
      const tc = entry && [...testCases.values()].find((t) => t.pickleId === entry.pickle.id);
      const ts = tc?.testSteps?.find((s) => s.id === env.testStepFinished!.testStepId);
      const result = env.testStepFinished.testStepResult ?? {};
      const status = mapStatus(result.status);
      if (ts?.pickleStepId) {
        const idx = entry!.pickle.steps?.findIndex((s) => s.id === ts.pickleStepId) ?? -1;
        const pstep = entry!.pickle.steps?.[idx];
        state.steps.push({
          index: idx,
          keyword: keywordFromType(pstep?.type),
          text: pstep?.text ?? '',
          status,
          errorMessage: result.exception?.message ?? result.message,
          durationMs: durMs(result.duration),
        });
      }
      if ((status === 'failed' || status === 'timedOut') && state.status === 'passed') {
        state.status = status;
        state.error = result.exception?.message ?? result.message;
        state.stack = result.exception?.stackTrace;
      } else if (status === 'skipped' && state.status === 'passed' && ts?.pickleStepId) {
        state.status = 'skipped';
      }
    } else if (env.attachment?.testCaseStartedId) {
      const state = attempts.get(env.attachment.testCaseStartedId);
      if (!state || !env.attachment.fileName) continue;
      const parsed = parseAttachmentName(env.attachment.fileName);
      const entry = scenarios.get(state.scenarioKey)!;
      const rel = (p: string) => relPathFor(opts.projectSlug, entry, state, p);
      if (parsed.kind === 'shot-scenario')
        state.screenshots.push({
          relPath: rel(scenarioFiles.scenarioShot(parsed.phase)),
          phase:
            parsed.phase === 'start'
              ? 'scenario-start'
              : parsed.phase === 'end'
                ? 'scenario-end'
                : 'failure',
        });
      else if (parsed.kind === 'shot-step')
        state.screenshots.push({
          relPath: rel(scenarioFiles.stepShot(parsed.stepIndex, parsed.phase)),
          phase: parsed.phase,
          stepIndex: parsed.stepIndex,
        });
      else if (parsed.kind === 'visual-baseline')
        state.screenshots.push({
          relPath: env.attachment.url ?? `${parsed.name}-${parsed.phase}.png`,
          phase: parsed.phase,
          name: parsed.name,
        });
      else if (parsed.kind === 'runner-builtin' && parsed.name === 'screenshot')
        state.screenshots.push({
          relPath: env.attachment.url ?? 'screenshot.png',
          phase: 'failure',
        });
      else if (parsed.kind === 'runner-builtin' && parsed.name === 'trace')
        state.tracePath = env.attachment.url ?? 'trace.zip';
    } else if (env.testCaseFinished) {
      const state = attempts.get(env.testCaseFinished.testCaseStartedId);
      if (!state) continue;
      state.finishedAt = tsMs(env.testCaseFinished.timestamp);
      state.willBeRetried = env.testCaseFinished.willBeRetried;
    }
  }

  const out: ScenarioSummary[] = [];
  for (const { pickle, runnerProject, attempts: atts } of scenarios.values()) {
    const sorted = atts.sort((a, b) => a.attempt - b.attempt);
    const final = sorted[sorted.length - 1]!;
    const doc = docs.get(pickle.uri);
    const parts = parseRunnerProjectName(runnerProject);
    const layer = parts?.layer ?? 'ui';
    const scenarioAst = pickle.astNodeIds?.[0];
    const exampleRow = pickle.astNodeIds?.[1];
    const exampleIndex = exampleRow && doc ? (doc.examplesIndex.get(exampleRow) ?? null) : null;
    const tags = (pickle.tags ?? []).map((t) => t.name);
    const fp = makeFingerprint({
      project: opts.projectSlug,
      featureUri: pickle.uri,
      scenarioName: pickle.name,
      exampleIndex,
      layer,
    });
    out.push({
      fingerprint: fp,
      featureUri: pickle.uri,
      featureName: doc?.name ?? pickle.uri,
      scenarioName: pickle.name,
      line: scenarioAst && doc ? doc.lines.get(scenarioAst) : undefined,
      exampleIndex,
      runnerProject,
      layer,
      browser: parts?.browser,
      suiteTag: tags.find((t) => ['@smoke', '@regression', '@sanity'].includes(t)),
      tags,
      status: final.status,
      flaky: sorted.length > 1 && final.status === 'passed',
      attemptsCount: sorted.length,
      durationMs:
        final.startedAt !== undefined && final.finishedAt !== undefined
          ? final.finishedAt - final.startedAt
          : undefined,
      errorMessage: final.error,
      errorStack: final.stack,
      steps: final.steps,
      screenshots: final.screenshots,
      jiraKeys: tags
        .filter((t) => /^@jira:[A-Z][A-Z0-9]+-\d+$/i.test(t))
        .map((t) => t.slice('@jira:'.length).toUpperCase()),
      githubIssues: tags
        .filter((t) => /^@github:\d+$/.test(t))
        .map((t) => t.slice('@github:'.length)),
      tracePath: final.tracePath,
    });
  }
  return out;
}

function relPathFor(
  projectSlug: string,
  entry: { pickle: { uri: string; name: string; astNodeIds?: string[] }; runnerProject: string },
  state: AttemptState,
  file: string,
): string {
  const parts = parseRunnerProjectName(entry.runnerProject);
  const fp = makeFingerprint({
    project: projectSlug,
    featureUri: entry.pickle.uri,
    scenarioName: entry.pickle.name,
    exampleIndex: null,
    layer: parts?.layer ?? 'ui',
  });
  return `${projectSlug}/${fp}/r${state.attempt}/${file}`;
}

function splitUri(uri: string): { runnerProject: string; uri: string } {
  const m = /^\[([^\]]+)\]:(.*)$/.exec(uri);
  return m ? { runnerProject: m[1]!, uri: m[2]! } : { runnerProject: 'unknown', uri };
}

function mapStatus(s: string | undefined): SuiteStatus {
  switch ((s ?? '').toUpperCase()) {
    case 'PASSED':
      return 'passed';
    case 'FAILED':
      return 'failed';
    case 'SKIPPED':
    case 'PENDING':
    case 'UNDEFINED':
    case 'AMBIGUOUS':
      return 'skipped';
    default:
      return 'unknown';
  }
}

function keywordFromType(type: string | undefined): string | undefined {
  switch (type) {
    case 'Context':
      return 'Given';
    case 'Action':
      return 'When';
    case 'Outcome':
      return 'Then';
    default:
      return undefined;
  }
}

function tsMs(ts?: Ts): number | undefined {
  if (!ts) return undefined;
  return (ts.seconds ?? 0) * 1000 + Math.floor((ts.nanos ?? 0) / 1e6);
}

function durMs(d?: { seconds?: number; nanos?: number }): number | undefined {
  if (!d) return undefined;
  return (d.seconds ?? 0) * 1000 + Math.floor((d.nanos ?? 0) / 1e6);
}
