import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, '..', 'scripts', 'verify-staged-version.mjs');

/** A minimal .publish-stage: core's dist/version.js plus the two manifests the check reads. */
function stage(versionJs: string, core: string, cli: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-stage-'));
  mkdirSync(join(dir, 'core', 'dist'), { recursive: true });
  mkdirSync(join(dir, 'cli'), { recursive: true });
  writeFileSync(
    join(dir, 'core', 'package.json'),
    JSON.stringify({ type: 'module', version: core }),
  );
  writeFileSync(join(dir, 'cli', 'package.json'), JSON.stringify({ version: cli }));
  writeFileSync(join(dir, 'core', 'dist', 'version.js'), versionJs);
  return dir;
}

const run = (dir: string) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

describe('verify-staged-version', () => {
  it('stops the publish that shipped 0.3.2 reporting 0.2.2', () => {
    const r = run(stage(`export const VERSION = '0.2.2';\n`, '0.3.2', '0.3.2'));
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('reports VERSION 0.2.2 but is staged as 0.3.2');
  });

  it('passes the manifest-derived VERSION in src/version.ts', () => {
    const js = `import { createRequire } from 'node:module';\nexport const VERSION = createRequire(import.meta.url)('../package.json').version;\n`;
    const r = run(stage(js, '0.4.0', '0.4.0'));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('catches core and cli staged at different versions', () => {
    const r = run(stage(`export const VERSION = '0.4.0';\n`, '0.4.0', '0.4.1'));
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('does not match @sdods/cli 0.4.1');
  });
});
