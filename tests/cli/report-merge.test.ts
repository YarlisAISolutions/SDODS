import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
// The repository under test comes from --cwd; an inherited artifacts dir would override it.
const { SDODS_ARTIFACTS_DIR: _a, SDODS_PROJECTS_DIR: _p, ...cleanEnv } = process.env;

describe('sdods report merge', () => {
  it('reads --run, which Commander hands to the parent `report` command', async () => {
    // No runs recorded: without --run there is nothing to merge into.
    const repo = mkdtempSync(join(tmpdir(), 'sdods-report-merge-'));
    writeFileSync(join(repo, 'package.json'), '{}');
    const cli = (...args: string[]) =>
      execa(
        'node',
        ['--import', 'tsx', join(root, 'packages/cli/src/bin.ts'), '--cwd', repo, ...args],
        { cwd: root, reject: false, extendEnv: false, env: { ...cleanEnv, FORCE_COLOR: '0' } },
      );

    const without = await cli('report', 'merge', 'no-such-shards');
    expect(without.exitCode).toBe(2);
    expect(without.stderr).toContain('No run to merge into.');

    // With --run the command gets past choosing the run and checks the shard directories next.
    const withRun = await cli('report', 'merge', 'no-such-shards', '--run', 'run-1');
    expect(withRun.exitCode, withRun.stderr).toBe(2);
    expect(withRun.stderr).not.toContain('No run to merge into.');
    expect(withRun.stderr).toContain('No such shard report directory: no-such-shards');
  }, 60_000);
});
