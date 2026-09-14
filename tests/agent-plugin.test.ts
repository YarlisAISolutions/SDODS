import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROLE_PROMPTS } from '@sdods/mcp';
import {
  MARKETPLACE,
  PLUGIN,
  PLUGIN_SKILL_NAMES,
  buildAgentPlugin,
} from '../scripts/build-agent-plugin.js';

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const json = (root: string, rel: string) => JSON.parse(read(root, rel));
const nameOf = (text: string) => /^---\r?\n[\s\S]*?^name:\s*(.+)$/m.exec(text)?.[1];

describe('agent plugin repository', () => {
  let out: string;
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'sdods-plugin-'));
    buildAgentPlugin({ out, version: '9.9.9' });
  });

  it('is a marketplace whose one plugin points at a real directory', () => {
    const m = json(out, '.claude-plugin/marketplace.json');
    expect(m.name).toBe(MARKETPLACE);
    expect(m.owner.name).toBe('SDODS');
    expect(m.plugins).toHaveLength(1);
    expect(m.plugins[0]).toMatchObject({ name: PLUGIN, version: '9.9.9' });
    const plugin = join(out, m.plugins[0].source);
    expect(json(plugin, '.claude-plugin/plugin.json')).toMatchObject({
      name: PLUGIN,
      version: '9.9.9',
      license: 'Apache-2.0',
    });
  });

  it('launches the MCP server from the published package', () => {
    expect(json(out, `plugins/${PLUGIN}/.mcp.json`)).toEqual({
      mcpServers: { sdods: { command: 'npx', args: ['-y', '@sdods/cli', 'mcp'] } },
    });
  });

  it('ships every bundled skill at the root for `npx skills add`, names matching folders', () => {
    const bundled = readdirSync('packages/cli/skills').sort();
    expect(readdirSync(join(out, 'skills')).sort()).toEqual(bundled);
    for (const s of bundled) expect(nameOf(read(out, `skills/${s}/SKILL.md`))).toBe(s);
  });

  it('gives plugin skills and commands short names that match their folders', () => {
    const dir = join(out, `plugins/${PLUGIN}/skills`);
    const names = readdirSync(dir).sort();
    expect(names).toEqual(
      expect.arrayContaining([...Object.values(PLUGIN_SKILL_NAMES), 'setup', 'test', 'heal']),
    );
    for (const n of names) {
      const text = read(dir, `${n}/SKILL.md`);
      expect(nameOf(text)).toBe(n);
      expect(text).toMatch(/^description: .{20,}$/m);
      expect(text).not.toMatch(/npx (-y )?sdods\b/);
      // `npx skills add` also reads marketplace.json; hidden, the plugin's copies do not appear
      // next to the portable skills in skills/.
      expect(text).toMatch(/^---\r?\n[\s\S]*?^metadata:\r?\n {2}internal: true\r?\n---/m);
    }
    for (const s of readdirSync(join(out, 'skills')))
      expect(read(out, `skills/${s}/SKILL.md`)).not.toContain('internal: true');
  });

  it('turns every SDODS role into a subagent limited to read tools and the plugin MCP server', () => {
    for (const role of Object.keys(ROLE_PROMPTS)) {
      const text = read(out, `plugins/${PLUGIN}/agents/sdods-${role}.md`);
      expect(nameOf(text)).toBe(`sdods-${role}`);
      expect(text).toContain(`tools: Read, Glob, Grep, mcp__plugin_${PLUGIN}_sdods__*`);
    }
  });

  it('registers the session hook with a script that exists', () => {
    const hooks = json(out, `plugins/${PLUGIN}/hooks/hooks.json`);
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain('hooks/session-start.mjs');
    expect(existsSync(join(out, `plugins/${PLUGIN}/hooks/session-start.mjs`))).toBe(true);
  });

  it('writes no personal name, and no funding file unless a sponsor URL is given', () => {
    expect(existsSync(join(out, '.github/FUNDING.yml'))).toBe(false);
    expect(read(out, 'README.md')).toContain(`/plugin install ${PLUGIN}@${MARKETPLACE}`);
    const withSponsor = mkdtempSync(join(tmpdir(), 'sdods-plugin-sponsor-'));
    buildAgentPlugin({
      out: withSponsor,
      version: '1.0.0',
      sponsorUrl: 'https://sdods.com/sponsor/',
    });
    expect(read(withSponsor, '.github/FUNDING.yml')).toContain('https://sdods.com/sponsor/');
  });
});
