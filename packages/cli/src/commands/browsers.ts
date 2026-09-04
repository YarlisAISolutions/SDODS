import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { BrowserSchema } from '@automax/contracts';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { collect, json, ok, table } from '../ui.js';

const ENGINE_OF: Record<string, 'chromium' | 'firefox' | 'webkit'> = {
  chromium: 'chromium',
  firefox: 'firefox',
  webkit: 'webkit',
  'mobile-chrome': 'chromium',
  'mobile-safari': 'webkit',
};

export interface BrowserStatus {
  name: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  installed: boolean;
  executable: string | null;
  playwrightVersion: string;
}

export async function browserStatuses(
  names: string[] = Object.keys(ENGINE_OF),
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
      engine: ENGINE_OF[name] ?? 'chromium',
      installed: false,
      executable: null,
      playwrightVersion: version,
    }));
  }
  return names.map((name) => {
    const engine = ENGINE_OF[name] ?? 'chromium';
    let executable: string | null = null;
    try {
      executable = pw[engine].executablePath() as string;
    } catch {
      executable = null;
    }
    return {
      name,
      engine,
      installed: Boolean(executable && existsSync(executable)),
      executable,
      playwrightVersion: version,
    };
  });
}

/** Install Playwright browser engines (used by `browsers install`, `doctor --fix`, `init`). */
export async function installBrowsers(
  opts: { browsers?: string[]; withDeps?: boolean; cwd?: string } = {},
): Promise<void> {
  const engines = [
    ...new Set(
      (opts.browsers?.length ? opts.browsers : Object.keys(ENGINE_OF)).map(
        (b) => ENGINE_OF[b] ?? b,
      ),
    ),
  ];
  const args = ['playwright', 'install', ...(opts.withDeps ? ['--with-deps'] : []), ...engines];
  await execa('npx', args, { stdio: 'inherit', cwd: opts.cwd });
}

export function register(program: Command) {
  const browsers = program.command('browsers').description('Install and list Playwright browsers');

  browsers
    .command('install')
    .description('Install browser engines (default: chromium, firefox, webkit)')
    .option('-b, --browser <name>', 'browser to install (repeatable)', collect, [])
    .option('--with-deps', 'also install OS dependencies (Linux CI)')
    .option('-p, --project <slug>', 'install the browsers declared by a project')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      let list: string[] = opts.browser;
      if (opts.project) list = ctx.registry.get(opts.project).browsers;
      for (const b of list) BrowserSchema.parse(b);
      await installBrowsers({ browsers: list, withDeps: opts.withDeps, cwd: ctx.rootDir });
      ok(`Installed ${list.length ? list.join(', ') : 'chromium, firefox, webkit'}`);
    });

  browsers
    .command('list')
    .description('Show which browsers are installed and where')
    .option('-p, --project <slug>', 'limit to the browsers declared by a project')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const names = opts.project ? ctx.registry.get(opts.project).browsers : Object.keys(ENGINE_OF);
      const statuses = await browserStatuses(names);
      if (ctx.opts.json) return json(statuses);
      table(
        statuses.map((s) => ({
          browser: s.name,
          engine: s.engine,
          installed: s.installed ? pc.green('yes') : pc.red('no'),
          playwright: s.playwrightVersion,
          executable: s.executable ?? '',
        })),
      );
      if (statuses.some((s) => !s.installed)) {
        process.exitCode = 1;
        throw new AutomaxError('NOT_SUPPORTED', 'Some browsers are not installed.', {
          hint: 'Run `automax browsers install --with-deps`.',
          exitCode: 1,
        });
      }
    });
}
