import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  runFiles,
  scenarioFiles,
  type RunManifest,
  type RunSummary,
  type ScenarioMeta,
} from '@automax/contracts';

export const RUNS_DIR = '.automax/runs';
export const PROJECTS_DIR = 'projects';
export const PROPOSALS_DIR = 'proposals';

export function runsRoot(rootDir: string): string {
  return resolve(rootDir, process.env.AUTOMAX_ARTIFACTS_DIR ?? RUNS_DIR);
}

export function projectRoot(rootDir: string, slug: string): string {
  const dir = resolve(rootDir, process.env.AUTOMAX_PROJECTS_DIR ?? PROJECTS_DIR, slug);
  if (!existsSync(join(dir, 'automax.project.yaml'))) {
    throw Object.assign(
      new Error(`Unknown project "${slug}" (no automax.project.yaml under ${dir}).`),
      {
        error: { code: 'PROJECT_NOT_FOUND' },
      },
    );
  }
  return dir;
}

export function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function readYaml<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return parseYaml(readFileSync(file, 'utf8')) as T;
}

/** Resolve `rel` inside `base`, refusing traversal outside it. */
export function safeJoin(base: string, rel: string): string {
  const target = resolve(base, rel);
  const relPath = relative(base, target);
  if (relPath.startsWith('..') || relPath.includes(`..${sep}`) || resolve(target) !== target) {
    throw Object.assign(new Error(`Path escapes ${base}: ${rel}`), {
      error: { code: 'INVALID_ARGS' },
    });
  }
  return target;
}

export function walk(dir: string, filter: (file: string) => boolean, max = 5000): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length && out.length < max) {
    const cur = stack.pop()!;
    if (!existsSync(cur)) continue;
    for (const name of readdirSync(cur)) {
      if (name === 'node_modules' || name.startsWith('.') || name === 'dist') continue;
      const full = join(cur, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (filter(full)) out.push(full);
    }
  }
  return out.sort();
}

export interface RunEntry {
  runId: string;
  dir: string;
  manifest?: RunManifest;
  summary?: RunSummary;
  mtime: number;
}

export function listRuns(rootDir: string, limit = 50): RunEntry[] {
  const root = runsRoot(rootDir);
  if (!existsSync(root)) return [];
  const entries: RunEntry[] = [];
  for (const runId of readdirSync(root)) {
    const dir = join(root, runId);
    if (!statSync(dir).isDirectory()) continue;
    entries.push({
      runId,
      dir,
      manifest: readJson<RunManifest>(join(dir, runFiles.manifest)),
      summary: readJson<RunSummary>(join(dir, runFiles.summary)),
      mtime: statSync(dir).mtimeMs,
    });
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries.slice(0, limit);
}

export function getRun(rootDir: string, runId: string): RunEntry | undefined {
  const dir = join(runsRoot(rootDir), runId);
  if (!existsSync(dir)) return undefined;
  return {
    runId,
    dir,
    manifest: readJson<RunManifest>(join(dir, runFiles.manifest)),
    summary: readJson<RunSummary>(join(dir, runFiles.summary)),
    mtime: statSync(dir).mtimeMs,
  };
}

export function lastRun(rootDir: string): RunEntry | undefined {
  return listRuns(rootDir, 1)[0];
}

export interface ScenarioAttemptFiles {
  fingerprint: string;
  retry: number;
  dir: string;
  meta?: ScenarioMeta;
  screenshots: Array<{ file: string; phase: string; stepIndex?: number }>;
  apiSnapshots: Array<{
    file: string;
    stepIndex: number;
    callIndex: number;
    part: 'request' | 'response';
    body?: unknown;
  }>;
  healEvents: unknown[];
}

/** Walk `<runDir>/<slug>/<fingerprint>/r<retry>/` directories. */
export function listScenarioDirs(runDir: string, slug?: string): ScenarioAttemptFiles[] {
  const out: ScenarioAttemptFiles[] = [];
  if (!existsSync(runDir)) return out;
  const slugs = slug
    ? [slug]
    : readdirSync(runDir).filter(
        (n) =>
          !n.startsWith('.') &&
          statSync(join(runDir, n)).isDirectory() &&
          !['playwright-report', 'dashboard', 'pw-output', 'blob-report', 'diff'].includes(n),
      );
  for (const s of slugs) {
    const sDir = join(runDir, s);
    if (!existsSync(sDir)) continue;
    for (const fp of readdirSync(sDir)) {
      const fpDir = join(sDir, fp);
      if (!statSync(fpDir).isDirectory()) continue;
      for (const r of readdirSync(fpDir)) {
        const m = /^r(\d+)$/.exec(r);
        if (!m) continue;
        out.push(readScenarioDir(join(fpDir, r), fp, Number(m[1])));
      }
    }
  }
  return out;
}

export function readScenarioDir(
  dir: string,
  fingerprint: string,
  retry: number,
): ScenarioAttemptFiles {
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const screenshots: ScenarioAttemptFiles['screenshots'] = [];
  for (const f of files) {
    const sc = /^scenario-(start|end|failure)\.png$/.exec(f);
    if (sc) screenshots.push({ file: f, phase: sc[1]! });
    const st = /^(\d{2})-(before|after)\.png$/.exec(f);
    if (st) screenshots.push({ file: f, phase: st[2]!, stepIndex: Number(st[1]) });
  }
  const apiSnapshots: ScenarioAttemptFiles['apiSnapshots'] = [];
  const apiDir = join(dir, 'api');
  if (existsSync(apiDir)) {
    for (const f of readdirSync(apiDir)) {
      const m = /^(\d{2})-(\d+)-(request|response)\.json$/.exec(f);
      if (!m) continue;
      apiSnapshots.push({
        file: `api/${f}`,
        stepIndex: Number(m[1]),
        callIndex: Number(m[2]),
        part: m[3] as 'request' | 'response',
        body: readJson(join(apiDir, f)),
      });
    }
  }
  const healFile = join(dir, scenarioFiles.healLog);
  const healEvents = existsSync(healFile)
    ? readFileSync(healFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return undefined;
          }
        })
        .filter(Boolean)
    : [];
  return {
    fingerprint,
    retry,
    dir,
    meta: readJson<ScenarioMeta>(join(dir, scenarioFiles.meta)),
    screenshots: screenshots.sort((a, b) => (a.stepIndex ?? -1) - (b.stepIndex ?? -1)),
    apiSnapshots: apiSnapshots.sort(
      (a, b) => a.stepIndex - b.stepIndex || a.callIndex - b.callIndex,
    ),
    healEvents,
  };
}

export function screenshotUri(
  runId: string,
  fingerprint: string,
  retry: number,
  file: string,
): string {
  return `automax://screenshot/${runId}/${fingerprint}/${retry}/${file}`;
}
