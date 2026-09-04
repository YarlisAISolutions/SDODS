import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const bin = join(repoRoot, 'packages', 'cli', 'src', 'bin.ts');

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI from source without depending on execa being hoisted to the repo root. */
function sdods(args: string[], cwd = repoRoot): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('node', ['--import', 'tsx', bin, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ exitCode: code ?? 1, stdout, stderr }));
  });
}

const tmp = mkdtempSync(join(tmpdir(), 'sdods-init-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('sdods init', () => {
  it('scaffolds a linked workspace without the demo and validates it', async () => {
    const dir = join(tmp, 'ws');
    const res = await sdods([
      '--json',
      'init',
      dir,
      '--link',
      '--no-demo',
      '--no-install',
      '--no-browsers',
      '--org',
      'acme',
      '--org-name',
      'Acme Corp',
      '--workspace',
      'web',
    ]);
    expect(res.exitCode, res.stderr).toBe(0);
    const result = JSON.parse(res.stdout) as { files: string[]; demo: boolean; installed: boolean };
    expect(result.demo).toBe(false);
    expect(result.installed).toBe(false);
    for (const f of [
      'package.json',
      'sdods.workspace.yaml',
      'playwright.config.ts',
      'tsconfig.json',
      '.env.example',
      '.gitignore',
      'docker-compose.yml',
      'README.md',
    ]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(existsSync(join(dir, '.claude', 'skills', 'sdods-record', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'projects', 'demo-shop'))).toBe(false);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@sdods/cli']).toMatch(/^link:/);
    const ws = readFileSync(join(dir, 'sdods.workspace.yaml'), 'utf8');
    expect(ws).toContain('slug: acme');
    expect(ws).toContain('name: Acme Corp');
    expect(ws).toContain('defaultWorkspace: web');

    // the scaffold is usable by the CLI itself (no install needed thanks to --cwd)
    const tree = await sdods(['--cwd', dir, '--json', 'workspace', 'tree']);
    expect(tree.exitCode, tree.stderr).toBe(0);
    expect(JSON.parse(tree.stdout).organization.slug).toBe('acme');

    const create = await sdods([
      '--cwd',
      dir,
      '--json',
      'project',
      'create',
      'my-app',
      '--ui-url',
      'http://localhost:3000',
      '--api-url',
      'http://localhost:3000/api',
      '--env',
      'local',
    ]);
    expect(create.exitCode, create.stderr).toBe(0);
    const validate = await sdods(['--cwd', dir, 'config', 'validate']);
    expect(validate.exitCode, validate.stderr).toBe(0);
    expect(validate.stdout).toContain('my-app');
  });

  it('refuses a non-empty directory without --force and rejects bad flags', async () => {
    const dir = join(tmp, 'ws');
    const again = await sdods(['init', dir, '--no-install', '--no-browsers']);
    expect(again.exitCode).toBe(2);
    expect(again.stderr).toContain('not empty');
    const bad = await sdods(['init', join(tmp, 'bad'), '--db', 'mysql', '--no-install']);
    expect(bad.exitCode).toBe(2);
  });

  it('copies the demo project when requested', async () => {
    const dir = join(tmp, 'demo');
    const res = await sdods(['--json', 'init', dir, '--link', '--no-install', '--no-browsers']);
    expect(res.exitCode, res.stderr).toBe(0);
    expect(existsSync(join(dir, 'projects', 'demo-shop', 'sdods.project.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'projects', 'demo-shop', '.env.example'))).toBe(true);
    const list = await sdods(['--cwd', dir, '--json', 'project', 'list']);
    expect(list.exitCode, list.stderr).toBe(0);
    expect(JSON.parse(list.stdout).map((p: { slug: string }) => p.slug)).toContain('demo-shop');
  });
});

describe('sdods completion', () => {
  it('prints zsh, bash and fish scripts that mention the commands', async () => {
    for (const shell of ['zsh', 'bash', 'fish'] as const) {
      const res = await sdods(['completion', shell]);
      expect(res.exitCode, res.stderr).toBe(0);
      expect(res.stdout).toContain('sdods');
      expect(res.stdout).toContain('run');
      expect(res.stdout).toContain('workspace');
      expect(res.stdout).toMatch(/--json|-l json/);
    }
    const zsh = await sdods(['completion', 'zsh']);
    expect(zsh.stdout.startsWith('#compdef sdods')).toBe(true);
    const bad = await sdods(['completion', 'powershell']);
    expect(bad.exitCode).toBe(2);
  });
});

describe('sdods trace / watch / upgrade help', () => {
  it('exposes the documented flags', async () => {
    const trace = await sdods(['trace', '--help']);
    expect(trace.exitCode).toBe(0);
    expect(trace.stdout).toContain('--last');
    expect(trace.stdout).toContain('--run');
    const watch = await sdods(['watch', '--help']);
    expect(watch.stdout).toContain('--no-ui');
    const upgrade = await sdods(['upgrade', '--help']);
    expect(upgrade.stdout).toContain('--apply');
  });

  it('trace reports a clear error when there are no runs', async () => {
    const res = await sdods(['--cwd', join(tmp, 'ws'), 'trace', '--last']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/No runs|not found/);
  });
});
