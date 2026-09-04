import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from '../config/resolve.js';

/** Sidecar written next to every HAR: `<name>.har.json`. */
export interface HarSidecar {
  name: string;
  project: string;
  env: string;
  /** glob passed to routeFromHAR (default: all requests) */
  urlGlob?: string;
  recordedAt: string;
  source: 'run' | 'codegen' | 'api';
  scenarios: string[];
  entries?: number;
  note?: string;
}

export interface HarListing {
  env: string;
  name: string;
  file: string;
  apiFile?: string;
  sizeBytes: number;
  sidecar?: HarSidecar;
}

export const HAR_TAG_RE = /^@har:([a-z0-9][a-z0-9._-]*)(?::(strict))?$/i;

export function safeHarName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) throw new Error(`Invalid HAR name "${name}".`);
  return cleaned;
}

export function harDir(config: ResolvedConfig, env = config.env.name): string {
  return join(config.project.root, 'har', env);
}

/** Browser-layer HAR (written by Playwright's routeFromHAR in update mode). */
export function harPath(config: ResolvedConfig, name: string): string {
  return join(harDir(config), `${safeHarName(name)}.har`);
}

/** API-layer HAR (written by the ApiClient recorder; kept separate so Playwright never overwrites it). */
export function apiHarPath(config: ResolvedConfig, name: string): string {
  return join(harDir(config), `${safeHarName(name)}.api.har`);
}

export function sidecarPath(config: ResolvedConfig, name: string): string {
  return join(harDir(config), `${safeHarName(name)}.har.json`);
}

export function readSidecar(config: ResolvedConfig, name: string): HarSidecar | undefined {
  const file = sidecarPath(config, name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as HarSidecar;
  } catch {
    return undefined;
  }
}

export function writeSidecar(config: ResolvedConfig, side: HarSidecar): string {
  mkdirSync(harDir(config), { recursive: true });
  const file = sidecarPath(config, side.name);
  const existing = readSidecar(config, side.name);
  const merged: HarSidecar = {
    ...existing,
    ...side,
    scenarios: [...new Set([...(existing?.scenarios ?? []), ...side.scenarios])],
  };
  writeFileSync(file, JSON.stringify(merged, null, 2));
  return file;
}

export function parseHarTag(tag: string): { name: string; strict: boolean } | undefined {
  const m = HAR_TAG_RE.exec(tag);
  if (!m) return undefined;
  return { name: m[1]!, strict: m[2] === 'strict' };
}

export function findHarTag(tags: readonly string[]): { name: string; strict: boolean } | undefined {
  for (const t of tags) {
    const parsed = parseHarTag(t);
    if (parsed) return parsed;
  }
  return undefined;
}

export function listHars(projectRoot: string, env?: string): HarListing[] {
  const root = join(projectRoot, 'har');
  if (!existsSync(root)) return [];
  const envs = env ? [env] : readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory());
  const out: HarListing[] = [];
  for (const e of envs) {
    const dir = join(root, e);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.har') || f.endsWith('.api.har')) continue;
      const name = f.replace(/\.har$/, '');
      const file = join(dir, f);
      const apiFile = join(dir, `${name}.api.har`);
      const sidecarFile = join(dir, `${name}.har.json`);
      let sidecar: HarSidecar | undefined;
      if (existsSync(sidecarFile)) {
        try {
          sidecar = JSON.parse(readFileSync(sidecarFile, 'utf8')) as HarSidecar;
        } catch {
          sidecar = undefined;
        }
      }
      out.push({
        env: e,
        name,
        file,
        apiFile: existsSync(apiFile) ? apiFile : undefined,
        sizeBytes: statSync(file).size,
        sidecar,
      });
    }
    // API-only HARs
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.api.har')) continue;
      const name = f.replace(/\.api\.har$/, '');
      if (out.some((x) => x.env === e && x.name === name)) continue;
      out.push({
        env: e,
        name,
        file: join(dir, f),
        apiFile: join(dir, f),
        sizeBytes: statSync(join(dir, f)).size,
      });
    }
  }
  return out;
}
