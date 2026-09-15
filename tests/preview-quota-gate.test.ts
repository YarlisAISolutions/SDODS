import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * scripts/preview-quota-gate.sh turns exactly one preview failure into a warning: Firebase refusing
 * a new channel because the site's quota is full. `npx firebase-tools` is stubbed with the answer
 * `hosting:channel:create` gives in each case.
 */

const script = join(import.meta.dirname, '..', 'scripts', 'preview-quota-gate.sh');

function gate(npxStatus: number, npxOutput: string) {
  const bin = mkdtempSync(join(tmpdir(), 'sdods-gate-'));
  const calls = join(bin, 'calls.log');
  writeFileSync(join(bin, 'npx.out'), `${npxOutput}\n`);
  writeFileSync(
    join(bin, 'npx'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${calls}"\ncat "${join(bin, 'npx.out')}"\nexit ${npxStatus}\n`,
  );
  chmodSync(join(bin, 'npx'), 0o755);
  const r = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: bin,
      FIREBASE_SERVICE_ACCOUNT: '{"type":"service_account"}',
      SITE: 'automax-docs',
      CHANNEL: 'pr-172',
    },
  });
  return { ...r, bin, calls: readFileSync(calls, 'utf8') };
}

describe('preview-quota-gate.sh', () => {
  it('passes, with a warning, when the channel quota is full', () => {
    const r = gate(
      1,
      "Error: HTTP Error: 429, Couldn't create channel on `projects/71482759203/sites/automax-docs`: channel quota reached.",
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('::warning::No preview for automax-docs');
    expect(r.calls).toContain(
      'hosting:channel:create pr-172 --site automax-docs --project automax-docs',
    );
  });

  it('fails when the channel already existed, so the quota was not the cause', () => {
    const r = gate(1, 'Error: HTTP Error: 409, Channel pr-172 already exists.');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error::');
  });

  it('fails when there is room for a channel now', () => {
    const r = gate(0, 'Created a new channel: pr-172');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('the channel quota is not full');
  });

  it('removes the service account key it wrote', () => {
    const r = gate(1, 'channel quota reached');
    expect(r.status).toBe(0);
    expect(existsSync(join(r.bin, 'firebase-service-account-gate.json'))).toBe(false);
  });
});
