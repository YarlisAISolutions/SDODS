import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCliBin } from '../src/config.js';
import { cliCommand } from '../src/services/cli.js';
import type { ServerConfig } from '../src/config.js';

/**
 * The server spawns the CLI to execute a run. It used to point at
 * `<rootDir>/packages/cli/src/bin.ts`, which exists only inside the SDODS checkout, so in a
 * scaffolded workspace every run started from the web UI died in ~100ms with exit 1 — and since
 * exit 1 is also how a normal test failure looks, it was recorded as "failed" with no explanation.
 */
describe('resolveCliBin', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sdods-clibin-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("prefers the workspace's own @sdods/cli", () => {
    const bin = join(root, 'node_modules/@sdods/cli/bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'sdods.js'), '');
    expect(resolveCliBin(root)).toBe(join(bin, 'sdods.js'));
  });

  it('never returns a path that does not exist', () => {
    // An empty workspace has no CLI of its own; whatever comes back must be usable.
    const resolved = resolveCliBin(root);
    expect(resolved.startsWith(root)).toBe(false);
  });

  it('executes a bare command name instead of handing it to node', () => {
    const cfg = { cliBin: 'sdods' } as ServerConfig;
    expect(cliCommand(cfg, ['run'])).toEqual({ cmd: 'sdods', args: ['run'] });
  });

  it('runs a .ts entry point through tsx, and a .js one directly', () => {
    expect(cliCommand({ cliBin: '/x/bin.ts' } as ServerConfig, ['run']).args).toEqual([
      '--import',
      'tsx',
      '/x/bin.ts',
      'run',
    ]);
    expect(cliCommand({ cliBin: '/x/sdods.js' } as ServerConfig, ['run']).args).toEqual([
      '/x/sdods.js',
      'run',
    ]);
  });
});
