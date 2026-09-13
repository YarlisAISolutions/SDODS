import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../packages/core/src/version.js';

const repoRoot = join(import.meta.dirname, '..');

const manifest = (pkg: string) =>
  JSON.parse(readFileSync(join(repoRoot, 'packages', pkg, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };

describe('VERSION', () => {
  it('matches the version @sdods/core publishes under', () => {
    expect(VERSION).toBe(manifest('core').version);
  });

  it('matches the CLI, which is the version users install', () => {
    // `sdods init` writes `^${VERSION}` into every scaffolded workspace's package.json. A caret on
    // a 0.x version does not cross the minor, so a VERSION behind the real one pins those
    // workspaces to a CLI that predates the commands the web UI calls -- the failure mode is
    // `unknown command`, not a version warning.
    expect(VERSION).toBe(manifest('cli').version);
  });
});
