import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { SdodsError, VERSION } from '@sdods/core';
import { createContext } from '../context.js';
import { json, ok, out, warn } from '../ui.js';

interface RecordFlags {
  project?: string;
  env?: string;
  name?: string;
  url?: string;
  device?: string;
  user?: string;
  browser?: string;
  saveHar?: boolean;
  harGlob?: string;
  viewport?: string;
  postProcess: boolean;
  tag: string[];
}

function addRecordOptions(cmd: Command): Command {
  return cmd
    .option('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment name')
    .option('--name <name>', 'recording name → recorded/<name>.spec.ts (default: rec-<timestamp>)')
    .option(
      '--url <route|path|url>',
      'route name from the project yaml, a path, or an absolute URL',
      '/',
    )
    .option('--device <name>', 'Playwright device, e.g. "iPhone 15"')
    .option('--user <role>', 'use a pool user of this role and start logged in (storageState)')
    .option('-b, --browser <name>', 'chromium | firefox | webkit', 'chromium')
    .option('--save-har', 'also capture network into har/<env>/<name>.har')
    .option('--har-glob <glob>', 'URL glob for --save-har', '**/*')
    .option('--viewport <WxH>', 'viewport, e.g. 1280x720 (ignored with --device)')
    .option(
      '--tag <tag>',
      'extra tag for the recorded spec (repeatable)',
      (v: string, p: string[] = []) => p.concat(v),
      [],
    )
    .option('--no-post-process', 'keep the raw codegen output');
}

async function recordAction(flags: RecordFlags, cmd: Command) {
  const ctx = createContext(cmd);
  const entry = ctx.registry.pick(flags.project);
  const config = ctx.registry.resolve(entry.slug, flags.env);
  const { runCodegen, postProcessRecording } = await import('@sdods/core/recorder');
  const { writeSidecar } = await import('@sdods/core/har');
  const { captureAuth, poolUsers } = await import('@sdods/core/auth/capture');
  const { AuthStateCache } = await import('@sdods/core');

  const name = flags.name ?? `rec-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const browser = (flags.browser ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';

  // logged-in start: make sure the first user of the role has a fresh storage state
  let storageStatePath: string | undefined;
  let userName: string | undefined;
  if (flags.user) {
    const users = await poolUsers(config, flags.user);
    const user = users[0]!;
    userName = user.username;
    const cache = new AuthStateCache(config);
    if (!cache.isFresh(user)) {
      out(pc.dim(`no fresh login state for ${user.username}; capturing…`));
      const res = await captureAuth({ config, role: flags.user, index: 0, browserName: browser });
      if (!res[0]?.file)
        warn(
          `could not capture login state (${res[0]?.skipped ?? 'unknown'}); recording without it`,
        );
    }
    if (cache.isFresh(user)) storageStatePath = cache.fileFor(user);
  }

  out(
    pc.dim(
      `recording ${name} · project ${entry.slug} · env ${config.env.name}${flags.user ? ` · user ${userName} (${flags.user})` : ''}${flags.device ? ` · device ${flags.device}` : ''}`,
    ),
  );
  const result = await runCodegen({
    config,
    name,
    url: flags.url,
    device: flags.device,
    browser,
    storageStatePath,
    saveHar: flags.saveHar,
    harUrlGlob: flags.harGlob,
    viewport: flags.viewport,
  });
  if (!result.produced) {
    throw new SdodsError(
      'RUN_FAILED',
      'Codegen closed without writing a spec (nothing was recorded).',
      {
        exitCode: 1,
      },
    );
  }

  let summary: Record<string, unknown> = {};
  if (flags.postProcess !== false) {
    const source = readFileSync(result.outputFile, 'utf8');
    const processed = postProcessRecording(source, {
      meta: {
        project: entry.slug,
        env: config.env.name,
        name,
        recordedAt: new Date().toISOString(),
        url: flags.url,
        user: userName,
        role: flags.user,
        device: flags.device,
        browser,
        har: result.harFile ? name : undefined,
        sdodsVersion: VERSION,
        playwright: await playwrightVersion(ctx.rootDir),
      },
      baseUrls: [config.env.ui.baseUrl, ...config.env.aliases],
      tags: ['@recorded', '@ui', '@regression', ...flags.tag],
    });
    writeFileSync(result.outputFile, processed.code);
    for (const w of processed.warnings) warn(w);
    summary = {
      fragileLocators: processed.fragileLocators,
      rewrittenUrls: processed.rewrittenUrls,
      wrapped: processed.wrapped,
    };
  }
  if (result.harFile) {
    writeSidecar(config, {
      name,
      project: entry.slug,
      env: config.env.name,
      urlGlob: flags.harGlob ?? '**/*',
      recordedAt: new Date().toISOString(),
      source: 'codegen',
      scenarios: [name],
    });
  }

  const spec = relative(ctx.rootDir, result.outputFile);
  if (ctx.opts.json)
    return json({ name, spec, har: result.harFile, user: userName, role: flags.user, ...summary });
  ok(
    `Recorded ${spec}${result.harFile ? ` (+ HAR ${relative(ctx.rootDir, result.harFile)})` : ''}`,
  );
  if (summary.fragileLocators)
    warn(
      `${summary.fragileLocators} CSS/XPath locator(s) marked // sdods:fragile — prefer role/label/test-id locators.`,
    );
  out(
    pc.dim(
      `play back:  sdods run -p ${entry.slug} -e ${config.env.name} -l recorded --grep "${name}"`,
    ),
  );
  out(pc.dim(`convert:    sdods record convert ${spec}`));
}

export function register(program: Command) {
  const record = addRecordOptions(
    program
      .command('record')
      .description(
        'Record a browser session into a runnable spec under recorded/ (alias: codegen)',
      ),
  );
  record.action(recordAction);

  record
    .command('convert <spec>')
    .description(
      'Ask the generator agent to turn a recorded spec into a feature + steps proposal (reviewed, never auto-applied)',
    )
    .option('--dry-run', 'print the prompt and plan without calling a model')
    .option('--adapter <name>', 'claude | openai | fake')
    .action(async (spec: string, opts: { dryRun?: boolean; adapter?: string }, cmd: Command) => {
      const ctx = createContext(cmd);
      if (!existsSync(spec))
        throw new SdodsError('CONFIG_NOT_FOUND', `Spec not found: ${spec}`, { exitCode: 2 });
      const args = [process.argv[1]!, 'agent', 'generate', '--from-spec', spec];
      if (opts.dryRun) args.push('--dry-run');
      if (opts.adapter) args.push('--adapter', opts.adapter);
      if (ctx.opts.json) args.push('--json');
      const res = await execa(process.execPath, ['--import', 'tsx', ...args], {
        cwd: ctx.rootDir,
        stdio: 'inherit',
        reject: false,
      });
      if (res.exitCode === 2) {
        warn(
          'The agent layer is not available in this build yet; the recording stays runnable under recorded/.',
        );
      }
      process.exitCode = res.exitCode ?? 1;
    });

  const codegen = addRecordOptions(program.command('codegen').description('Alias of record'));
  codegen.action(recordAction);
}

async function playwrightVersion(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa('npx', ['playwright', '--version'], { cwd });
    return stdout.trim().replace(/^Version\s+/i, '');
  } catch {
    return undefined;
  }
}
