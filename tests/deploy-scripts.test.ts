import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const deployDir = join(repoRoot, 'deploy');

describe('deploy scripts', () => {
  it('never put a comment inside a backslash-continued command', () => {
    // A comment line ends the continuation: bash runs the command without the flags after it, then
    // tries to execute the next flag as a command. The Cloud Run deploy shipped a revision without
    // --set-secrets/--set-env-vars that way, and only failed after the traffic had moved.
    for (const file of readdirSync(deployDir).filter((f) => f.endsWith('.sh'))) {
      const lines = readFileSync(join(deployDir, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (i > 0 && lines[i - 1]!.trimEnd().endsWith('\\') && line.trim().startsWith('#')) {
          throw new Error(`${file}:${i + 1} comments inside a continued command`);
        }
      });
    }
  });

  it('passes every flag to gcloud run deploy', () => {
    const bin = mkdtempSync(join(tmpdir(), 'sdods-deploy-'));
    const calls = join(bin, 'calls.log');
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub('gcloud', `printf '%s\\n' "$*" >> "${calls}"; [ "$2" = services ] && echo https://example.run.app; exit 0`);
    stub('curl', 'echo \'{"ok":true}\'');

    execFileSync('bash', [join(deployDir, 'deploy-cloud-run.sh'), 'abc123'], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: 'pipe',
    });

    const deploy = readFileSync(calls, 'utf8').split('\n').find((l) => l.startsWith('run deploy'));
    expect(deploy).toBeDefined();
    expect(deploy).toContain('--image us-central1-docker.pkg.dev/automax-docs/sdods/automax-api:abc123');
    expect(deploy).toContain('--add-cloudsql-instances');
    expect(deploy).toContain('--set-secrets SESSION_SECRET=automax-session-secret:latest');
    expect(deploy).toContain('SDODS_TRUST_PROXY=true');
    expect(deploy).toContain('SDODS_SESSION_COOKIE=__session');
    expect(deploy).toMatch(/--quiet$/);
  });
});
