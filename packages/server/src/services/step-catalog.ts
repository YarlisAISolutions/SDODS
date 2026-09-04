import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { StepDef } from '@automax/contracts';
import type { ServerConfig } from '../config.js';
import { runCliJson } from './cli.js';

interface CacheEntry {
  mtime: number;
  steps: StepDef[];
  at: number;
}

/** Step definitions per project from `automax steps list --json`, cached by the newest mtime under steps/. */
export class StepCatalog {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: ServerConfig) {}

  async list(projectSlug: string, projectRoot: string): Promise<StepDef[]> {
    const mtime = newestMtime(join(projectRoot, 'steps'));
    const hit = this.cache.get(projectSlug);
    if (hit && hit.mtime === mtime && Date.now() - hit.at < 10 * 60_000) return hit.steps;
    const res = await runCliJson<StepDef[] | { steps: StepDef[] }>(this.config, [
      'steps',
      'list',
      '-p',
      projectSlug,
    ]);
    const steps = Array.isArray(res.data) ? res.data : (res.data?.steps ?? []);
    this.cache.set(projectSlug, { mtime, steps, at: Date.now() });
    return steps;
  }

  invalidate(projectSlug?: string) {
    if (projectSlug) this.cache.delete(projectSlug);
    else this.cache.clear();
  }
}

function newestMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else newest = Math.max(newest, st.mtimeMs);
    }
  };
  walk(dir);
  return newest;
}
