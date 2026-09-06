/**
 * Phase 0 probe — prove the desktop bootstrap contract with plain Node, no Electron.
 *
 * The desktop app will drive the published `@sdods/cli` from a bundled Node runtime. Everything
 * that can go wrong in that sequence (npm resolution, `init` refusing a non-empty directory,
 * native modules with no prebuild for this platform, the server never becoming healthy, the setup
 * token not being parseable) is far cheaper to diagnose here than inside a packaged app.
 *
 * Run:  node --import tsx apps/desktop/scripts/probe.ts [--keep] [--dir <path>] [--version <spec>]
 *
 * Exit 0 = the contract holds on this platform/arch.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const KEEP = args.includes('--keep');
const SPEC = flag('--version') ?? 'latest';
const WORKSPACE = flag('--dir') ?? mkdtempSync(join(tmpdir(), 'sdods-probe-'));

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m' };

// The desktop app resolves npm's own entry point rather than spawning `npm` by bare name:
// Windows has no `npm` executable on PATH, only `npm.cmd`, and GUI apps inherit a minimal PATH.
const NPM_CLI = join(
  process.execPath,
  '..',
  '..',
  'lib',
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);
const CLI_BIN = join(WORKSPACE, 'node_modules', '@sdods', 'cli', 'bin', 'sdods.js');

let step = 0;
const steps: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = '') {
  steps.push({ name, ok, detail });
  const mark = ok ? `${C.green}ok${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function heading(text: string) {
  console.log(`\n${C.cyan}==>${C.reset} ${++step}. ${text}`);
}

/** Run a command to completion, capturing output rather than streaming it. */
function run(
  cmd: string,
  argv: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      cwd: opts.cwd ?? WORKSPACE,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 600_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + String(e) });
    });
  });
}

const npm = (argv: string[]) =>
  run(process.execPath, [NPM_CLI, ...argv, '--no-audit', '--no-fund'], {
    env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

async function main() {
  console.log(`workspace: ${WORKSPACE}`);
  console.log(`node:      ${process.version} (${process.platform}-${process.arch})`);
  console.log(`spec:      @sdods/cli@${SPEC}`);

  heading('seed an empty workspace');
  mkdirSync(WORKSPACE, { recursive: true });
  // Do not rely on `npm install <pkg>` inventing a manifest; write a minimal one first.
  writeFileSync(
    join(WORKSPACE, 'package.json'),
    JSON.stringify({ name: 'sdods-workspace', private: true, type: 'module' }, null, 2) + '\n',
  );
  record('package.json seeded', existsSync(join(WORKSPACE, 'package.json')));

  heading(`npm install @sdods/cli@${SPEC} — the bootstrap that gives us \`init\``);
  const boot = await npm(['install', `@sdods/cli@${SPEC}`]);
  record('bootstrap install', boot.code === 0, boot.code === 0 ? '' : boot.stderr.slice(-600));
  if (boot.code !== 0) return finish();
  record('CLI bin present', existsSync(CLI_BIN), CLI_BIN);

  // The reason this probe exists: argon2 ships no prebuild for darwin-x64 or win32-arm64 and
  // falls back to node-gyp. Prove the native modules actually LOAD on this platform.
  heading('native modules load on this platform/arch');
  for (const mod of ['argon2', 'better-sqlite3']) {
    const r = await run(process.execPath, ['-e', `require('${mod}'); console.log('ok')`]);
    record(`require('${mod}')`, r.code === 0, r.code === 0 ? '' : r.stderr.trim().split('\n')[0]);
  }

  heading('sdods init . --force --no-install --no-browsers');
  // --force: init refuses a non-empty directory, and npm just created node_modules/.
  // --no-install: init's --pm accepts only bun|pnpm, neither of which a user machine has.
  const init = await run(process.execPath, [
    CLI_BIN,
    'init',
    '.',
    '--force',
    '--no-install',
    '--no-browsers',
  ]);
  record('init', init.code === 0, init.code === 0 ? '' : (init.stderr || init.stdout).slice(-600));
  record('runner config written', existsSync(join(WORKSPACE, 'sdods.runner.config.ts')));
  record(
    'demo project scaffolded',
    existsSync(join(WORKSPACE, 'projects', 'demo-shop', 'sdods.project.yaml')),
    'init silently skips the demo when templates/ did not ship',
  );

  heading('npm install — reconcile the fuller manifest init just wrote');
  const full = await npm(['install']);
  record('full install', full.code === 0, full.code === 0 ? '' : full.stderr.slice(-600));
  // run.ts spawns `npx bddgen`; playwright-bdd is NOT a dependency of @sdods/cli.
  record('playwright-bdd present', existsSync(join(WORKSPACE, 'node_modules', 'playwright-bdd')));
  record(
    '@playwright/test present',
    existsSync(join(WORKSPACE, 'node_modules', '@playwright', 'test')),
  );

  heading('serve on a free port, become healthy, surface a setup token');
  const port = await freePort();
  const server = spawn(
    process.execPath,
    [CLI_BIN, 'serve', '--port', String(port), '--host', '127.0.0.1'],
    {
      cwd: WORKSPACE,
      env: {
        ...process.env,
        SDODS_ROOT: WORKSPACE,
        SESSION_SECRET: 'probe-secret-at-least-32-characters-long',
        PLAYWRIGHT_BROWSERS_PATH: join(WORKSPACE, '.browsers'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverOut = '';
  server.stdout.on('data', (c: Buffer) => (serverOut += c.toString()));
  server.stderr.on('data', (c: Buffer) => (serverOut += c.toString()));

  let health: Record<string, unknown> | null = null;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        health = (await res.json()) as Record<string, unknown>;
        break;
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  record('/api/health', !!health, health ? JSON.stringify(health) : serverOut.slice(-600));

  const token = serverOut.match(/setup\?token=([0-9a-f]{16,})/)?.[1] ?? null;
  record('setup token parseable from stdout', !!token, token ? `${token.slice(0, 8)}...` : '');

  if (token) {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, username: 'admin', password: 'probe-password-123' }),
    });
    const cookie = res.headers.get('set-cookie');
    record(
      'POST /api/auth/setup',
      res.ok,
      res.ok ? `session cookie returned: ${!!cookie}` : `${res.status} ${await res.text()}`,
    );
  }

  heading('the API layer actually runs in this workspace');
  const apiRun = await run(
    process.execPath,
    [CLI_BIN, 'run', '-p', 'demo-shop', '-e', 'staging', '-l', 'api', '--no-ingest'],
    { timeoutMs: 300_000 },
  );
  record(
    'sdods run -l api',
    apiRun.code === 0,
    apiRun.code === 0 ? '' : (apiRun.stdout + apiRun.stderr).slice(-800),
  );

  server.kill('SIGTERM');
  finish();
}

function finish(): never {
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${'-'.repeat(72)}`);
  console.log(
    `${steps.length - failed.length}/${steps.length} checks passed on ${process.platform}-${process.arch}`,
  );
  if (failed.length) {
    console.log('\nfailed:');
    for (const f of failed)
      console.log(
        `  FAIL ${f.name}${f.detail ? `\n       ${f.detail.replace(/\n/g, '\n       ')}` : ''}`,
      );
  }
  if (!KEEP && !flag('--dir')) rmSync(WORKSPACE, { recursive: true, force: true });
  else console.log(`\nworkspace kept at ${WORKSPACE}`);
  process.exit(failed.length ? 1 : 0);
}

void main();
