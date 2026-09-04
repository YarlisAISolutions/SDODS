import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProjectRegistry } from '@automax/core/config';

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
}

export function loadServerConfig(
  overrides: Partial<ServerConfig> = {},
  env = process.env,
): ServerConfig {
  const rootDir = resolve(
    overrides.rootDir ?? ProjectRegistry.findRepoRoot(env.AUTOMAX_ROOT ?? process.cwd()),
  );
  const webDist =
    overrides.webDist ??
    firstExisting([
      resolve(rootDir, 'packages/web/dist'),
      resolve(rootDir, 'node_modules/@automax/web/dist'),
    ]);
  const traceViewerDir =
    overrides.traceViewerDir ??
    firstExisting([
      resolve(rootDir, 'node_modules/playwright-core/lib/vite/traceViewer'),
      resolve(rootDir, 'node_modules/playwright/node_modules/playwright-core/lib/vite/traceViewer'),
    ]);
  return {
    rootDir,
    host: overrides.host ?? env.HOST ?? '127.0.0.1',
    port: overrides.port ?? Number(env.PORT ?? 4444),
    publicUrl: overrides.publicUrl ?? env.AUTOMAX_PUBLIC_URL,
    sessionSecret:
      overrides.sessionSecret ?? env.SESSION_SECRET ?? 'automax-dev-session-secret-change-me',
    sessionTtlMs: overrides.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000,
    authDisabled: overrides.authDisabled ?? env.AUTH_DISABLED === '1',
    artifactsDir: resolve(
      rootDir,
      overrides.artifactsDir ?? env.AUTOMAX_ARTIFACTS_DIR ?? '.automax/runs',
    ),
    projectsDir: resolve(rootDir, overrides.projectsDir ?? env.AUTOMAX_PROJECTS_DIR ?? 'projects'),
    webDist,
    traceViewerDir,
    maxConcurrentRuns: overrides.maxConcurrentRuns ?? Number(env.AUTOMAX_MAX_CONCURRENT_RUNS ?? 2),
    ingestMaxMb: overrides.ingestMaxMb ?? Number(env.AUTOMAX_INGEST_MAX_MB ?? 512),
    allowedHosts:
      overrides.allowedHosts ??
      (env.AUTOMAX_ALLOWED_HOSTS ? env.AUTOMAX_ALLOWED_HOSTS.split(',') : ['*']),
    cliBin: overrides.cliBin ?? resolve(rootDir, 'packages/cli/src/bin.ts'),
  };
}

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}
