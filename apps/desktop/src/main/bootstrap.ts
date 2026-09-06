/**
 * First-run install: turn an empty directory into a working SDODS workspace.
 *
 * The exact sequence here was validated end to end by `scripts/probe.ts` before any Electron code
 * existed. The ordering is not arbitrary — see the comments on each step.
 *
 * Every step is idempotent and re-entrant. A user who force-quits during a slow install (Defender
 * scanning ~1200 freshly written files can stretch this to minutes) must be able to relaunch and
 * have it pick up rather than start over or wedge.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runNpm, runSdods, type OnLine } from './proc.js';
import { isBootstrapped, workspacePaths } from './paths.js';

export type Phase =
  'checking' | 'installing-cli' | 'scaffolding' | 'installing-deps' | 'done' | 'failed';

export interface Progress {
  phase: Phase;
  /** Human-readable line for the progress UI. */
  message: string;
  /** Streamed child output, if any. */
  detail?: string;
}

export interface BootstrapOptions {
  workspace: string;
  /** npm spec for the CLI, e.g. 'latest' or '0.2.1'. */
  spec?: string;
  onProgress?: (p: Progress) => void;
}

export class BootstrapError extends Error {
  constructor(
    message: string,
    readonly phase: Phase,
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
 * Run the install. Resolves once the workspace is usable; throws BootstrapError with the captured
 * child output otherwise, so the renderer can show something actionable rather than "it failed".
 */
export async function bootstrap(opts: BootstrapOptions): Promise<void> {
  const { workspace, spec = 'latest' } = opts;
  const report = (phase: Phase, message: string, detail?: string) =>
    opts.onProgress?.({ phase, message, detail });
  /** Forward a child's output lines as progress detail for the given phase. */
  const streamTo =
    (phase: Phase): OnLine =>
    (line) =>
      report(phase, '', line);

  report('checking', 'Checking for an existing installation…');
  if (isBootstrapped(workspace)) {
    report('done', 'Already installed.');
    return;
  }

  const paths = workspacePaths(workspace);
  mkdirSync(workspace, { recursive: true });

  // Step 1 — seed a manifest. `npm install <pkg>` in a bare directory does not reliably leave a
  // usable package.json, and `sdods init` needs somewhere to land.
  if (!existsSync(paths.packageJson)) {
    writeFileSync(
      paths.packageJson,
      JSON.stringify({ name: 'sdods-workspace', private: true, type: 'module' }, null, 2) + '\n',
    );
  }

  // Step 2 — bootstrap install. This exists solely to obtain the `init` command; the fuller
  // dependency set arrives in step 4 from the manifest `init` writes.
  if (!existsSync(paths.cliBin)) {
    report('installing-cli', `Downloading SDODS (@sdods/cli@${spec})…`);
    const res = await runNpm(['install', `@sdods/cli@${spec}`], {
      workspace,
      onLine: streamTo('installing-cli'),
    });
    if (res.code !== 0 || !existsSync(paths.cliBin)) {
      throw new BootstrapError(
        'Could not download SDODS. Check your network connection or proxy settings.',
        'installing-cli',
        tail(res.stderr || res.stdout),
      );
    }
  }

  // Step 3 — scaffold. Flags are all load-bearing:
  //   --force        `init` refuses a non-empty directory, and step 2 just created node_modules.
  //   --no-install   `init --pm` accepts only bun|pnpm, neither of which a user machine has; npm
  //                  is driven directly in step 4 instead.
  //   --no-browsers  browsers are fetched on demand, not during first run.
  // `init` overwrites package.json, which is intended: its manifest is a superset that declares
  // @playwright/test and playwright-bdd. It only writes files, so node_modules survives.
  if (!existsSync(paths.runnerConfig)) {
    report('scaffolding', 'Setting up your workspace…');
    const res = await runSdods(['init', '.', '--force', '--no-install', '--no-browsers'], {
      workspace,
      onLine: streamTo('scaffolding'),
    });
    if (res.code !== 0 || !existsSync(paths.runnerConfig)) {
      throw new BootstrapError(
        'Could not set up the workspace.',
        'scaffolding',
        tail(res.stderr || res.stdout),
      );
    }
  }

  // Step 4 — reconcile against the manifest `init` wrote. Not optional: `sdods run` shells out to
  // `npx bddgen`, and playwright-bdd is not a dependency of @sdods/cli.
  report('installing-deps', 'Installing test dependencies…');
  const deps = await runNpm(['install'], {
    workspace,
    onLine: streamTo('installing-deps'),
  });
  if (deps.code !== 0) {
    throw new BootstrapError(
      'Could not install test dependencies.',
      'installing-deps',
      tail(deps.stderr || deps.stdout),
    );
  }

  writeCliBridgeIfNeeded(workspace);

  if (!isBootstrapped(workspace)) {
    throw new BootstrapError(
      'The workspace looks incomplete after installing.',
      'failed',
      `expected ${paths.cliBin} and ${paths.runnerConfig}`,
    );
  }
  report('done', 'Ready.');
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
    if (!readFileSync(serverConfig, 'utf8').includes("'packages/cli/src/bin.ts'")) return;
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
