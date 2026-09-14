import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { parse as parseCsv } from 'csv-parse/sync';
import { parse as parseYaml } from 'yaml';
import {
  parseRunnerProjectName,
  runFiles,
  scenarioFiles,
  type ProjectConfig,
  type RunManifest,
  type ScenarioMeta,
  type SuiteStatus,
  type TraceabilityReport,
  type TraceRequirement,
  type TraceRequirementStatus,
  type TraceResult,
  type TraceRunInfo,
  type TraceScenario,
  type TraceScenarioStatus,
} from '@sdods/contracts';
import { SdodsError } from '../errors.js';
import { parseTagValues } from '../config/tags.js';
import { parseFeatureFile, scenariosOf } from '../lint/gherkin.js';

/**
 * Requirement traceability: `@req:<id>` tags on scenarios → the scenarios' results in one run.
 *
 * Deliberately read-only over files that already exist (feature files, the run directory). The
 * requirement id is opaque — SDODS does not know or decide what it points at — and the sign-off
 * block of the export is left empty for a person to fill in.
 */

export const REQ_TAG = 'req';

export interface RequirementDef {
  id: string;
  title?: string;
}

type Project = ProjectConfig & { root: string };

// ── requirements file ────────────────────────────────────────────────────────

/**
 * Read a requirements file. YAML/JSON accepts a list (`- id: REQ-1` / `title:` or plain strings),
 * a map (`REQ-1: Title`), or either under a top-level `requirements:` key. CSV needs an `id`
 * column and may have a `title` column.
 */
export function loadRequirements(file: string): RequirementDef[] {
  if (!existsSync(file)) {
    throw new SdodsError('CONFIG_NOT_FOUND', `Requirements file not found: ${file}`, {
      hint: 'Fix traceability.requirements in sdods.project.yaml (a path relative to the project root).',
      exitCode: 2,
    });
  }
  const text = readFileSync(file, 'utf8');
  const ext = extname(file).toLowerCase();
  let defs: RequirementDef[];
  try {
    defs = ext === '.csv' ? requirementsFromCsv(text) : requirementsFromData(parseYaml(text));
  } catch (e) {
    if (e instanceof SdodsError) throw e;
    throw new SdodsError(
      'CONFIG_INVALID',
      `Cannot read requirements file ${file}: ${(e as Error).message}`,
      { exitCode: 2 },
    );
  }
  const seen = new Set<string>();
  const out: RequirementDef[] = [];
  for (const d of defs) {
    if (!d.id || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

function requirementsFromCsv(text: string): RequirementDef[] {
  const rows = parseCsv(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Array<Record<string, string>>;
  if (rows.length && !('id' in rows[0]!)) {
    throw new SdodsError('CONFIG_INVALID', 'Requirements CSV has no "id" column.', {
      hint: 'The first row is the header: id,title',
      exitCode: 2,
    });
  }
  return rows.map((r) => ({ id: String(r.id ?? '').trim(), title: r.title || undefined }));
}

function requirementsFromData(data: unknown): RequirementDef[] {
  if (data && typeof data === 'object' && !Array.isArray(data) && 'requirements' in data)
    return requirementsFromData((data as { requirements: unknown }).requirements);
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return { id: String(item) };
      const o = (item ?? {}) as Record<string, unknown>;
      const title = o.title ?? o.name ?? o.summary;
      return { id: String(o.id ?? '').trim(), title: title == null ? undefined : String(title) };
    });
  }
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>).map(([id, v]) => {
      const title =
        v && typeof v === 'object' ? (v as Record<string, unknown>).title : (v ?? undefined);
      return { id, title: title == null ? undefined : String(title) };
    });
  }
  if (data == null) return [];
  throw new SdodsError(
    'CONFIG_INVALID',
    'Requirements file must be a list or a map of requirement ids.',
    { exitCode: 2 },
  );
}

/** The requirements declared by the project, or null when it configures no requirements file. */
export function projectRequirements(project: Project): RequirementDef[] | null {
  const rel = project.traceability?.requirements;
  if (!rel) return null;
  return loadRequirements(join(project.root, rel));
}

export function requirementUrl(project: ProjectConfig, id: string): string | undefined {
  const tpl = project.traceability?.link;
  return tpl ? tpl.replaceAll('{id}', encodeURIComponent(id)) : undefined;
}

// ── scenarios ────────────────────────────────────────────────────────────────

interface StaticScenario {
  feature: string;
  featureName: string;
  line: number;
  name: string;
  tags: string[];
  requirements: string[];
}

function listFeatures(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__screenshots__') walk(p);
      } else if (name.endsWith('.feature')) out.push(p);
    }
  };
  walk(join(root, 'features'));
  return out;
}

/** Every scenario of the project with its effective tags (Feature and Rule tags inherited). */
export function traceScenarios(project: Project, files = listFeatures(project.root)) {
  const out: StaticScenario[] = [];
  for (const file of files) {
    const parsed = parseFeatureFile(file);
    if (parsed.errors.length) continue;
    const feature = relative(project.root, file).replace(/\\/g, '/');
    const featureName = parsed.document.feature?.name ?? '';
    for (const sc of scenariosOf(parsed)) {
      out.push({
        feature,
        featureName,
        line: sc.line,
        name: sc.name,
        tags: sc.tags,
        requirements: [...new Set(parseTagValues(sc.tags, REQ_TAG))],
      });
    }
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature) || a.line - b.line);
}

// ── run results ──────────────────────────────────────────────────────────────

/** One attempt of one scenario in one runner project, as recorded in the run directory. */
export interface RunAttempt {
  runnerProject: string;
  /** feature path as the run recorded it (repo- or project-relative) */
  uri: string;
  /** line of the Scenario / Scenario Outline keyword, when known */
  line?: number;
  name: string;
  exampleIndex: number | null;
  attempt: number;
  status: SuiteStatus;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface RunResults {
  source: TraceRunInfo['resultsSource'];
  attempts: RunAttempt[];
}

const tsToIso = (ts?: { seconds?: number | string; nanos?: number }): string | undefined =>
  ts?.seconds == null
    ? undefined
    : new Date(Number(ts.seconds) * 1000 + Math.floor((ts.nanos ?? 0) / 1e6)).toISOString();

function stepStatus(s: string | undefined): SuiteStatus {
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

/**
 * Read the scenario results of a run directory without a database.
 *
 * Cucumber messages (`messages.ndjson`, or its shard files) are the authoritative record: they hold
 * every attempt in every runner project. The per-scenario `meta.json` files are the fallback — their
 * directory is keyed without the browser, so a multi-browser run keeps only one of them per scenario.
 */
export async function readRunResults(runDir: string): Promise<RunResults> {
  const messageFiles = existsSync(runDir)
    ? readdirSync(runDir)
        .filter((f) => /^messages(\.shard-\d+)?\.ndjson$/.test(f))
        .sort()
    : [];
  if (messageFiles.length) {
    const seen = new Set<string>();
    const attempts: RunAttempt[] = [];
    for (const f of messageFiles) {
      for (const a of await readMessagesFile(join(runDir, f))) {
        const key = `${a.runnerProject}|${a.uri}|${a.line}|${a.exampleIndex}|${a.attempt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        attempts.push(a);
      }
    }
    return { source: 'cucumber-messages', attempts };
  }
  const metas = readScenarioMetas(runDir);
  return metas.length
    ? { source: 'scenario-meta', attempts: metas }
    : { source: 'none', attempts: [] };
}

async function readMessagesFile(file: string): Promise<RunAttempt[]> {
  const scenarioLines = new Map<string, { line: number; name: string }>();
  const exampleRows = new Map<string, number>();
  const pickles = new Map<string, { uri: string; name: string; astNodeIds: string[] }>();
  /** test case id → pickle id, and the ids of its steps that are Gherkin steps (not hooks) */
  const testCases = new Map<string, { pickleId: string; gherkinSteps: Set<string> }>();
  const started = new Map<
    string,
    {
      testCaseId: string;
      attempt: number;
      startedAt?: string;
      statuses: SuiteStatus[];
      error?: string;
    }
  >();
  const out: RunAttempt[] = [];

  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    // Attachments carry base64 bodies (traces, screenshots): by far the largest lines, never needed.
    if (!line || line.startsWith('{"attachment"') || line.startsWith('{"testStepStarted"'))
      continue;
    let env: any;
    try {
      env = JSON.parse(line);
    } catch {
      continue;
    }
    if (env.gherkinDocument) {
      const walk = (children: any[] | undefined) => {
        for (const child of children ?? []) {
          if (child.rule) walk(child.rule.children);
          const sc = child.scenario;
          if (!sc) continue;
          scenarioLines.set(sc.id, { line: sc.location?.line ?? 0, name: sc.name ?? '' });
          let row = 0;
          for (const ex of sc.examples ?? [])
            for (const r of ex.tableBody ?? []) exampleRows.set(r.id, ++row);
        }
      };
      walk(env.gherkinDocument.feature?.children);
    } else if (env.pickle) {
      const p = env.pickle;
      pickles.set(p.id, { uri: p.uri ?? '', name: p.name ?? '', astNodeIds: p.astNodeIds ?? [] });
    } else if (env.testCase) {
      const tc = env.testCase;
      testCases.set(tc.id, {
        pickleId: tc.pickleId,
        gherkinSteps: new Set(
          (tc.testSteps ?? []).filter((x: any) => x.pickleStepId).map((x: any) => x.id),
        ),
      });
    } else if (env.testCaseStarted) {
      const t = env.testCaseStarted;
      started.set(t.id, {
        testCaseId: t.testCaseId,
        attempt: Number(t.attempt ?? 0),
        startedAt: tsToIso(t.timestamp),
        statuses: [],
      });
    } else if (env.testStepFinished) {
      const t = env.testStepFinished;
      const s = started.get(t.testCaseStartedId);
      if (!s) continue;
      const status = stepStatus(t.testStepResult?.status);
      // A failing hook fails the scenario, but a passing one proves nothing: after-hooks run and
      // pass on a scenario whose steps were all skipped (`@skip:<browser>`), which must stay skipped.
      const gherkinStep = testCases.get(s.testCaseId)?.gherkinSteps.has(t.testStepId) ?? true;
      if (status === 'failed' || gherkinStep) s.statuses.push(status);
      if (status === 'failed' && !s.error) {
        const msg: string | undefined =
          t.testStepResult?.exception?.message ?? t.testStepResult?.message;
        if (msg) s.error = String(msg).split('\n')[0]!.slice(0, 500);
      }
    } else if (env.testCaseFinished) {
      const t = env.testCaseFinished;
      const s = started.get(t.testCaseStartedId);
      const pickle = s ? pickles.get(testCases.get(s.testCaseId)?.pickleId ?? '') : undefined;
      if (!s || !pickle) continue;
      const m = /^\[([^\]]+)\]:(.*)$/.exec(pickle.uri);
      const scenario = pickle.astNodeIds.map((id) => scenarioLines.get(id)).find(Boolean);
      const row = pickle.astNodeIds.map((id) => exampleRows.get(id)).find((x) => x != null);
      const finishedAt = tsToIso(t.timestamp);
      out.push({
        runnerProject: m?.[1] ?? 'unknown',
        uri: (m?.[2] ?? pickle.uri).replace(/\\/g, '/'),
        line: scenario?.line,
        name: scenario?.name || pickle.name,
        exampleIndex: row ?? null,
        attempt: s.attempt,
        // The worst step result wins, as in Cucumber: a scenario that called test.skip() part-way
        // has PASSED steps before the SKIPPED ones, and it was skipped, not passed.
        status: s.statuses.includes('failed')
          ? 'failed'
          : s.statuses.includes('skipped')
            ? 'skipped'
            : s.statuses.includes('passed')
              ? 'passed'
              : s.statuses.length
                ? 'skipped'
                : 'unknown',
        durationMs:
          s.startedAt && finishedAt
            ? Math.max(0, Date.parse(finishedAt) - Date.parse(s.startedAt))
            : undefined,
        startedAt: s.startedAt,
        finishedAt,
        error: s.error,
      });
    }
  }
  return out;
}

function readScenarioMetas(runDir: string): RunAttempt[] {
  const out: RunAttempt[] = [];
  if (!existsSync(runDir)) return out;
  for (const slug of readdirSync(runDir)) {
    const slugDir = join(runDir, slug);
    if (!statSync(slugDir).isDirectory()) continue;
    for (const fp of readdirSync(slugDir)) {
      const fpDir = join(slugDir, fp);
      if (!statSync(fpDir).isDirectory()) continue;
      for (const r of readdirSync(fpDir)) {
        if (!/^r\d+$/.test(r)) continue;
        const file = join(fpDir, r, scenarioFiles.meta);
        if (!existsSync(file)) continue;
        let meta: ScenarioMeta;
        try {
          meta = JSON.parse(readFileSync(file, 'utf8')) as ScenarioMeta;
        } catch {
          continue;
        }
        if (!meta.featureUri || !meta.runnerProject) continue;
        out.push({
          runnerProject: meta.runnerProject,
          uri: meta.featureUri,
          line: meta.pickleLine,
          name: meta.scenarioName,
          exampleIndex: meta.exampleIndex ?? null,
          attempt: meta.retry ?? 0,
          status: meta.status ?? 'unknown',
          durationMs: meta.durationMs,
          startedAt: meta.startedAt,
          finishedAt: meta.finishedAt,
          error: meta.errorMessage?.split('\n')[0]?.slice(0, 500),
        });
      }
    }
  }
  return out;
}

// ── run selection ────────────────────────────────────────────────────────────

export function readRunManifest(runDir: string): RunManifest | undefined {
  const file = join(runDir, runFiles.manifest);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RunManifest;
  } catch {
    return undefined;
  }
}

/**
 * The most recent run of `project` (and `env`, when given) under the artifacts root. Runs without a
 * `run.json` are skipped: without it there is no way to tell which project or environment they ran.
 */
export function latestRunFor(
  artifactsRoot: string,
  project: string,
  env?: string,
): { runId: string; dir: string } | null {
  if (!existsSync(artifactsRoot)) return null;
  const candidates: Array<{ runId: string; dir: string; at: number }> = [];
  for (const runId of readdirSync(artifactsRoot)) {
    const dir = join(artifactsRoot, runId);
    if (!statSync(dir).isDirectory()) continue;
    const m = readRunManifest(dir);
    if (!m || m.projectSlug !== project || (env && m.env !== env)) continue;
    const at = Date.parse(m.startedAt ?? '') || statSync(dir).mtimeMs;
    candidates.push({ runId, dir, at });
  }
  candidates.sort((a, b) => b.at - a.at || b.runId.localeCompare(a.runId));
  return candidates[0] ? { runId: candidates[0].runId, dir: candidates[0].dir } : null;
}

// ── report ───────────────────────────────────────────────────────────────────

export interface TraceabilityOptions {
  project: Project;
  /** run directory to read results from; omit for a static requirement → scenario matrix */
  run?: { runId: string; dir: string };
  /** feature files to consider (default: every feature of the project) */
  files?: string[];
  /** clock for `generatedAt` (tests pass a fixed date) */
  now?: Date;
}

function isFailure(s: SuiteStatus) {
  return s === 'failed' || s === 'timedOut' || s === 'interrupted';
}

function collapseAttempts(attempts: RunAttempt[]): TraceResult[] {
  const groups = new Map<string, RunAttempt[]>();
  for (const a of attempts) {
    const key = `${a.runnerProject}|${a.exampleIndex}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  const out: TraceResult[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.attempt - b.attempt);
    const last = list[list.length - 1]!;
    const parts = parseRunnerProjectName(last.runnerProject);
    out.push({
      runnerProject: last.runnerProject,
      ...(parts?.layer ? { layer: parts.layer } : {}),
      ...(parts?.browser ? { browser: parts.browser } : {}),
      exampleIndex: last.exampleIndex,
      status: last.status,
      attempts: list.length,
      flaky: last.status === 'passed' && list.some((a) => isFailure(a.status)),
      ...(last.durationMs != null ? { durationMs: last.durationMs } : {}),
      ...(last.startedAt ? { startedAt: last.startedAt } : {}),
      ...(last.finishedAt ? { finishedAt: last.finishedAt } : {}),
      ...(last.error && isFailure(last.status) ? { error: last.error } : {}),
    });
  }
  return out.sort(
    (a, b) =>
      a.runnerProject.localeCompare(b.runnerProject) ||
      (a.exampleIndex ?? 0) - (b.exampleIndex ?? 0),
  );
}

function scenarioStatus(results: TraceResult[]): TraceScenarioStatus {
  if (!results.length) return 'not-run';
  if (results.some((r) => isFailure(r.status))) return 'failed';
  // A scenario excluded on one engine (`@skip:webkit`) and passing on the others has passed.
  if (results.some((r) => r.status === 'passed')) return 'passed';
  return 'skipped';
}

/**
 * A requirement passes only when every scenario covering it passed in the run. Skipped or missing
 * results verify nothing, so they make it `not-run` rather than `passed`.
 */
function requirementStatus(scenarios: TraceScenario[]): TraceRequirementStatus {
  if (!scenarios.length) return 'not-covered';
  if (scenarios.some((s) => s.status === 'failed')) return 'failed';
  if (scenarios.every((s) => s.status === 'passed')) return 'passed';
  return 'not-run';
}

const byId = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export async function buildTraceabilityReport(
  opts: TraceabilityOptions,
): Promise<TraceabilityReport> {
  const { project } = opts;
  const declared = projectRequirements(project);
  const scenarios = traceScenarios(project, opts.files);
  const results = opts.run ? await readRunResults(opts.run.dir) : null;
  const manifest = opts.run ? readRunManifest(opts.run.dir) : undefined;

  // Index attempts by scenario line; the path is matched by suffix because the messages record it
  // relative to the repository root and meta.json relative to the project root.
  const byLine = new Map<number, RunAttempt[]>();
  const byName = new Map<string, RunAttempt[]>();
  for (const a of results?.attempts ?? []) {
    const parts = parseRunnerProjectName(a.runnerProject);
    if (parts?.project && parts.project !== project.slug) continue;
    if (a.line != null) {
      const list = byLine.get(a.line) ?? [];
      list.push(a);
      byLine.set(a.line, list);
    } else {
      const list = byName.get(a.name) ?? [];
      list.push(a);
      byName.set(a.name, list);
    }
  }
  const samePath = (uri: string, feature: string) => uri === feature || uri.endsWith(`/${feature}`);

  const traced: TraceScenario[] = scenarios.map((sc) => {
    const attempts = [...(byLine.get(sc.line) ?? []), ...(byName.get(sc.name) ?? [])].filter((a) =>
      samePath(a.uri, sc.feature),
    );
    const res = collapseAttempts(attempts);
    return {
      feature: sc.feature,
      featureName: sc.featureName,
      line: sc.line,
      name: sc.name,
      tags: sc.tags,
      requirements: sc.requirements,
      status: scenarioStatus(res),
      results: res,
    };
  });

  const ids = new Map<string, RequirementDef & { declared: boolean | null }>();
  for (const d of declared ?? []) ids.set(d.id, { ...d, declared: true });
  const tagged = [...new Set(traced.flatMap((s) => s.requirements))].sort(byId);
  for (const id of tagged) if (!ids.has(id)) ids.set(id, { id, declared: declared ? false : null });

  const requirements: TraceRequirement[] = [...ids.values()].map((d) => {
    const covering = traced.filter((s) => s.requirements.includes(d.id));
    const url = requirementUrl(project, d.id);
    return {
      id: d.id,
      ...(d.title ? { title: d.title } : {}),
      ...(url ? { url } : {}),
      declared: d.declared,
      status: requirementStatus(covering),
      scenarios: covering,
    };
  });

  const count = (s: TraceRequirementStatus) => requirements.filter((r) => r.status === s).length;
  const untraced = traced.filter((s) => !s.requirements.length);
  const notes: string[] = [];
  if (!opts.run) notes.push('No run selected: every scenario is reported as not run.');
  else if (results?.source === 'none')
    notes.push(`Run ${opts.run.runId} has no scenario results (no messages.ndjson or meta.json).`);
  else if (results?.source === 'scenario-meta')
    notes.push(
      'Results were read from per-scenario meta.json because the run has no messages.ndjson; a run across several browsers may show only one of them per scenario.',
    );
  if (!declared)
    notes.push(
      'No traceability.requirements file is configured: requirements that no scenario covers cannot be listed.',
    );
  notes.push(
    'A requirement passes only when every scenario that covers it passed in this run; skipped or missing results count as not run.',
  );
  notes.push(
    'The sign-off block is filled in by a person. SDODS never writes it: sign-off authority is human.',
  );

  return {
    kind: 'sdods-traceability',
    version: 1,
    project: project.slug,
    projectName: project.name,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    ...(project.traceability?.requirements
      ? { requirementsFile: project.traceability.requirements }
      : {}),
    run: opts.run
      ? {
          id: opts.run.runId,
          env: manifest?.env,
          trigger: manifest?.trigger,
          command: manifest?.command,
          tagsExpr: manifest?.tagsExpr,
          startedAt: manifest?.startedAt,
          finishedAt: manifest?.finishedAt,
          exitCode: manifest?.exitCode,
          git: manifest?.git,
          ci: manifest?.ci,
          sdodsVersion: manifest?.sdodsVersion,
          playwrightVersion: manifest?.playwrightVersion,
          resultsSource: results?.source ?? 'none',
        }
      : null,
    requirements,
    untraced: untraced.map((s) => ({
      feature: s.feature,
      line: s.line,
      name: s.name,
      status: s.status,
    })),
    summary: {
      requirements: requirements.length,
      covered: requirements.filter((r) => r.scenarios.length > 0).length,
      passed: count('passed'),
      failed: count('failed'),
      notRun: count('not-run'),
      notCovered: declared ? count('not-covered') : null,
      undeclared: requirements.filter((r) => r.declared === false).length,
      scenarios: traced.length,
      tracedScenarios: traced.length - untraced.length,
      untracedScenarios: untraced.length,
    },
    signOff: { signedBy: null, role: null, date: null, decision: null, notes: null },
    notes,
  };
}
