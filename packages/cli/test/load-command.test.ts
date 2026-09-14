import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const bin = resolve(import.meta.dirname, '..', 'src', 'bin.ts');

function repo(envLoad = '') {
  const root = mkdtempSync(join(tmpdir(), 'sdods-load-cli-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'envs'), { recursive: true });
  mkdirSync(join(proj, 'load'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(proj, 'sdods.project.yaml'),
    'slug: shop\nname: Shop\nlayers: [api]\nenvs: { default: perf, available: [perf] }\n',
  );
  writeFileSync(
    join(proj, 'envs', 'perf.yaml'),
    `ui: { baseUrl: https://perf.example.com }\napi:\n  baseUrl: https://api.perf.example.com\n  auth: { type: bearer, token: '\${API_TOKEN}' }\n${envLoad}`,
  );
  writeFileSync(
    join(proj, 'load', 'browse.yaml'),
    "vus: 5\nduration: 30s\nthresholds: { http_req_duration: ['p(95)<500'] }\nrequests:\n  - path: /posts\n",
  );
  return root;
}

function fakeK6(exit: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-fake-k6-'));
  const file = join(dir, 'k6');
  writeFileSync(
    file,
    `#!/bin/sh\nfor a in "$@"; do [ "$prev" = "--summary-export" ] && s="$a"; prev="$a"; done\nprintf '{"metrics":{"http_reqs":{"count":7}}}' > "$s"\nexit ${exit}\n`,
  );
  chmodSync(file, 0o755);
  return dir;
}

const sdods = (root: string, args: string[], path = process.env.PATH ?? '') =>
  execa(process.execPath, ['--import', 'tsx', bin, '--cwd', root, ...args], {
    reject: false,
    cwd: resolve(import.meta.dirname, '..', '..', '..'),
    env: { ...process.env, PATH: path, API_TOKEN: 'secret-token-value', NO_COLOR: '1' },
  });

describe('sdods load', () => {
  it('--dry-run --json writes the script and reports the refused guard without k6', async () => {
    const root = repo();
    const r = await sdods(root, [
      '--json',
      'load',
      '-p',
      'shop',
      '-e',
      'perf',
      'browse',
      '--dry-run',
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    const res = JSON.parse(r.stdout) as {
      target: string;
      peakVus: number;
      scriptFile: string;
      guardProblems: string[];
    };
    expect(res).toMatchObject({ target: 'https://api.perf.example.com', peakVus: 5 });
    expect(res.guardProblems[0]).toContain('has not opted in');
    const script = readFileSync(res.scriptFile, 'utf8');
    expect(script).toContain('__ENV.API_TOKEN');
    expect(script).not.toContain('secret-token-value');
  });

  it('refuses an environment that has not opted in (exit 2)', async () => {
    const r = await sdods(repo(), ['load', '-p', 'shop', '-e', 'perf', 'browse']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Refusing to run a load test');
  });

  it.skipIf(process.platform === 'win32')(
    'prints target and peak VUs, and exits 1 when k6 reports failed thresholds (99)',
    async () => {
      const root = repo('load: { allowed: true }\n');
      const path = `${fakeK6(99)}${delimiter}${process.env.PATH ?? ''}`;
      const r = await sdods(root, ['load', '-p', 'shop', '-e', 'perf', 'browse'], path);
      expect(r.exitCode, r.stderr).toBe(1);
      expect(r.stdout).toContain('target   https://api.perf.example.com');
      expect(r.stdout).toContain('peak VUs 5');
      expect(r.stderr).toContain('thresholds failed (k6 exit 99)');

      const passPath = `${fakeK6(0)}${delimiter}${process.env.PATH ?? ''}`;
      const ok = await sdods(root, ['load', '-p', 'shop', '-e', 'perf', 'browse'], passPath);
      expect(ok.exitCode, ok.stderr).toBe(0);
      expect(ok.stdout).toContain('thresholds passed');
    },
  );
});
