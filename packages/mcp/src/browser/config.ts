import { join } from 'node:path';
import type { BrowserName } from '@sdods/contracts';
import type { BrowserSessionSpec } from './types.js';

/**
 * Turns a resolved SDODS config into the Playwright MCP child's config file and argv.
 *
 * Pure on purpose: getting this mapping wrong is silent (a session that ignores the project's
 * test-id attribute still works, it just heals nothing and matches the wrong elements), so it is
 * tested without spawning anything.
 */

/** The subset of `sdods config show --json` this needs. */
export interface ResolvedForBrowser {
  project: {
    slug: string;
    testIdAttribute?: string;
    screenshots?: { viewport?: { width: number; height: number } };
    timeouts?: { action?: number; navigation?: number };
  };
  env: {
    name?: string;
    ui?: { baseUrl?: string; allowedOrigins?: string[]; blockedOrigins?: string[] };
    api?: { baseUrl?: string };
    use?: {
      locale?: string;
      timezoneId?: string;
      colorScheme?: string;
      geolocation?: unknown;
      permissions?: string[];
      ignoreHTTPSErrors?: boolean;
      extraHTTPHeaders?: Record<string, string>;
      httpCredentials?: unknown;
    };
  };
  runtime: { repoRoot: string; runId?: string; artifactsDir?: string };
}

export interface SessionLaunch {
  /** Written next to the session's artifacts and passed as `--config`. */
  configFile: Record<string, unknown>;
  argv: string[];
  outputDir: string;
  configPath: string;
}

/**
 * SDODS browser name -> the child's `--browser` value, plus a device for the mobile profiles.
 *
 * `--browser` is always passed. The child defaults to chromium on the `chrome` channel — real
 * Google Chrome — which is not on a CI runner and is not what `-b chromium` means anywhere else
 * in SDODS.
 */
const CHILD_BROWSER: Record<BrowserName, { browser: string; device?: string }> = {
  chromium: { browser: 'chromium' },
  edge: { browser: 'msedge' },
  firefox: { browser: 'firefox' },
  webkit: { browser: 'webkit' },
  'mobile-chrome': { browser: 'chromium', device: 'Pixel 7' },
  'mobile-safari': { browser: 'webkit', device: 'iPhone 15' },
};

function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function originOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function buildSessionLaunch(
  resolved: ResolvedForBrowser,
  spec: BrowserSessionSpec,
  opts: { secretsFile?: string; storageStateFile?: string } = {},
): SessionLaunch {
  const browser = spec.browser ?? 'chromium';
  const child = CHILD_BROWSER[browser];
  const runsDir = resolved.runtime.artifactsDir ?? join(resolved.runtime.repoRoot, '.sdods/runs');
  const outputDir = join(
    runsDir,
    resolved.runtime.runId ?? 'adhoc',
    'browser',
    spec.sessionId.replace(/[^A-Za-z0-9._-]/g, '_'),
  );
  const configPath = join(outputDir, 'mcp.config.json');

  const use = resolved.env.use ?? {};
  const contextOptions = definedOnly({
    storageState: opts.storageStateFile,
    viewport: spec.viewport ?? resolved.project.screenshots?.viewport,
    locale: use.locale,
    timezoneId: use.timezoneId,
    colorScheme: use.colorScheme,
    geolocation: use.geolocation,
    permissions: use.permissions,
    ignoreHTTPSErrors: use.ignoreHTTPSErrors,
    extraHTTPHeaders: use.extraHTTPHeaders,
    httpCredentials: use.httpCredentials,
  });

  // Origins are opt-in. Deriving an allowlist from the app's own baseUrl would block fonts, CDNs,
  // analytics and SSO redirects on any real application — and upstream states the flag is not a
  // security boundary and does not follow redirects, so it must not be sold as one.
  const allowedOrigins = resolved.env.ui?.allowedOrigins
    ?.map((o) => originOf(o) ?? o)
    .filter(Boolean);
  const blockedOrigins = resolved.env.ui?.blockedOrigins;

  const configFile: Record<string, unknown> = definedOnly({
    browser: {
      // Without `isolated`, the child reuses the browser's existing context and every value in
      // contextOptions above is silently discarded — the session would ignore its own storage
      // state, locale, viewport and headers while appearing to work.
      isolated: true,
      contextOptions,
      launchOptions: { headless: !spec.headed },
    },
    testIdAttribute: resolved.project.testIdAttribute,
    outputDir,
    network:
      allowedOrigins?.length || blockedOrigins?.length
        ? definedOnly({ allowedOrigins, blockedOrigins })
        : undefined,
    timeouts: definedOnly({
      action: resolved.project.timeouts?.action,
      navigation: resolved.project.timeouts?.navigation,
    }),
  });

  const argv = ['mcp', '--isolated', '--config', configPath, '--browser', child.browser];
  const device = spec.device ?? child.device;
  if (device) argv.push('--device', device);
  if (!spec.headed) argv.push('--headless');
  if (spec.caps?.length) argv.push('--caps', [...new Set(spec.caps)].join(','));
  if (spec.snapshotMode) argv.push('--snapshot-mode', spec.snapshotMode);
  if (spec.images === 'omit') argv.push('--image-responses', 'omit');
  // A parsed dotenv file, not a path, once the child has it: keeping it on the command line stops
  // secret VALUES being written into the config file under .sdods/runs.
  if (opts.secretsFile) argv.push('--secrets', opts.secretsFile);

  return { configFile, argv, outputDir, configPath };
}
