import { join } from 'node:path';
import {
  fingerprint as makeFingerprint,
  newId,
  parseRunnerProjectName,
} from '@sdods/contracts/ids';
import type { ParsedAttachment } from '@sdods/contracts/names';
import type {
  ApiSnapshot,
  HealEvent,
  PerformanceMetrics,
  ScenarioMeta,
  SuiteStatus,
} from '@sdods/contracts/types';
import { enc, nowIso, readJson } from '../col.js';
import { insertHealEvent } from '../repos/improvement.js';
import {
  artifactKindFor,
  attachmentBytes,
  attachmentText,
  parseAttachmentName,
  storeFile,
  targetFileFor,
  type AttachmentInput,
} from './attachments.js';
import type { LocatorCounter } from './finalize.js';
import { MessageIndex, type PickleInfo } from './message-index.js';
import type { Envelope } from './parse-ndjson.js';
import {
  cucumberStatus,
  moduleFromUri,
  selectorFromError,
  splitUri,
  tsToIso,
  tsToMs,
  type IngestContext,
} from './types.js';

interface AttemptCtx {
  scenarioId: string;
  attemptId: string;
  attempt: number;
  fingerprint: string;
  slug: string;
  dir: string;
  pickle: PickleInfo;
  testCaseId: string;
  stepIndexByTestStepId: Map<string, number>;
  stepIdByTestStepId: Map<string, string>;
  statuses: SuiteStatus[];
  firstError?: { message: string | null; stack: string | null };
  startedAtIso: string | null;
  lastStepEndIso: string | null;
}

export interface CucumberIngestCounts {
  scenarios: number;
  attempts: number;
  steps: number;
  artifacts: number;
  healEvents: number;
}

/**
 * State machine over cucumber message envelopes. Static messages are indexed; dynamic ones are
 * upserted immediately with natural keys so re-ingest converges.
 */
export class IngestSession {
  readonly idx = new MessageIndex();
  readonly locatorCounters = new Map<string, LocatorCounter>();
  readonly counts: CucumberIngestCounts = {
    scenarios: 0,
    attempts: 0,
    steps: 0,
    artifacts: 0,
    healEvents: 0,
  };
  runStartedAt: string | null = null;
  runFinishedAt: string | null = null;
  private readonly attempts = new Map<string, AttemptCtx>();
  private readonly pendingStepStart = new Map<string, string | null>();
  private readonly seenScenarios = new Set<string>();
  private readonly pendingTestCases: any[] = [];

  constructor(private readonly ctx: IngestContext) {}

  async consume(env: Envelope): Promise<void> {
    if (env.gherkinDocument) this.idx.addDoc(env.gherkinDocument);
    else if (env.pickle) this.idx.addPickle(env.pickle);
    else if (env.stepDefinition) this.idx.addStepDef(env.stepDefinition);
    else if (env.hook) this.idx.addHook(env.hook);
    else if (env.testCase) this.idx.addTestCase(env.testCase);
    else if (env.testRunStarted)
      this.runStartedAt = minIso(this.runStartedAt, tsToIso(env.testRunStarted.timestamp));
    else if (env.testCaseStarted) await this.onAttemptStarted(env.testCaseStarted);
    else if (env.testStepStarted)
      this.pendingStepStart.set(
        `${env.testStepStarted.testCaseStartedId}|${env.testStepStarted.testStepId}`,
        tsToIso(env.testStepStarted.timestamp),
      );
    else if (env.testStepFinished) await this.onStepFinished(env.testStepFinished);
    else if (env.attachment) await this.onAttachment(env.attachment);
    else if (env.testCaseFinished) await this.onAttemptFinished(env.testCaseFinished);
    else if (env.testRunFinished)
      this.runFinishedAt = maxIso(this.runFinishedAt, tsToIso(env.testRunFinished.timestamp));
  }

  private async onAttemptStarted(tcs: any): Promise<void> {
    const testCase = this.idx.testCases.get(tcs.testCaseId);
    if (!testCase) return;
    const pickle = this.idx.pickles.get(testCase.pickleId);
    if (!pickle) return;
    const { runnerProject, uri } = splitUri(pickle.uri);
    const parts = runnerProject ? parseRunnerProjectName(runnerProject) : null;
    const slug = parts?.project ?? this.ctx.projectSlug;
    const layer = parts?.layer ?? layerFromTags(pickle.tags) ?? 'ui';
    const browser = parts?.browser ?? null;
    const exampleIndex = this.idx.exampleIndex(pickle);
    const scenarioName = this.idx.scenarioTitle(pickle);
    const fp = makeFingerprint({
      project: slug,
      featureUri: uri,
      scenarioName,
      exampleIndex,
      layer,
    });
    const naturalKey = `${runnerProject ?? layer}:${pickle.id}`;
    const attempt = Number(tcs.attempt ?? 0);
    const { db, driver } = this.ctx.adb;

    let scenarioId: string;
    const existing = await db
      .selectFrom('scenarios')
      .select(['id'])
      .where('run_id', '=', this.ctx.runId)
      .where('natural_key', '=', naturalKey)
      .executeTakeFirst();
    if (existing) {
      scenarioId = existing.id;
    } else {
      scenarioId = newId();
      await db
        .insertInto('scenarios')
        .values({
          id: scenarioId,
          run_id: this.ctx.runId,
          project_id: this.ctx.projectId,
          natural_key: naturalKey,
          fingerprint: fp,
          source: 'gherkin',
          feature_uri: uri,
          feature_name: this.idx.featureName(pickle.uri) ?? this.idx.featureName(uri),
          scenario_name: exampleIndex ? pickle.name : scenarioName,
          module: moduleFromUri(uri),
          examples_row: exampleIndex,
          runner_project: runnerProject ?? `${slug}--${layer}`,
          layer,
          browser,
          suite_tag: suiteFromTags(pickle.tags),
          tags_json: enc.json(pickle.tags),
          jira_keys_json: enc.json(
            pickle.tags.filter((t) => t.startsWith('@jira:')).map((t) => t.slice(6)),
          ),
          status: 'unknown',
          attempts_count: 0,
          flaky: enc.bool(driver, false) as number,
          duration_ms: null,
          error_message: null,
          error_stack: null,
          started_at: tsToIso(tcs.timestamp),
          finished_at: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .execute();
      if (!this.seenScenarios.has(naturalKey)) this.counts.scenarios++;
    }
    this.seenScenarios.add(naturalKey);

    let attemptId: string;
    const existingAttempt = await db
      .selectFrom('scenario_attempts')
      .select(['id'])
      .where('run_id', '=', this.ctx.runId)
      .where('test_case_started_id', '=', tcs.id)
      .executeTakeFirst();
    if (existingAttempt) {
      attemptId = existingAttempt.id;
      await db
        .updateTable('scenario_attempts')
        .set({ started_at: tsToIso(tcs.timestamp), attempt })
        .where('id', '=', attemptId)
        .execute();
    } else {
      attemptId = newId();
      await db
        .insertInto('scenario_attempts')
        .values({
          id: attemptId,
          scenario_id: scenarioId,
          run_id: this.ctx.runId,
          attempt,
          test_case_started_id: tcs.id,
          status: 'unknown',
          duration_ms: null,
          error_message: null,
          error_stack: null,
          will_be_retried: enc.bool(driver, false) as number,
          worker_index: tcs.workerId != null ? Number(tcs.workerId) || null : null,
          started_at: tsToIso(tcs.timestamp),
          finished_at: null,
          created_at: nowIso(),
        })
        .execute();
      this.counts.attempts++;
    }

    const stepIndexByTestStepId = new Map<string, number>();
    for (const ts of testCase.testSteps) {
      if (ts.pickleStepId) {
        const i = pickle.steps.findIndex((s) => s.id === ts.pickleStepId);
        stepIndexByTestStepId.set(ts.id, i);
      } else stepIndexByTestStepId.set(ts.id, -1);
    }
    this.attempts.set(tcs.id, {
      scenarioId,
      attemptId,
      attempt,
      fingerprint: fp,
      slug,
      dir: join(this.ctx.runDir, slug, fp, `r${attempt}`),
      pickle,
      testCaseId: testCase.id,
      stepIndexByTestStepId,
      stepIdByTestStepId: new Map(),
      statuses: [],
      startedAtIso: tsToIso(tcs.timestamp),
      lastStepEndIso: null,
    });
  }

  private async onStepFinished(tsf: any): Promise<void> {
    const a = this.attempts.get(tsf.testCaseStartedId);
    if (!a) return;
    const testCase = this.idx.testCases.get(a.testCaseId);
    const testStep = testCase?.testSteps.find((s) => s.id === tsf.testStepId);
    if (!testStep) return;
    const { db } = this.ctx.adb;
    const result = tsf.testStepResult ?? {};
    const status = cucumberStatus(result.status);
    const message: string | null = result.exception?.message ?? firstLine(result.message) ?? null;
    const stack: string | null = result.exception?.stackTrace ?? result.message ?? null;
    // A failing hook fails the scenario, but a passing one proves nothing: before and after hooks
    // run and pass on a scenario whose steps were all skipped (`@skip:<browser>`), which must stay
    // skipped. Hooks decide the outcome only for a scenario without Gherkin steps.
    if (testStep.pickleStepId || status === 'failed' || a.pickle.steps.length === 0)
      a.statuses.push(status);
    if (status === 'failed' && !a.firstError) a.firstError = { message, stack };
    const startedAt =
      this.pendingStepStart.get(`${tsf.testCaseStartedId}|${tsf.testStepId}`) ?? null;
    const finishedAt = tsToIso(tsf.timestamp);
    a.lastStepEndIso = maxIso(a.lastStepEndIso, finishedAt);
    const durationMs = tsToMs(result.duration);

    let stepIndex = -1;
    let kind: 'step' | 'hook' = 'hook';
    let hookType: 'before' | 'after' | null = null;
    let keyword: string | null = null;
    let text = '';
    let argument: unknown = null;
    let layerHint: 'ui' | 'api' | null = null;
    if (testStep.pickleStepId) {
      kind = 'step';
      stepIndex = a.stepIndexByTestStepId.get(testStep.id) ?? -1;
      const ps = a.pickle.steps.find((s) => s.id === testStep.pickleStepId);
      if (ps) {
        keyword = this.idx.stepKeyword(ps);
        text = ps.text;
        argument = ps.argument ?? null;
        layerHint = /\b(request|response|API|endpoint|JSON)\b/i.test(ps.text)
          ? 'api'
          : /\b(page|click|navigate|see|fill|visible|URL|button|field)\b/i.test(ps.text)
            ? 'ui'
            : null;
      }
    } else if (testStep.hookId) {
      hookType = this.idx.hookType(testStep.hookId);
      text = this.idx.hookName(testStep.hookId);
    }
    if (status === 'failed') {
      const selector = selectorFromError(stack ?? message);
      if (selector) {
        const c = this.locatorCounters.get(selector) ?? { fails: 0, heals: 0, uses: 0 };
        c.fails++;
        c.uses++;
        this.locatorCounters.set(selector, c);
      }
    }

    const existing = await db
      .selectFrom('steps')
      .select(['id'])
      .where('attempt_id', '=', a.attemptId)
      .where('test_step_id', '=', testStep.id)
      .executeTakeFirst();
    const values = {
      step_index: stepIndex,
      kind,
      hook_type: hookType,
      keyword,
      text,
      argument_json: argument ? enc.json(argument) : null,
      status,
      duration_ms: durationMs,
      error_message: message,
      error_stack: stack,
      definition_location: this.idx.definitionLocation(testStep.stepDefinitionIds),
      pickle_step_id: testStep.pickleStepId ?? null,
      layer_hint: layerHint,
      started_at: startedAt,
      finished_at: finishedAt,
    };
    let stepId: string;
    if (existing) {
      stepId = existing.id;
      await db.updateTable('steps').set(values).where('id', '=', stepId).execute();
    } else {
      stepId = newId();
      await db
        .insertInto('steps')
        .values({
          id: stepId,
          attempt_id: a.attemptId,
          scenario_id: a.scenarioId,
          run_id: this.ctx.runId,
          test_step_id: testStep.id,
          api_snapshot_json: null,
          perf_json: null,
          created_at: nowIso(),
          ...values,
        })
        .execute();
      this.counts.steps++;
    }
    a.stepIdByTestStepId.set(testStep.id, stepId);
    // attachments for this step may have arrived before testStepFinished (playwright-bdd emits them in between)
    const key = `${a.attemptId}|${stepIndex}`;
    const pending = this.pendingPayloads.get(key);
    if (pending) {
      this.pendingPayloads.delete(key);
      for (const p of pending) await this.applyStructured(a, stepId, p.parsed, p.json);
    }
  }

  private readonly pendingPayloads = new Map<
    string,
    Array<{ parsed: ParsedAttachment; json: unknown }>
  >();

  /** Apply a structured (JSON) attachment to its step row / heal table. */
  private async applyStructured(
    a: AttemptCtx,
    stepId: string | null,
    parsed: ParsedAttachment,
    json: unknown,
  ): Promise<void> {
    const { db, driver } = this.ctx.adb;
    if (parsed.kind === 'api' && stepId) {
      const existing = await db
        .selectFrom('steps')
        .select(['api_snapshot_json'])
        .where('id', '=', stepId)
        .executeTakeFirst();
      const prev = readJson<Partial<ApiSnapshot>>(existing?.api_snapshot_json);
      await db
        .updateTable('steps')
        .set({
          api_snapshot_json: enc.json(mergeSnapshot(prev, json as any, parsed.part)),
          layer_hint: 'api',
        })
        .where('id', '=', stepId)
        .execute();
    } else if (parsed.kind === 'perf' && stepId) {
      await db
        .updateTable('steps')
        .set({ perf_json: enc.json(json as PerformanceMetrics) })
        .where('id', '=', stepId)
        .execute();
    } else if (parsed.kind === 'heal') {
      const ev = json as HealEvent;
      await insertHealEvent(db, driver, {
        projectId: this.ctx.projectId,
        runId: this.ctx.runId,
        scenarioId: a.scenarioId,
        attemptId: a.attemptId,
        stepId,
        event: { ...ev, fingerprint: ev.fingerprint ?? a.fingerprint, runId: this.ctx.runId },
      });
      this.counts.healEvents++;
      const key = ev.originalSelector ?? 'unknown';
      const c = this.locatorCounters.get(key) ?? { fails: 0, heals: 0, uses: 0 };
      c.heals++;
      c.uses++;
      c.lastStrategy = ev.strategyUsed ?? null;
      c.suggested = ev.healedSelector ?? null;
      this.locatorCounters.set(key, c);
    }
  }

  private async onAttachment(att: any): Promise<void> {
    const a = this.attempts.get(att.testCaseStartedId);
    if (!a) return;
    const { db, driver } = this.ctx.adb;
    const input: AttachmentInput = {
      fileName: att.fileName ?? 'attachment',
      mediaType: att.mediaType ?? 'application/octet-stream',
      body: att.body,
      contentEncoding: att.contentEncoding,
      url: att.url,
    };
    const parsed = parseAttachmentName(input.fileName);
    const stepId = att.testStepId ? (a.stepIdByTestStepId.get(att.testStepId) ?? null) : null;
    const stepIndexFromMsg = att.testStepId
      ? (a.stepIndexByTestStepId.get(att.testStepId) ?? null)
      : null;

    // structured JSON attachments (applied now, or buffered until the step row exists)
    if (
      parsed.kind === 'api' ||
      parsed.kind === 'perf' ||
      parsed.kind === 'heal' ||
      parsed.kind === 'meta'
    ) {
      const json = safeJson(attachmentText(input));
      if (parsed.kind === 'meta' && json) {
        const meta = json as ScenarioMeta;
        if (meta.dir) a.dir = meta.dir;
      } else if (json) {
        const stepIndex = (parsed as { stepIndex: number }).stepIndex;
        const targetStep = await this.stepRowByIndex(a, stepIndex);
        if (targetStep) await this.applyStructured(a, targetStep, parsed, json);
        else {
          const key = `${a.attemptId}|${stepIndex}`;
          const list = this.pendingPayloads.get(key) ?? [];
          list.push({ parsed, json });
          this.pendingPayloads.set(key, list);
        }
      }
    }
    void driver;

    // file artifact (also for json kinds so they are downloadable)
    const file = targetFileFor(parsed, input.fileName, input.mediaType);
    const stored = storeFile(
      this.ctx.artifactsRoot,
      a.dir,
      file,
      attachmentBytes(input),
      input.url,
    );
    if (!stored) return;
    const { kind, phase, stepIndex } = artifactKindFor(parsed, input.mediaType);
    const existing = await db
      .selectFrom('artifacts')
      .select(['id'])
      .where('rel_path', '=', stored.relPath)
      .executeTakeFirst();
    const values = {
      run_id: this.ctx.runId,
      scenario_id: a.scenarioId,
      attempt_id: a.attemptId,
      step_id: stepId,
      step_index: stepIndex ?? stepIndexFromMsg,
      kind,
      phase,
      media_type: input.mediaType,
      file_name: input.fileName,
      size_bytes: stored.sizeBytes,
      sha256: stored.sha256,
      width: stored.width,
      height: stored.height,
      meta_json: enc.json({ original: input.fileName }),
    };
    if (existing) {
      await db.updateTable('artifacts').set(values).where('id', '=', existing.id).execute();
    } else {
      await db
        .insertInto('artifacts')
        .values({ id: newId(), rel_path: stored.relPath, created_at: nowIso(), ...values })
        .execute();
      this.counts.artifacts++;
    }
  }

  private async onAttemptFinished(tcf: any): Promise<void> {
    const a = this.attempts.get(tcf.testCaseStartedId);
    if (!a) return;
    const { db, driver } = this.ctx.adb;
    const status: SuiteStatus = a.statuses.includes('failed')
      ? 'failed'
      : a.statuses.some((s) => s === 'passed')
        ? 'passed'
        : a.statuses.length
          ? 'skipped'
          : 'unknown';
    const finishedAt = tsToIso(tcf.timestamp) ?? a.lastStepEndIso;
    const durationMs =
      a.startedAtIso && finishedAt
        ? Math.max(0, Date.parse(finishedAt) - Date.parse(a.startedAtIso))
        : null;
    await db
      .updateTable('scenario_attempts')
      .set({
        status,
        duration_ms: durationMs,
        error_message: a.firstError?.message ?? null,
        error_stack: a.firstError?.stack ?? null,
        will_be_retried: enc.bool(driver, Boolean(tcf.willBeRetried)) as number,
        finished_at: finishedAt,
      })
      .where('id', '=', a.attemptId)
      .execute();
    this.runFinishedAt = maxIso(this.runFinishedAt, finishedAt);
    this.runStartedAt = minIso(this.runStartedAt, a.startedAtIso);
  }

  private async stepRowByIndex(a: AttemptCtx, stepIndex: number): Promise<string | null> {
    for (const [testStepId, idx] of a.stepIndexByTestStepId) {
      if (idx === stepIndex) {
        const known = a.stepIdByTestStepId.get(testStepId);
        if (known) return known;
        const row = await this.ctx.adb.db
          .selectFrom('steps')
          .select(['id'])
          .where('attempt_id', '=', a.attemptId)
          .where('test_step_id', '=', testStepId)
          .executeTakeFirst();
        return row?.id ?? null;
      }
    }
    return null;
  }
}

function mergeSnapshot(
  prev: Partial<ApiSnapshot> | null,
  part: any,
  which: 'request' | 'response',
): Partial<ApiSnapshot> {
  // An attachment may carry the whole snapshot or just one half.
  if (part && typeof part === 'object' && 'request' in part && 'response' in part)
    return part as ApiSnapshot;
  return {
    ...(prev ?? {}),
    [which]: part,
    startedAt: prev?.startedAt ?? new Date().toISOString(),
  } as Partial<ApiSnapshot>;
}

function safeJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function firstLine(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null;
  return s.split('\n')[0]!.slice(0, 2000);
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function layerFromTags(tags: string[]): 'ui' | 'api' | 'hybrid' | null {
  if (tags.includes('@api')) return 'api';
  if (tags.includes('@hybrid')) return 'hybrid';
  if (tags.includes('@ui')) return 'ui';
  return null;
}

export function suiteFromTags(tags: string[]): string | null {
  return tags.find((t) => ['@smoke', '@regression', '@sanity'].includes(t)) ?? null;
}
