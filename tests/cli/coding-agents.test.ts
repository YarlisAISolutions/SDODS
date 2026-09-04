import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const bin = resolve(root, 'packages', 'cli', 'src', 'bin.ts');

function sdods(args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
    timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('coding-agent CLIs: doctor tokens, agent install, mcp install codex', () => {
  it('doctor --json returns checks plus a token matrix with requirement levels', () => {
    const r = sdods(['--json', 'doctor'], {
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GITHUB_TOKEN: 'x',
      DB_DRIVER: 'sqlite',
    });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as {
      checks: Array<{ name: string; ok: boolean; optional?: boolean }>;
      tokens: Array<{ name: string; requirement: string; present: boolean; group?: string }>;
    };
    expect(out.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(['node', 'cli:claude', 'cli:codex', 'database']),
    );
    expect(out.checks.find((c) => c.name === 'cli:codex')?.optional).toBe(true);
    const byName = Object.fromEntries(out.tokens.map((t) => [t.name, t]));
    expect(byName['ANTHROPIC_API_KEY']).toMatchObject({
      requirement: 'one-of',
      group: 'agents',
      present: false,
    });
    expect(byName['claude CLI login']).toMatchObject({ requirement: 'one-of' });
    expect(byName['codex CLI login']).toMatchObject({ requirement: 'one-of' });
    expect(byName['GITHUB_TOKEN']).toMatchObject({ requirement: 'optional', present: true });
    expect(byName['DATABASE_URL']).toMatchObject({ requirement: 'optional' });
    expect(byName['NPM_TOKEN']).toMatchObject({ requirement: 'ci-only' });
    expect(out.tokens.filter((t) => t.requirement === 'mandatory')).toEqual([]);
  });

  it('agent --help lists the CLI adapters and agent install --for', () => {
    const help = sdods(['agent', 'review', '--help']).stdout;
    expect(help).toContain('claude-code');
    expect(help).toContain('codex');
    const install = sdods(['agent', 'install', '--help']).stdout;
    expect(install).toContain('--for <client>');
    expect(install).toContain('--no-mcp');
    expect(sdods(['agent', 'install-claude', '--help']).stdout).toContain('Alias');
  });

  it('mcp install codex --print shows the TOML table and the codex mcp add command', () => {
    const r = sdods(['mcp', 'install', 'codex', '-p', 'demo-shop', '--print']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[mcp_servers.sdods]');
    expect(r.stdout).toContain('codex mcp add sdods -- npx sdods mcp --project demo-shop');
    const j = JSON.parse(
      sdods(['--json', 'mcp', 'install', 'codex', '-p', 'demo-shop', '--print']).stdout.replace(
        /^[^{]*/,
        '',
      ),
    ) as { file: string; cli: string };
    expect(j.file).toMatch(/config\.toml$/);
    expect(j.cli).toContain('codex mcp add');
  });
});
