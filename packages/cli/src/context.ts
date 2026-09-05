import type { Command } from 'commander';
import { ProjectRegistry, setLogJson, setLogLevel } from '@sdods/core';

export interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  cwd?: string;
  color?: boolean;
}

export interface CliContext {
  rootDir: string;
  registry: ProjectRegistry;
  opts: GlobalOptions;
}

export function globalOptions(cmd: Command): GlobalOptions {
  // Commander calls an action with (...positionalArgs, options, command). A callback that forgets
  // the options parameter receives the options object here instead of the Command, and the failure
  // surfaced as an unhelpful "root.opts is not a function".
  if (typeof cmd?.opts !== 'function' || !('parent' in cmd)) {
    throw new Error(
      'createContext expected the Commander Command. An action callback takes ' +
        '(...args, options, command) — the options parameter is probably missing.',
    );
  }
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as GlobalOptions;
}

export function createContext(cmd: Command): CliContext {
  const opts = globalOptions(cmd);
  const rootDir = ProjectRegistry.findRepoRoot(opts.cwd ?? process.cwd());
  if (opts.verbose) setLogLevel('debug');
  else if (opts.quiet) setLogLevel('error');
  if (opts.json) setLogJson(true);
  if (opts.color === false) process.env.NO_COLOR = '1';
  const registry = ProjectRegistry.discover(rootDir);
  return { rootDir, registry, opts };
}
