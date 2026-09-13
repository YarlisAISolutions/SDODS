import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { detectCi } from './secrets.js';
import type { RunRecord } from '@sdods/contracts';
import type {
  CiInfo,
  IntegrationContext,
  IntegrationLogger,
  IssueLinkStore,
  ScenarioSummary,
  ScreenshotRef,
} from './types.js';

export interface CreateContextOptions {
  store: IssueLinkStore;
  logger?: IntegrationLogger;
  publicUrl?: string;
  ci?: CiInfo;
  dryRun?: boolean;
  /** absolute artifacts root (`.sdods/runs`) used to resolve local screenshot files */
  artifactsRoot?: string;
  env?: NodeJS.ProcessEnv;
}

const silentLogger: IntegrationLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

export function createIntegrationContext(opts: CreateContextOptions): IntegrationContext {
  const env = opts.env ?? process.env;
  const publicUrl = (opts.publicUrl ?? env.SDODS_PUBLIC_URL)?.replace(/\/+$/, '');
  const ci = opts.ci ?? detectCi(env);
  const artifactsRoot = opts.artifactsRoot;
  return {
    store: opts.store,
    logger: opts.logger ?? silentLogger,
    publicUrl,
    ci,
    dryRun: opts.dryRun,
    artifactUrl(artifact, run) {
      if (publicUrl) {
        return `${publicUrl}/api/runs/${encodeURIComponent(run.id)}/files/${artifact.relPath.split('/').map(encodeURIComponent).join('/')}`;
      }
      if (ci.artifactUrl) return ci.artifactUrl;
      return null;
    },
    artifactPath(artifact, run) {
      if (artifact.absPath && existsSync(artifact.absPath)) return artifact.absPath;
      const root = run.artifactsDir ?? (artifactsRoot ? join(artifactsRoot, run.id) : undefined);
      if (!root) return null;
      const file = join(root, artifact.relPath);
      return existsSync(file) ? file : null;
    },
  };
}

/**
 * Where a run file lives, for a person reading an issue: relative to the working directory when
 * the run directory is inside it (`.sdods/runs/<id>/runner-output/...`, the layout CI uploads).
 */
export function artifactDisplayPath(
  relPath: string,
  run: Pick<RunRecord, 'id' | 'artifactsDir'>,
): string {
  const file = join(run.artifactsDir ?? run.id, relPath);
  if (!isAbsolute(file)) return file.replace(/\\/g, '/');
  const rel = relative(process.cwd(), file);
  return (rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file).replace(/\\/g, '/');
}

/** Pick the screenshots worth attaching to an issue: failure, scenario end, last before/after pair, diffs. */
export function selectIssueScreenshots(scenario: ScenarioSummary, max = 6): ScreenshotRef[] {
  const shots = scenario.screenshots;
  const byPhase = (p: string) => shots.filter((s) => s.phase === p);
  const picked: ScreenshotRef[] = [];
  const push = (s?: ScreenshotRef) => {
    if (s && !picked.includes(s)) picked.push(s);
  };
  byPhase('failure').forEach(push);
  byPhase('diff').forEach(push);
  byPhase('actual').forEach(push);
  byPhase('expected').forEach(push);
  const steps = shots.filter((s) => s.phase === 'before' || s.phase === 'after');
  const lastIdx = Math.max(-1, ...steps.map((s) => s.stepIndex ?? -1));
  steps.filter((s) => s.stepIndex === lastIdx).forEach(push);
  push(byPhase('scenario-end')[0]);
  push(byPhase('scenario-start')[0]);
  return picked.slice(0, max);
}

export function gherkinBlock(scenario: ScenarioSummary): string {
  const lines = scenario.steps.map((s) => {
    const mark =
      s.status === 'failed' || s.status === 'timedOut'
        ? ' # ← failed'
        : s.status === 'skipped'
          ? ' # skipped'
          : '';
    return `  ${(s.keyword ?? '').trim()} ${s.text}${mark}`.replace(/\s+$/, '');
  });
  return `${scenario.tags.join(' ')}\nScenario: ${scenario.scenarioName}\n${lines.join('\n')}`;
}

export function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}
