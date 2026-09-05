import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRegistry } from '@sdods/core/config';

/**
 * Locate Playwright's bundled trace viewer. Under bun/pnpm layouts `playwright-core` is not
 * hoisted to `<root>/node_modules`, so resolve it through Node's module resolution first and
 * only then fall back to the conventional paths.
 */
export function resolveTraceViewerDir(rootDir: string): string | null {
  const candidates: string[] = [];
  // playwright-core's `exports` map does not expose package.json, so resolve its entry point
  // (`<pkg>/index.js`) and derive the package directory from it. Under bun/pnpm isolated
  // layouts playwright-core is only reachable from the package that depends on it, so also
  // resolve through @playwright/test and playwright.
  const froms: string[] = [resolve(rootDir, 'package.json'), import.meta.url];
  for (const base of [...froms]) {
    for (const pkg of ['@playwright/test', 'playwright']) {
      try {
        froms.push(createRequire(base).resolve(pkg));
      } catch {
        /* not installed from here */
      }
    }
  }
  for (const from of froms) {
    try {
      const req = createRequire(from);
      candidates.push(resolve(dirname(req.resolve('playwright-core')), 'lib/vite/traceViewer'));
    } catch {
      /* not resolvable from here */
    }
    try {
      const req = createRequire(from);
      candidates.push(
        resolve(dirname(req.resolve('playwright-core/package.json')), 'lib/vite/traceViewer'),
      );
    } catch {
      /* exports map may hide package.json */
    }
  }
  candidates.push(
    resolve(rootDir, 'node_modules/playwright-core/lib/vite/traceViewer'),
    resolve(rootDir, 'node_modules/playwright/node_modules/playwright-core/lib/vite/traceViewer'),
  );
  return firstExisting(candidates);
}

export interface ServerConfig {
  rootDir: string;
  host: string;
  port: number;
  publicUrl?: string;
  sessionSecret: string;
  sessionTtlMs: number;
  authDisabled: boolean;
  artifactsDir: string;
  projectsDir: string;
  webDist: string | null;
  traceViewerDir: string | null;
  maxConcurrentRuns: number;
  ingestMaxMb: number;
  allowedHosts: string[];
  cliBin: string;
  /** login attempts per IP per minute (SDODS_LOGIN_RATE_LIMIT; test rigs raise it) */
  loginRateLimit: number;
}

/**
 * The CLI the server spawns to execute a run.
 *
 * This used to be hard-coded to `<rootDir>/packages/cli/src/bin.ts`, a path that exists only
 * inside the SDODS checkout. In a scaffolded workspace it does not, so every run started from the
 * web UI died in ~100ms with exit 1 — and because exit 1 is how a normal test failure looks, it
 * was recorded as a failed run rather than an error.
 *
 * Prefers real .js entry points over `node_modules/.bin` shims, which are .cmd files on Windows
 * and cannot be handed to `node`.
 */
export function resolveCliBin(rootDir: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return (
    firstExisting([
      // the workspace's own dependency — the same CLI `sdods` on the command line would use
      resolve(rootDir, 'node_modules/@sdods/cli/bin/sdods.js'),
      // published install: node_modules/@sdods/server/dist -> node_modules/@sdods/cli
      resolve(here, '..', '..', 'cli', 'bin', 'sdods.js'),
      // source checkout: packages/server/{src,dist} -> packages/cli
      resolve(here, '..', '..', '..', 'cli', 'bin', 'sdods.js'),
      resolve(rootDir, 'packages/cli/bin/sdods.js'),
      resolve(rootDir, 'packages/cli/src/bin.ts'),
    ]) ?? 'sdods'
  );
}

export function loadServerConfig(
  overrides: Partial<ServerConfig> = {},
  env = process.env,
): ServerConfig {
  const rootDir = resolve(
    overrides.rootDir ?? ProjectRegistry.findRepoRoot(env.SDODS_ROOT ?? process.cwd()),
  );
  const webDist =
    overrides.webDist ??
    firstExisting([
      resolve(rootDir, 'packages/web/dist'),
      resolve(rootDir, 'node_modules/@sdods/web/dist'),
      // The sibling package in a source checkout. Ahead of the vendored copy on purpose: running
      // the repo's CLI against a workspace elsewhere sets rootDir to that workspace, so the two
      // rootDir candidates above miss, and a stale vendored copy would otherwise shadow the build
      // you just made.
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist'),
      // Vendored into this package at pack time by scripts/build-publish-assets.ts. Resolved
      // relative to this module, not rootDir: on a registry install the dashboard travels with
      // @sdods/server, because nothing depends on the private, unpublished @sdods/web.
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web'),
    ]);
  const traceViewerDir = overrides.traceViewerDir ?? resolveTraceViewerDir(rootDir);
  return {
    rootDir,
    host: overrides.host ?? env.HOST ?? '127.0.0.1',
    port: overrides.port ?? Number(env.PORT ?? 4444),
    publicUrl: overrides.publicUrl ?? env.SDODS_PUBLIC_URL,
    sessionSecret:
      overrides.sessionSecret ?? env.SESSION_SECRET ?? 'sdods-dev-session-secret-change-me',
    sessionTtlMs: overrides.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000,
    authDisabled: overrides.authDisabled ?? env.AUTH_DISABLED === '1',
    artifactsDir: resolve(
      rootDir,
      overrides.artifactsDir ?? env.SDODS_ARTIFACTS_DIR ?? '.sdods/runs',
    ),
    projectsDir: resolve(rootDir, overrides.projectsDir ?? env.SDODS_PROJECTS_DIR ?? 'projects'),
    webDist,
    traceViewerDir,
    maxConcurrentRuns: overrides.maxConcurrentRuns ?? Number(env.SDODS_MAX_CONCURRENT_RUNS ?? 2),
    ingestMaxMb: overrides.ingestMaxMb ?? Number(env.SDODS_INGEST_MAX_MB ?? 512),
    allowedHosts:
      overrides.allowedHosts ??
      (env.SDODS_ALLOWED_HOSTS ? env.SDODS_ALLOWED_HOSTS.split(',') : ['*']),
    cliBin: overrides.cliBin ?? resolveCliBin(rootDir),
    loginRateLimit: overrides.loginRateLimit ?? Number(env.SDODS_LOGIN_RATE_LIMIT ?? 10),
  };
}

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}
