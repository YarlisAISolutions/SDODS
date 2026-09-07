/**
 * First-run install: turn an empty directory into a working SDODS workspace.
 *
 * The exact sequence here was validated end to end by `scripts/probe.ts` before any Electron code
 * existed. The ordering is not arbitrary — see the comments on each step.
 *
 * Every step is idempotent and re-entrant. A user who force-quits during a slow install (Defender
 * scanning ~1200 freshly written files can stretch this to minutes) must be able to relaunch and
 * have it pick up rather than start over or wedge.
 *
 * Progress is reported as stages and steps from `shared/stages.ts`, not as raw child output. npm's
 * log is still captured and forwarded as `detail`, but it belongs behind a disclosure: a wall of
 * `npm http fetch` tells someone nothing about whether their install is healthy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runNpm, runSdods, type OnLine } from './proc.js';
import { isBootstrapped, workspacePaths } from './paths.js';
import { EXPECTED_NPM_LINES, percentFor, type Progress, type StageId } from '../shared/stages.js';

export interface BootstrapOptions {
  workspace: string;
  /** npm spec for the CLI, e.g. 'latest' or '0.2.1'. */
  spec?: string;
  onProgress?: (p: Progress) => void;
}

export class BootstrapError extends Error {
  constructor(
    message: string,
    readonly stage: StageId,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export function generateSessionSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Count the package lines npm emits and turn them into movement inside one stage.
 *
 * npm at `--loglevel=info` prints one `npm http fetch` or `npm http cache` line per package, which
 * is the only real signal of progress it offers — there is no total to divide by until it finishes.
 * So the bar approaches the stage ceiling asymptotically and the stage's completion, not the count,
 * is what actually closes it out.
 */
function npmProgress(
  expected: number,
  emit: (fraction: number, packages: number, line: string) => void,
): OnLine {
  let seen = 0;
  return (line) => {
    if (/^npm (http|verb) (fetch|cache)/.test(line)) seen += 1;
    // One event per line carrying both the fraction and the line. Emitting progress and detail
    // separately meant the detail event's fraction overwrote the real one, pinning the bar to the
    // stage floor while the package counter climbed into the hundreds.
    emit(1 - Math.exp(-seen / (expected * 0.45)), seen, line);
  };
}

export async function bootstrap(opts: BootstrapOptions): Promise<void> {
  const { workspace, spec = 'latest' } = opts;
  const paths = workspacePaths(workspace);

  const report = (
    stage: StageId,
    step: string,
    fraction: number,
    message: string,
    detail?: string,
  ) => opts.onProgress?.({ stage, step, percent: percentFor(stage, fraction), message, detail });

  // ── Prepare ─────────────────────────────────────────────────────────────────────────────────
  report('prepare', 'check', 0, 'Looking for an existing installation…');
  if (isBootstrapped(workspace)) {
    report('launch', 'secret', 0, 'Already installed.');
    return;
  }

  report('prepare', 'folder', 0.5, 'Creating your workspace folder…');
  mkdirSync(workspace, { recursive: true });

  // Step 1 — seed a manifest. `npm install <pkg>` in a bare directory does not reliably leave a
  // usable package.json, and `sdods init` needs somewhere to land.
  if (!existsSync(paths.packageJson)) {
    writeFileSync(
      paths.packageJson,
      JSON.stringify({ name: 'sdods-workspace', private: true, type: 'module' }, null, 2) + '\n',
    );
  }

  // ── Download ────────────────────────────────────────────────────────────────────────────────
  // This install exists solely to obtain the `init` command; the fuller dependency set arrives
  // below, from the manifest `init` writes.
  if (!existsSync(paths.cliBin)) {
    report('download', 'resolve', 0, `Resolving @sdods/cli@${spec}…`);
    const res = await runNpm(['install', `@sdods/cli@${spec}`], {
      workspace,
      onLine: npmProgress(EXPECTED_NPM_LINES.cli, (fraction, packages, line) =>
        report('download', 'packages', fraction, `Fetching packages… (${packages})`, line),
      ),
    });
    if (res.code !== 0 || !existsSync(paths.cliBin)) {
      throw new BootstrapError(
        'Could not download SDODS. Check your network connection or proxy settings.',
        'download',
        tail(res.stderr || res.stdout),
      );
    }
  }

  // ── Workspace ───────────────────────────────────────────────────────────────────────────────
  // Flags are all load-bearing:
  //   --force        `init` refuses a non-empty directory, and the install above made node_modules.
  //   --no-install   `init --pm` accepts only bun|pnpm, neither of which a user machine has; npm
  //                  is driven directly below instead.
  //   --no-browsers  browsers are fetched on demand, not during first run.
  // `init` overwrites package.json, which is intended: its manifest is a superset that declares
  // @playwright/test and playwright-bdd. It only writes files, so node_modules survives.
  if (!existsSync(paths.runnerConfig)) {
    report('workspace', 'scaffold', 0, 'Writing project files…');
    const res = await runSdods(['init', '.', '--force', '--no-install', '--no-browsers'], {
      workspace,
      onLine: (line) => report('workspace', 'scaffold', 0.4, '', line),
    });
    if (res.code !== 0 || !existsSync(paths.runnerConfig)) {
      throw new BootstrapError(
        'Could not set up the workspace.',
        'workspace',
        tail(res.stderr || res.stdout),
      );
    }
  }
  report('workspace', 'demo', 0.9, 'Adding the demo project…');

  writeCliBridgeIfNeeded(workspace);

  // ── Dependencies ────────────────────────────────────────────────────────────────────────────
  // Not optional: `sdods run` shells out to `npx bddgen`, and playwright-bdd is not a dependency
  // of @sdods/cli.
  report('dependencies', 'deps', 0, 'Installing the test runner…');
  const deps = await runNpm(['install'], {
    workspace,
    onLine: npmProgress(EXPECTED_NPM_LINES.deps, (fraction, _packages, line) =>
      report('dependencies', 'deps', fraction, 'Installing the test runner…', line),
    ),
  });
  if (deps.code !== 0) {
    throw new BootstrapError(
      'Could not install the test runner.',
      'dependencies',
      tail(deps.stderr || deps.stdout),
    );
  }

  if (!isBootstrapped(workspace)) {
    throw new BootstrapError(
      'The workspace looks incomplete after installing.',
      'dependencies',
      `expected ${paths.cliBin} and ${paths.runnerConfig}`,
    );
  }
}

/**
 * Bridge a hardcoded path in the published server.
 *
 * `@sdods/server@0.2.1` computes the CLI it spawns as
 * `cliBin: resolve(rootDir, 'packages/cli/src/bin.ts')` — a monorepo-only path that cannot exist
 * in an npm-installed workspace. Every run started from the web UI therefore dies with
 * ERR_MODULE_NOT_FOUND before a single test executes.
 *
 * The repo has already replaced that with a multi-candidate `resolveCliBin()` whose first
 * candidate is `<rootDir>/node_modules/@sdods/cli/bin/sdods.js`, but that fix is unreleased. Until
 * it ships, write a two-line module at the path the old server insists on, forwarding to the real
 * CLI. `cliCommand` runs a `.ts` bin through tsx, which the workspace has as a dependency.
 *
 * Written only when the installed server still contains the old string, so it disappears by
 * itself once a fixed version is published — and a fixed server would pick candidate #1 first and
 * never look here anyway.
 */
function writeCliBridgeIfNeeded(workspace: string): void {
  const serverConfig = join(workspace, 'node_modules', '@sdods', 'server', 'dist', 'config.js');
  if (!existsSync(serverConfig)) return;
  try {
    // Detect the *fix*, not the old path. Both versions mention 'packages/cli/src/bin.ts' --
    // 0.2.2 keeps it as resolveCliBin's last fallback candidate -- so testing for that string
    // matched the fixed server too and wrote a pointless bridge into every new workspace.
    // resolveCliBin exists only in servers that already look in node_modules first.
    if (readFileSync(serverConfig, 'utf8').includes('resolveCliBin')) return;
  } catch {
    return;
  }

  const bridgeDir = join(workspace, 'packages', 'cli', 'src');
  const bridge = join(bridgeDir, 'bin.ts');
  if (existsSync(bridge)) return;

  mkdirSync(bridgeDir, { recursive: true });
  writeFileSync(
    bridge,
    [
      '// Generated by the SDODS desktop app — not part of your project.',
      '//',
      '// @sdods/server@0.2.1 spawns the CLI at this exact path, which only exists in the SDODS',
      '// monorepo. This file forwards to the CLI that npm actually installed. It becomes',
      '// unnecessary as soon as a server newer than 0.2.1 is installed, and is safe to delete',
      '// then.',
      "import '../../../node_modules/@sdods/cli/bin/sdods.js';",
      '',
    ].join('\n'),
  );
}

/** npm errors put the useful part last; the first 40 lines are almost always noise. */
function tail(text: string, lines = 25): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}
