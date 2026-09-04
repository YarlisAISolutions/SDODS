import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { ResolvedConfig } from '../config/resolve.js';
import { SdodsError } from '../errors.js';
import { harPath, safeHarName } from '../har/paths.js';

export type CodegenBrowser = 'chromium' | 'firefox' | 'webkit';

export interface CodegenOptions {
  config: ResolvedConfig;
  name: string;
  /** route name from the project yaml, a path, or an absolute URL (default "/") */
  url?: string;
  device?: string;
  browser?: CodegenBrowser;
  /** storageState JSON to load (logged-in pool user) */
  storageStatePath?: string;
  saveHar?: boolean;
  harUrlGlob?: string;
  viewport?: string; // "1280x720"
  lang?: string;
  timezone?: string;
  geolocation?: string; // "lat,lng"
  colorScheme?: 'light' | 'dark';
  ignoreHttpsErrors?: boolean;
  outputFile?: string;
}

export function recordedDir(config: ResolvedConfig): string {
  return join(config.project.root, 'recorded');
}

export function recordedSpecPath(config: ResolvedConfig, name: string): string {
  return join(recordedDir(config), `${safeHarName(name)}.spec.ts`);
}

/** Resolve a route name / path / absolute URL against the environment's UI base URL. */
export function resolveStartUrl(config: ResolvedConfig, url?: string): string {
  const routes = config.project.routes;
  const target = url && routes[url] ? routes[url]! : (url ?? '/');
  if (/^https?:\/\//i.test(target)) return target;
  return new URL(target, config.env.ui.baseUrl).toString();
}

export function buildCodegenArgs(opts: CodegenOptions): {
  args: string[];
  outputFile: string;
  harFile?: string;
} {
  const { config } = opts;
  const outputFile = opts.outputFile ?? recordedSpecPath(config, opts.name);
  const use = config.env.use ?? {};
  const args = ['playwright', 'codegen', '--target', 'playwright-test', '-o', outputFile];
  args.push('--test-id-attribute', config.project.testIdAttribute);
  if (opts.browser && opts.browser !== 'chromium') args.push('-b', opts.browser);
  if (opts.storageStatePath) args.push('--load-storage', opts.storageStatePath);
  if (opts.device) args.push('--device', opts.device);
  if (opts.viewport && !opts.device) args.push('--viewport-size', opts.viewport.replace('x', ','));
  else if (!opts.device) {
    const vp = config.project.screenshots.viewport;
    args.push('--viewport-size', `${vp.width},${vp.height}`);
  }
  const lang = opts.lang ?? use.locale;
  if (lang) args.push('--lang', lang);
  const tz = opts.timezone ?? use.timezoneId;
  if (tz) args.push('--timezone', tz);
  const geo =
    opts.geolocation ??
    (use.geolocation ? `${use.geolocation.latitude},${use.geolocation.longitude}` : undefined);
  if (geo) args.push('--geolocation', geo);
  const scheme =
    opts.colorScheme ?? (use.colorScheme === 'no-preference' ? undefined : use.colorScheme);
  if (scheme) args.push('--color-scheme', scheme);
  if (opts.ignoreHttpsErrors ?? use.ignoreHTTPSErrors) args.push('--ignore-https-errors');
  let harFile: string | undefined;
  if (opts.saveHar) {
    harFile = harPath(config, opts.name);
    args.push('--save-har', harFile, '--save-har-glob', opts.harUrlGlob ?? '**/*');
  }
  args.push(resolveStartUrl(config, opts.url));
  return { args, outputFile, harFile };
}

export interface CodegenResult {
  outputFile: string;
  harFile?: string;
  exitCode: number;
  produced: boolean;
}

/** Spawns `npx playwright codegen` with stdio inherited (the person drives the browser). */
export async function runCodegen(opts: CodegenOptions): Promise<CodegenResult> {
  const { args, outputFile, harFile } = buildCodegenArgs(opts);
  mkdirSync(recordedDir(opts.config), { recursive: true });
  if (harFile) mkdirSync(join(harFile, '..'), { recursive: true });
  const res = await execa('npx', args, {
    cwd: opts.config.runtime.repoRoot,
    stdio: 'inherit',
    reject: false,
    env: { ...process.env, PW_TEST_HTML_REPORT_OPEN: 'never' },
  });
  const exitCode = res.exitCode ?? 1;
  const produced = existsSync(outputFile);
  if (exitCode !== 0 && !produced) {
    throw new SdodsError(
      'RUN_FAILED',
      `playwright codegen exited with code ${exitCode} and produced no spec.`,
      {
        hint: 'Codegen needs a display. On a headless machine, record on your workstation or import an existing spec into recorded/.',
        exitCode: 1,
      },
    );
  }
  return {
    outputFile,
    harFile: harFile && existsSync(harFile) ? harFile : undefined,
    exitCode,
    produced,
  };
}
