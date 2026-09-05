import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../..');
const installer = join(repoRoot, 'installer/install.sh');
const psInstaller = join(repoRoot, 'installer/install.ps1');

/** Runs the installer and returns stdout + stderr, the way a user sees it. Throws on non-zero. */
function sh(args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync('sh', [installer, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
    timeout: 120_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    const err = new Error(`installer exited ${r.status}\n${output}`) as Error & { status: number };
    err.status = r.status ?? 1;
    throw err;
  }
  return output;
}

function has(bin: string): boolean {
  try {
    execFileSync('command', ['-v', bin], { shell: '/bin/sh', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Network, git and a publicly cloneable repository are all needed for the real install; skip
 * cleanly without any of them. Probe from a temp directory, never the checkout: CI writes an
 * auth header into the repo-local git config, which would make a private repo look reachable
 * here and then fail inside install.sh, where the clone runs with no credentials.
 */
function online(): boolean {
  try {
    execFileSync(
      'git',
      ['ls-remote', '--exit-code', 'https://github.com/siri1410/SDODS.git', 'HEAD'],
      {
        cwd: tmpdir(),
        stdio: 'ignore',
        timeout: 20_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

const sandboxes: string[] = [];
afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

describe('install.sh', () => {
  it('is valid POSIX sh, bash and zsh', () => {
    for (const shell of ['sh', 'bash', 'zsh']) {
      if (!has(shell)) continue;
      expect(() => execFileSync(shell, ['-n', installer], { stdio: 'pipe' })).not.toThrow();
    }
  });

  it('--help lists every documented flag and exits 0', () => {
    const out = sh(['--help']);
    for (const flag of [
      '--version',
      '--dir',
      '--bin-dir',
      '--pm',
      '--browsers',
      '--workspace',
      '--source',
      '--mcp',
      '--install-node',
      '--modify-path',
      '--yes',
      '--uninstall',
      '--dry-run',
      '--verbose',
      '--version-check',
      '--help',
    ]) {
      expect(out).toContain(flag);
    }
  });

  it('--version-check reports the tools it found', () => {
    const out = sh(['--version-check']);
    expect(out).toMatch(/SDODS installer v\d+\.\d+\.\d+/);
    expect(out).toMatch(/os\s+\w+\/\w+/);
    expect(out).toMatch(/node\s+v?\d+/);
    expect(out).toMatch(/install root/);
  });

  it('rejects unknown flags and bad values with exit code 2', () => {
    for (const args of [
      ['--nope'],
      ['--pm', 'yarn'],
      ['--browsers', 'edge'],
      ['--source', 'ftp'],
    ]) {
      let code = 0;
      try {
        sh(args);
      } catch (e) {
        code = (e as { status: number }).status;
      }
      expect(code, `expected usage error for ${args.join(' ')}`).toBe(2);
    }
  });

  it('--dry-run prints the plan and writes nothing', () => {
    const dir = join(tmpdir(), `sdods-dry-${Date.now()}`);
    const out = sh([
      '--dry-run',
      '--dir',
      dir,
      '--bin-dir',
      `${dir}-bin`,
      '--browsers',
      'chromium',
      '--workspace',
      `${dir}-ws`,
      '--yes',
    ]);
    expect(out).toContain('Dry run');
    expect(out).toMatch(/would run: git clone/);
    expect(out).toMatch(/would install browser engines: chromium/);
    expect(out).toMatch(/would write: .*sdods/);
    expect(out).toMatch(/would run: sdods init/);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(`${dir}-bin`)).toBe(false);
  });

  it('refuses a destructive uninstall with no terminal and no --yes', () => {
    const out = sh(['--uninstall', '--dir', join(tmpdir(), 'sdods-does-not-exist')]);
    expect(out).toContain('Cancelled');
  });

  // The real thing: clone, install dependencies, write the shim, run it, then remove everything.
  it.skipIf(!online())(
    'installs into a sandbox, the shim works, and --uninstall leaves nothing behind',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'sdods-it-'));
      const bin = mkdtempSync(join(tmpdir(), 'sdods-it-bin-'));
      sandboxes.push(home, bin);

      await execFileAsync(
        'sh',
        [
          installer,
          '--dir',
          home,
          '--bin-dir',
          bin,
          '--browsers',
          'none',
          '--pm',
          'bun',
          '--source',
          'git',
          '--version',
          'main',
          '--yes',
        ],
        { env: { ...process.env, NO_COLOR: '1' }, timeout: 900_000, maxBuffer: 64 * 1024 * 1024 },
      );

      const shim = join(bin, 'sdods');
      expect(existsSync(shim), 'shim was written').toBe(true);
      expect(readFileSync(shim, 'utf8')).toContain(home);
      expect(existsSync(join(home, 'app/packages/cli/bin/sdods.js')), 'checkout is complete').toBe(
        true,
      );

      const version = execFileSync(shim, ['--version'], { encoding: 'utf8', timeout: 120_000 });
      expect(version.trim()).toMatch(/^\d+\.\d+\.\d+$/);

      // The demo project is discovered when the CLI runs inside the checkout.
      const projects = execFileSync(shim, ['project', 'list'], {
        encoding: 'utf8',
        cwd: join(home, 'app'),
        timeout: 120_000,
      });
      expect(projects).toContain('demo-shop');

      execFileSync('sh', [installer, '--uninstall', '--dir', home, '--bin-dir', bin, '--yes'], {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 120_000,
      });
      expect(existsSync(home), 'install root removed').toBe(false);
      expect(existsSync(shim), 'shim removed').toBe(false);
    },
    960_000,
  );
});

describe('install.ps1', () => {
  it('declares every documented parameter', () => {
    const src = readFileSync(psInstaller, 'utf8');
    for (const param of [
      '$Version',
      '$Dir',
      '$BinDir',
      '$Pm',
      '$Browsers',
      '$Workspace',
      '$Source',
      '$Mcp',
      '$ModifyPath',
      '$Yes',
      '$Uninstall',
      '$DryRun',
      '$VersionCheck',
      '$Help',
    ]) {
      expect(src).toContain(param);
    }
    expect(src).toContain('Set-StrictMode -Version Latest');
    expect(src).toContain("$ErrorActionPreference = 'Stop'");
    // $Args and $args are automatic variables in PowerShell and must never be parameters.
    expect(src).not.toMatch(/\[string\[\]\]\s*\$Args\b/);
    expect(src).not.toMatch(/^\s*\$args\s*=/m);
  });

  it.skipIf(!has('pwsh'))('parses under pwsh', () => {
    execFileSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `$null = [scriptblock]::Create((Get-Content -Raw '${psInstaller}')); exit 0`,
      ],
      { stdio: 'pipe', timeout: 120_000 },
    );
  });
});

describe('published copies', () => {
  it('sync-installer copies both scripts and their checksums into each site', () => {
    execFileSync('node', ['--import', 'tsx', 'scripts/sync-installer.ts'], {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 120_000,
    });
    for (const site of ['apps/docs/public', 'apps/www/public']) {
      for (const file of ['install.sh', 'install.ps1']) {
        const copy = join(repoRoot, site, file);
        expect(existsSync(copy), `${site}/${file}`).toBe(true);
        expect(readFileSync(copy, 'utf8')).toBe(
          readFileSync(join(repoRoot, 'installer', file), 'utf8'),
        );
        const sum = readFileSync(`${copy}.sha256`, 'utf8');
        expect(sum).toMatch(new RegExp(`^[0-9a-f]{64}  ${file.replace('.', '\\.')}\n$`));
      }
    }
  });
});
