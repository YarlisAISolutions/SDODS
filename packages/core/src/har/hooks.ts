import { existsSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import type { ResolvedConfig } from '../config/resolve.js';
import type { ApiClientDeps } from '../api/client.js';
import { Logger } from '../logger.js';
import { makeApiHarHooks, type ApiHarMode } from './api-har.js';
import { apiHarPath, findHarTag, harPath, readSidecar, writeSidecar } from './paths.js';

const log = new Logger('har');

export interface HarHookFixtures {
  $tags: readonly string[];
  page?: Page;
  context?: BrowserContext;
  config: ResolvedConfig;
  /** worker fixture reading SDODS_HAR_MODE / --har-update / --har-replay */
  harMode?: ApiHarMode;
  /** scenario title, for the sidecar */
  title?: string;
}

export interface HarApplied {
  name: string;
  file: string;
  mode: 'update' | 'replay';
  strict: boolean;
  offline: boolean;
}

/** Effective mode: explicit mode wins; otherwise replay when the file exists, else off. */
export function effectiveHarMode(
  config: ResolvedConfig,
  requested: ApiHarMode | undefined,
  file: string,
): ApiHarMode {
  const mode = requested ?? config.runtime.harMode ?? 'off';
  if (mode !== 'off') return mode;
  return existsSync(file) ? 'replay' : 'off';
}

/**
 * Browser layer: for `@har:<name>[:strict]` scenarios, route from the HAR file (record in update
 * mode). With `SDODS_OFFLINE=1` every other request is aborted; the abort route is registered
 * BEFORE routeFromHAR because Playwright matches routes newest-first, so the HAR handler runs first
 * and `notFound: 'fallback'` falls through to the abort.
 */
export async function applyHarToPage(f: HarHookFixtures): Promise<HarApplied | undefined> {
  const tag = findHarTag(f.$tags);
  const offline = Boolean(f.config.runtime.offline);
  if (!f.page || !f.context) return undefined;
  if (offline && !tag) {
    await f.context.route('**/*', (route) => route.abort('blockedbyclient'));
    log.warn('SDODS_OFFLINE=1 but the scenario has no @har tag: all network requests are blocked.');
    return undefined;
  }
  if (!tag) return undefined;
  const file = harPath(f.config, tag.name);
  const mode = effectiveHarMode(f.config, f.harMode, file);
  if (mode === 'off') {
    log.warn(
      `@har:${tag.name} has no recording at ${file}. Run: sdods har record -p ${f.config.project.slug} -e ${f.config.env.name} -t @har:${tag.name}`,
    );
    return undefined;
  }
  const strict = tag.strict || offline;
  if (offline) await f.context.route('**/*', (route) => route.abort('blockedbyclient'));
  const sidecar = readSidecar(f.config, tag.name);
  await f.page.routeFromHAR(file, {
    url: sidecar?.urlGlob ?? '**/*',
    update: mode === 'update',
    updateContent: 'embed',
    updateMode: 'minimal',
    notFound: strict ? 'abort' : 'fallback',
  });
  if (mode === 'update') {
    writeSidecar(f.config, {
      name: tag.name,
      project: f.config.project.slug,
      env: f.config.env.name,
      urlGlob: sidecar?.urlGlob ?? '**/*',
      recordedAt: new Date().toISOString(),
      source: 'run',
      scenarios: f.title ? [f.title] : [],
    });
  }
  log.step(`HAR ${mode}${strict ? ' (strict)' : ''}: ${file}`);
  return { name: tag.name, file, mode, strict, offline };
}

/** API layer: hooks for the ApiClient deps, derived from the scenario tags and the run mode. */
export function apiHarForScenario(f: {
  $tags: readonly string[];
  config: ResolvedConfig;
  harMode?: ApiHarMode;
}): ApiClientDeps['har'] | undefined {
  const tag = findHarTag(f.$tags);
  if (!tag) return undefined;
  const file = apiHarPath(f.config, tag.name);
  const mode = effectiveHarMode(f.config, f.harMode, file);
  if (mode === 'off') return undefined;
  if (mode === 'update') {
    writeSidecar(f.config, {
      name: tag.name,
      project: f.config.project.slug,
      env: f.config.env.name,
      recordedAt: new Date().toISOString(),
      source: 'api',
      scenarios: [],
    });
  }
  return makeApiHarHooks({ mode, file, strict: tag.strict || Boolean(f.config.runtime.offline) });
}

type BeforeFn = (
  options: { tags?: string; name?: string; timeout?: number },
  fn: (fixtures: any) => Promise<void> | void,
) => unknown;

/**
 * Register the browser-layer HAR hook. Tag-filtered to '@ui or @hybrid' so API scenarios never
 * instantiate a page; inside, `$tags` is inspected for `@har:<name>[:strict]`.
 *
 *   const bdd = createBdd(test); registerHarHooks(bdd);
 */
export function registerHarHooks(bdd: { Before: BeforeFn }): void {
  bdd.Before(
    { tags: '@ui or @hybrid', name: 'sdods:har' },
    async ({
      $tags,
      page,
      context,
      config,
      harMode,
      $test,
    }: HarHookFixtures & { $test?: { info?: () => { title?: string } } }) => {
      await applyHarToPage({ $tags, page, context, config, harMode, title: $test?.info?.().title });
    },
  );
}
