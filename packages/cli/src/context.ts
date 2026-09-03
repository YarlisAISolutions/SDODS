import type { Command } from 'commander';
import { ProjectRegistry, setLogJson, setLogLevel } from '@automax/core';

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
