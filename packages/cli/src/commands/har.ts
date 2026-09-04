import { relative } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { collect, json, ok, out, table } from '../ui.js';
import { runCommand, type RunFlags } from './run.js';

function baseRunFlags(over: Partial<RunFlags>): RunFlags {
  return { layer: [], browser: [], module: [], reporter: [], lint: true, trigger: 'cli', ...over };
}

export function register(program: Command) {
  const har = program
    .command('har')
    .description('Record or replay HAR files so runs work offline (browser and API layers)');

  har
    .command('record')
    .description(
      'Run @har scenarios in update mode (writes har/<env>/<name>.har), or record interactively with codegen',
    )
    .option('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment')
    .option(
      '-t, --tags <expr>',
      'tag expression, e.g. "@har:products" (default: every @har scenario)',
    )
    .option('-l, --layer <layer>', 'ui | api | hybrid (repeatable)', collect, [])
    .option('-b, --browser <name>', 'browser (repeatable; default chromium)', collect, [])
    .option('--interactive', 'open codegen with --save-har instead of running scenarios')
    .option('--name <name>', 'HAR name for --interactive')
    .option('--url <route|path|url>', 'start URL for --interactive', '/')
    .option('--har-glob <glob>', 'URL glob to capture', '**/*')
    .action(async (opts, cmd: Command) => {
      const ctx = createContext(cmd);
      if (opts.interactive) {
        if (!opts.name)
          throw new AutomaxError('CONFIG_INVALID', '--interactive needs --name <har-name>.', {
            exitCode: 2,
          });
        const entry = ctx.registry.pick(opts.project);
        const config = ctx.registry.resolve(entry.slug, opts.env);
        const { runCodegen } = await import('@automax/core/recorder');
        const { writeSidecar } = await import('@automax/core/har');
        const res = await runCodegen({
          config,
          name: opts.name,
          url: opts.url,
          saveHar: true,
          harUrlGlob: opts.harGlob,
          outputFile: `${config.runtime.artifactsDir}/../codegen-scratch/${opts.name}.spec.ts`,
        });
        if (!res.harFile)
          throw new AutomaxError('RUN_FAILED', 'Codegen closed without writing a HAR.', {
            exitCode: 1,
          });
        writeSidecar(config, {
          name: opts.name,
          project: entry.slug,
          env: config.env.name,
          urlGlob: opts.harGlob,
          recordedAt: new Date().toISOString(),
          source: 'codegen',
          scenarios: [],
        });
        if (ctx.opts.json) return json({ har: res.harFile });
        return ok(
          `HAR written: ${relative(ctx.rootDir, res.harFile)} — tag scenarios with @har:${opts.name}`,
        );
      }
      const tags = opts.tags ?? '@har:*';
      if (tags === '@har:*') {
        // Cucumber tag expressions have no wildcards: run every ui/hybrid/api scenario in update mode;
        // the hook only records for scenarios that carry a @har:<name> tag.
        out(
          pc.dim(
            'no --tags given: running the project in HAR update mode (only @har-tagged scenarios record)',
          ),
        );
      }
      process.exitCode = await runCommand(
        baseRunFlags({
          project: opts.project,
          env: opts.env,
          tags: tags === '@har:*' ? undefined : tags,
          layer: opts.layer,
          browser: opts.browser.length ? opts.browser : ['chromium'],
          harUpdate: true,
        }),
        cmd,
      );
    });

  har
    .command('replay')
    .description(
      'Run scenarios from their HAR files; --strict aborts any request that is not recorded (offline)',
    )
    .option('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment')
    .option('-t, --tags <expr>', 'tag expression (default: all)')
    .option('-l, --layer <layer>', 'ui | api | hybrid (repeatable)', collect, [])
    .option('-b, --browser <name>', 'browser (repeatable)', collect, [])
    .option('--strict', 'abort requests missing from the HAR and block all other network')
    .option('-w, --workers <n>', 'workers')
    .action(async (opts, cmd: Command) => {
      process.exitCode = await runCommand(
        baseRunFlags({
          project: opts.project,
          env: opts.env,
          tags: opts.tags,
          layer: opts.layer,
          browser: opts.browser,
          harReplay: true,
          strict: Boolean(opts.strict),
          workers: opts.workers ? Number(opts.workers) : undefined,
        }),
        cmd,
      );
    });

  har
    .command('list')
    .description('List HAR files of a project')
    .option('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'only this environment')
    .action(async (opts, cmd: Command) => {
      const ctx = createContext(cmd);
      const entry = ctx.registry.pick(opts.project);
      const { listHars } = await import('@automax/core/har');
      const rows = listHars(entry.root, opts.env).map((h) => ({
        env: h.env,
        name: h.name,
        tag: `@har:${h.name}`,
        size: `${Math.round(h.sizeBytes / 1024)} KB`,
        api: h.apiFile ? 'yes' : '',
        glob: h.sidecar?.urlGlob ?? '',
        recorded: h.sidecar?.recordedAt?.slice(0, 19).replace('T', ' ') ?? '',
        scenarios: h.sidecar?.scenarios?.length ?? 0,
        file: relative(ctx.rootDir, h.file),
      }));
      if (ctx.opts.json) return json(rows);
      table(rows, ['env', 'name', 'tag', 'size', 'api', 'glob', 'recorded', 'scenarios']);
    });
}
