import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STDIO_LAUNCH,
  cliCommands,
  installClientConfig,
  serverEntry,
  snippets,
  windsurfConfigPath,
} from '../src/install/index.js';

describe('MCP install snippets per client', () => {
  const originalHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sdods-mcp-home-'));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('launches the published package, never a bare `npx sdods`', () => {
    expect(STDIO_LAUNCH).toEqual(['-y', '@sdods/cli', 'mcp']);
    expect(serverEntry({ project: 'shop' }, 'cursor')).toEqual({
      command: 'npx',
      args: ['-y', '@sdods/cli', 'mcp', '--project', 'shop'],
    });
    for (const cli of Object.values(cliCommands({}))) expect(cli).not.toMatch(/npx sdods/);
  });

  it('uses each client’s own key for a remote server', () => {
    const o = { httpUrl: 'https://sdods.example.com/mcp' };
    expect(serverEntry(o, 'cursor')).toMatchObject({ type: 'http', url: o.httpUrl });
    expect(serverEntry(o, 'windsurf')).toEqual({
      serverUrl: o.httpUrl,
      headers: { Authorization: 'Bearer ${env:SDODS_TOKEN}' },
    });
    expect(serverEntry(o, 'gemini')).toMatchObject({ httpUrl: o.httpUrl });
    expect(serverEntry(o, 'vscode')).toMatchObject({
      headers: { Authorization: 'Bearer ${input:sdods-token}' },
    });
  });

  it('writes Windsurf’s user-level mcp_config.json, not a project file', () => {
    expect(windsurfConfigPath()).toBe(join(home, '.codeium', 'windsurf', 'mcp_config.json'));
    const r = installClientConfig('/unused-root', 'windsurf', { project: 'shop' });
    expect(r.file).toBe(windsurfConfigPath());
    const parsed = JSON.parse(readFileSync(r.file, 'utf8'));
    expect(parsed.mcpServers.sdods.args).toContain('@sdods/cli');
  });

  it('writes .gemini/settings.json and prints the gemini CLI form', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdods-gemini-'));
    const r = installClientConfig(root, 'gemini', { httpUrl: 'https://h/mcp' });
    expect(r.file).toBe(join(root, '.gemini', 'settings.json'));
    expect(JSON.parse(readFileSync(r.file, 'utf8')).mcpServers.sdods.httpUrl).toBe('https://h/mcp');
    expect(snippets({}).gemini.cli).toBe('gemini mcp add sdods npx -- -y @sdods/cli mcp');
  });
});
