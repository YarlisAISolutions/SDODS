import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { BrowserSchema, type BrowserName } from '@sdods/contracts';
import { SdodsError } from '@sdods/core';
import { createContext } from '../context.js';
import { collect, json, ok, table } from '../ui.js';

type Engine = 'chromium' | 'firefox' | 'webkit';

// Typed against BrowserName (not `string`) so a new browser is a compile error here rather than a
// silent fall-through to chromium.
const ENGINE_OF: Record<BrowserName, Engine> = {
  chromium: 'chromium',
  edge: 'chromium',
  firefox: 'firefox',
  webkit: 'webkit',
  'mobile-chrome': 'chromium',
  'mobile-safari': 'webkit',
};

/**
 * Browsers that are a system install of a branded channel rather than a Playwright download.
 * `playwright install msedge` runs the vendor installer; there is nothing in the browsers cache to
 * find afterwards, which is why these need their own install target and their own detection.
 */
const CHANNEL_OF: Partial<Record<BrowserName, string>> = { edge: 'msedge' };

/** Browsers Playwright downloads, i.e. the ones a bare `browsers list` can expect to be present. */
const DOWNLOADED_BROWSERS = (Object.keys(ENGINE_OF) as BrowserName[]).filter((b) => !CHANNEL_OF[b]);

/**
 * Where the stable Microsoft Edge binary lives, mirroring Playwright's own channel resolution.
 * `playwright-core`'s `executablePath()` cannot answer this: for a channel browser it returns the
 * bundled Chromium path, which exists on nearly every machine and would report Edge as installed
 * when it is not.
 */
function channelExecutable(channel: string): string | null {
  if (channel !== 'msedge') return null;
  if (process.platform === 'darwin')
    return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  if (process.platform === 'linux') return '/opt/microsoft/msedge/msedge';
  if (process.platform === 'win32') {
    const suffix = join('Microsoft', 'Edge', 'Application', 'msedge.exe');
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
    ].filter((r): r is string => Boolean(r));
    for (const root of roots) {
      const candidate = join(root, suffix);
      if (existsSync(candidate)) return candidate;
    }
    return roots.length ? join(roots[0]!, suffix) : null;
  }
  return null;
}

export interface BrowserStatus {
  name: string;
  engine: Engine;
  /** The branded channel this browser launches, when it is not the bundled build. */
  channel: string | null;
  installed: boolean;
  executable: string | null;
  playwrightVersion: string;
}

export async function browserStatuses(
  names: string[] = DOWNLOADED_BROWSERS,
): Promise<BrowserStatus[]> {
  const require = createRequire(import.meta.url);
  let pw: any;
  let version = 'unknown';
  try {
    pw = await import('playwright-core');
    version = (require('playwright-core/package.json') as { version: string }).version;
  } catch {
    return names.map((name) => ({
      name,
      engine: ENGINE_OF[name as BrowserName] ?? 'chromium',
      channel: CHANNEL_OF[name as BrowserName] ?? null,
      installed: false,
      executable: null,
      playwrightVersion: version,
    }));
  }
  return names.map((name) => {
    const engine = ENGINE_OF[name as BrowserName] ?? 'chromium';
    const channel = CHANNEL_OF[name as BrowserName] ?? null;
    let executable: string | null;
    try {
      executable = channel ? channelExecutable(channel) : (pw[engine].executablePath() as string);
    } catch {
      executable = null;
    }
    return {
      name,
      engine,
      channel,
      installed: Boolean(executable && existsSync(executable)),
      executable,
      playwrightVersion: version,
    };
  });
}

/** Install browser engines and channels (used by `browsers install`, `doctor --fix`, `init`). */
export async function installBrowsers(
  opts: { browsers?: string[]; withDeps?: boolean; cwd?: string } = {},
): Promise<void> {
  const names = (opts.browsers?.length ? opts.browsers : DOWNLOADED_BROWSERS) as BrowserName[];
  const engines = [...new Set(names.filter((b) => !CHANNEL_OF[b]).map((b) => ENGINE_OF[b] ?? b))];
  const channels = [...new Set(names.map((b) => CHANNEL_OF[b]).filter((c): c is string => !!c))];
  if (engines.length) {
    const args = ['playwright', 'install', ...(opts.withDeps ? ['--with-deps'] : []), ...engines];
    await execa('npx', args, { stdio: 'inherit', cwd: opts.cwd });
  }
  // Channels are a system install run by the vendor's own installer, so `--with-deps` does not
  // apply and they cannot share the engine invocation.
  for (const channel of channels) {
    await execa('npx', ['playwright', 'install', channel], { stdio: 'inherit', cwd: opts.cwd });
  }
}

/**
 * Opens and closes each browser once.
 *
 * A browser that has never run sets up its profile on first launch, and an automation run started
 * before that finishes dies with "Target page, context or browser has been closed" — seen on a
 * freshly installed Edge, where the first `sdods run -b edge` failed every scenario and the
 * identical rerun passed every one. Anywhere a browser is provisioned and used in the same job,
 * this makes the first run deterministic.
 */
export async function warmupBrowsers(names: string[]): Promise<string[]> {
  const pw = (await import('playwright-core')) as any;
  const warmed: string[] = [];
  for (const name of names) {
    const engine = ENGINE_OF[name as BrowserName] ?? 'chromium';
    const channel = CHANNEL_OF[name as BrowserName];
    const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
    await browser.close();
    warmed.push(name);
  }
  return warmed;
}

export function register(program: Command) {
  const browsers = program.command('browsers').description('Install and list browser engines');

  browsers
    .command('install')
    .description('Install browsers (default: chromium, firefox, webkit)')
    // The positional form reads naturally and is what the docs have always shown, but Commander
    // rejects excess positionals by default, so `browsers install chromium` failed outright.
    .argument('[browsers...]', 'browsers to install, e.g. chromium edge')
    .option('-b, --browser <name>', 'browser to install (repeatable)', collect, [])
    .option('--with-deps', 'also install OS dependencies (Linux CI)')
    .option('-p, --project <slug>', 'install the browsers declared by a project')
    .action(async (positional: string[], opts, cmd) => {
      const ctx = createContext(cmd);
      let list: string[] = [...positional, ...opts.browser];
      if (opts.project) list = ctx.registry.get(opts.project).browsers;
      for (const b of list) BrowserSchema.parse(b);
      await installBrowsers({ browsers: list, withDeps: opts.withDeps, cwd: ctx.rootDir });
      ok(`Installed ${list.length ? list.join(', ') : DOWNLOADED_BROWSERS.join(', ')}`);
    });

  browsers
    .command('warmup')
    .description('Launch each browser once so the first real run is not its first launch')
    .option('-b, --browser <name>', 'browser to warm up (repeatable)', collect, [])
    .option('-p, --project <slug>', 'warm up the browsers declared by a project')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      let list: string[] = opts.browser;
      if (!list.length && opts.project) list = ctx.registry.get(opts.project).browsers;
      if (!list.length) list = [...DOWNLOADED_BROWSERS];
      for (const b of list) BrowserSchema.parse(b);
      const warmed = await warmupBrowsers(list);
      ok(`Warmed up ${warmed.join(', ')}`);
    });

  browsers
    .command('list')
    .description('Show which browsers are installed and where; exits 1 if any is missing')
    .option('-p, --project <slug>', 'limit to the browsers declared by a project')
    .option('-b, --browser <name>', 'limit to one browser (repeatable)', collect, [])
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      // A bare `browsers list` reports the browsers Playwright downloads. Channel browsers are a
      // system install that most machines will not have, and exiting 1 for a missing Edge nobody
      // asked for would turn this into a permanently failing command.
      const names: string[] = opts.browser.length
        ? opts.browser
        : opts.project
          ? ctx.registry.get(opts.project).browsers
          : DOWNLOADED_BROWSERS;
      for (const b of names) BrowserSchema.parse(b);
      const statuses = await browserStatuses(names);
      if (ctx.opts.json) return json(statuses);
      table(
        statuses.map((s) => ({
          browser: s.name,
          engine: s.engine,
          channel: s.channel ?? '',
          installed: s.installed ? pc.green('yes') : pc.red('no'),
          playwright: s.playwrightVersion,
          executable: s.executable ?? '',
        })),
      );
      if (statuses.some((s) => !s.installed)) {
        process.exitCode = 1;
        throw new SdodsError('NOT_SUPPORTED', 'Some browsers are not installed.', {
          hint: 'Run `sdods browsers install --with-deps`.',
          exitCode: 1,
        });
      }
    });
}
