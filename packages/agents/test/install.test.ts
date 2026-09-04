import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentsMdContent,
  claudeMdContent,
  installCodingAgents,
} from '../src/claude-code/install.js';

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'sdods-install-'));
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

describe('agent install --for claude|codex|all', () => {
  it('writes Claude Code files, Codex AGENTS.md and the shared AGENT.md/SKILL.md', () => {
    const root = tempRepo();
    const written = installCodingAgents(root, { for: 'all', project: 'shop', env: 'staging' });
    const rel = written.map((w) => w.replace(root + '/', ''));
    expect(rel).toEqual(
      expect.arrayContaining([
        '.claude/agents/sdods-planner.md',
        '.claude/agents/sdods-healer.md',
        'CLAUDE.md',
        'AGENTS.md',
        'AGENT.md',
        'SKILL.md',
      ]),
    );
    expect(existsSync(join(root, '.mcp.json'))).toBe(false); // MCP registration is the CLI's job
    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('AGENT.md');
    expect(claudeMd).toContain('sdods lint -p shop -e staging');
    const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('### sdods-generator');
    expect(agentsMd).toContain('sdods mcp install codex');
    expect(agentsMd).toContain('~/.codex/config.toml');
    // idempotent
    expect(installCodingAgents(root, { for: 'all' })).toEqual([]);
    expect(installCodingAgents(root, { for: 'all', force: true }).length).toBeGreaterThan(5);
  });

  it('--for codex writes only AGENTS.md plus the shared files', () => {
    const root = tempRepo();
    const rel = installCodingAgents(root, { for: 'codex' }).map((w) => w.replace(root + '/', ''));
    expect(rel).toEqual(['AGENTS.md', 'AGENT.md', 'SKILL.md']);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
  });

  it('content generators mention the wording rule and the conventions', () => {
    expect(claudeMdContent()).toContain('automation platform with a reusable architecture');
    expect(agentsMdContent({ project: 'p' })).toContain('sdods run -p p -l api');
  });
});
