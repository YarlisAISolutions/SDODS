import { join } from 'node:path';
import type { Command } from 'commander';
import { execa, type ResultPromise } from 'execa';
import pc from 'picocolors';
import { newRunId } from '@sdods/contracts';
import { SdodsError, listGeneratedProjects, normalizeTagExpr } from '@sdods/core';
import { createContext } from '../context.js';
import { collect, out } from '../ui.js';

interface WatchFlags {
  project?: string;
  env?: string;
  tags?: string;
  layer: string[];
  browser: string[];
  headed?: boolean;
  noUi?: boolean;
}

/**
 * `bddgen --watch` regenerates specs when features/steps change while Playwright UI mode
 * re-runs them. Both children share the same SDODS_* environment that `sdods run` uses.
 */
export function register(program: Command) {
  program
    .command('watch')
    .description(
      'bddgen --watch + Playwright UI mode for a project (hot reload of features and steps)',
    )
    .option('-p, --project <slug>', 'project slug (default: the only project)')
    .option('-e, --env <name>', 'environment name')
    .option('-t, --tags <expr>', 'Cucumber tag expression')
    .option('-l, --layer <layer>', 'ui | api | hybrid | recorded (repeatable)', collect, [])
    .option('-b, --browser <name>', 'browser (repeatable)', collect, [])
    .option('--headed', 'headed Playwright (only meaningful with --no-ui)')
    .option('--no-ui', 'run `playwright test --watch` instead of UI mode')
    .action(async (flags: WatchFlags, cmd: Command) => {
      const ctx = createContext(cmd);
      const entry = ctx.registry.pick(flags.project);
      const cfg = ctx.registry.resolve(entry.slug, flags.env, { runId: newRunId() });
      const tags = normalizeTagExpr(flags.tags);
      for (const l of flags.layer) {
        if (!entry.config.layers.includes(l as (typeof entry.config.layers)[number])) {
          throw new SdodsError('CONFIG_INVALID', `Layer "${l}" is not enabled for ${entry.slug}.`, {
            exitCode: 2,
          });
        }
      }
      const selection = {
        project: entry.slug,
        env: cfg.env.name,
        layers: flags.layer.length ? flags.layer : undefined,
        browsers: flags.browser.length ? flags.browser : undefined,
        tags,
        runId: cfg.runtime.runId,
      };
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        SDODS_ROOT: ctx.rootDir,
        SDODS_PROJECT: entry.slug,
        SDODS_ENV: cfg.env.name,
        SDODS_TAGS: tags ?? '',
        SDODS_LAYERS: selection.layers?.join(',') ?? '',
        SDODS_BROWSERS: selection.browsers?.join(',') ?? '',
        SDODS_RUN_ID: cfg.runtime.runId,
        SDODS_REPORTER_MODE: 'quiet',
      };
      const configPath = join(ctx.rootDir, 'playwright.config.ts');
      const names = listGeneratedProjects(ctx.registry, selection).map((p) => p.name);
      if (!names.length) {
        throw new SdodsError(
          'CONFIG_INVALID',
          'Nothing to watch: no Playwright projects match the selection.',
          {
            hint: 'Check --layer/--browser against the project yaml.',
            exitCode: 2,
          },
        );
      }

      out(pc.cyan(`Watching ${entry.slug} (${cfg.env.name}) → ${names.join(', ')}`));
      const children: ResultPromise[] = [];
      const stop = () => {
        for (const c of children) c.kill('SIGTERM');
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);

      // initial generation so UI mode has specs to show
      const gen = await execa('npx', ['bddgen', '-c', configPath], {
        cwd: ctx.rootDir,
        env: childEnv,
        stdio: 'inherit',
        reject: false,
      });
      if (gen.exitCode !== 0) {
        throw new SdodsError('RUN_FAILED', 'bddgen failed; fix the errors above and retry.', {
          exitCode: 1,
        });
      }

      const watcher = execa('npx', ['bddgen', '-c', configPath, '--watch'], {
        cwd: ctx.rootDir,
        env: childEnv,
        stdio: 'inherit',
        reject: false,
      });
      children.push(watcher);

      const pwArgs = [
        'playwright',
        'test',
        '-c',
        configPath,
        ...names.flatMap((n) => ['--project', n]),
      ];
      if (flags.noUi) {
        pwArgs.push('--watch');
        if (flags.headed) pwArgs.push('--headed');
      } else {
        pwArgs.push('--ui');
      }
      const pw = execa('npx', pwArgs, {
        cwd: ctx.rootDir,
        env: childEnv,
        stdio: 'inherit',
        reject: false,
      });
      children.push(pw);

      const res = await pw;
      stop();
      process.exitCode = res.exitCode ?? 0;
    });
}
