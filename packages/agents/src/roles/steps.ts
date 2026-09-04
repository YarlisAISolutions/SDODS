import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { similarity, type ToolContext, type ToolRegistry } from '@sdods/mcp';

/**
 * The project's real step vocabulary, for the system prompt.
 *
 * A model that has not been shown the steps invents them, and an invented step is a scenario that
 * cannot run. Every role prompt says "reuse existing steps", and until now nothing put the steps
 * in front of the model on the agents path — `renderPrompt` accepted them and no caller passed
 * any. Small models need this most, but nothing about it is small-model specific.
 *
 * Producing the list runs `sdods steps list`, which compiles the project and takes seconds, so it
 * is cached against the modification time of the project's `steps/` directory.
 */

export interface StepVocabulary {
  /** Every pattern the project knows. */
  all: string[];
  /** The subset put in the prompt, ranked against the goal when there is one. */
  selected: string[];
  fromCache: boolean;
}

const CACHE_DIR = join('.sdods', 'cache');
const TTL_MS = 10 * 60_000;

export async function stepVocabulary(o: {
  registry: ToolRegistry;
  ctx: ToolContext;
  project?: string;
  /** Goal, plan or spec text: the patterns closest to it go first. */
  focus?: string;
  limit?: number;
}): Promise<StepVocabulary> {
  const empty: StepVocabulary = { all: [], selected: [], fromCache: false };
  if (!o.project || !o.limit) return empty;

  const cached = readCache(o.ctx.rootDir, o.project);
  const all = cached ?? (await listSteps(o.registry, o.ctx, o.project));
  if (!all.length) return empty;
  if (!cached) writeCache(o.ctx.rootDir, o.project, all);

  const selected = o.focus
    ? [...all]
        .map((pattern) => ({ pattern, score: similarity(o.focus!, pattern) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, o.limit)
        .map((s) => s.pattern)
    : all.slice(0, o.limit);
  return { all, selected, fromCache: Boolean(cached) };
}

async function listSteps(
  registry: ToolRegistry,
  ctx: ToolContext,
  project: string,
): Promise<string[]> {
  try {
    const result = await registry.call('step_list', { project }, ctx);
    // The registry wraps a tool's data as `structuredContent.items` for a list.
    const structured = (result as { structuredContent?: { items?: unknown; data?: unknown } })
      .structuredContent;
    const data = structured?.items ?? structured?.data;
    if (!Array.isArray(data)) return [];
    return data
      .map((s) => {
        const step = s as { keyword?: string; pattern?: string };
        return `${step.keyword ?? ''} ${step.pattern ?? ''}`.trim();
      })
      .filter(Boolean);
  } catch {
    // A project that will not compile still deserves a job; the model is simply less grounded.
    return [];
  }
}

function cacheFile(rootDir: string, project: string): string {
  return join(rootDir, CACHE_DIR, `steps-${project}.json`);
}

function readCache(rootDir: string, project: string): string[] | undefined {
  const file = cacheFile(rootDir, project);
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { at: number; steps: string[] };
    if (Date.now() - raw.at > TTL_MS) return undefined;
    const stepsDir = join(rootDir, 'projects', project, 'steps');
    if (existsSync(stepsDir) && statSync(stepsDir).mtimeMs > raw.at) return undefined;
    return raw.steps;
  } catch {
    return undefined;
  }
}

function writeCache(rootDir: string, project: string, steps: string[]): void {
  try {
    mkdirSync(join(rootDir, CACHE_DIR), { recursive: true });
    writeFileSync(cacheFile(rootDir, project), JSON.stringify({ at: Date.now(), steps }));
  } catch {
    /* a cache that cannot be written is not an error */
  }
}
