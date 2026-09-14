import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AgentInstall,
  SupportProject,
  buildTools,
  cursorInstallLink,
  resolveSupportLinks,
  supportMessage,
  vscodeInstallLink,
  type AgentProject,
} from '../src/index';

const project: AgentProject = {
  name: 'Acme',
  serverName: 'acme',
  npmPackage: '@acme/cli',
  skillsRepo: 'acme/acme-skills',
  marketplace: 'acme',
  plugin: 'acme',
};

const commandsOf = (p: AgentProject, id: string) =>
  buildTools(p)
    .find((t) => t.id === id)
    ?.steps.flatMap((s) => (s.kind === 'command' ? [s.value] : []));

describe('agent install tools', () => {
  it('builds every command from the project, never from a hard-coded package', () => {
    expect(commandsOf(project, 'claude-code')).toEqual([
      '/plugin marketplace add acme/acme-skills',
      '/plugin install acme@acme',
    ]);
    expect(commandsOf(project, 'codex')).toEqual([
      'codex mcp add acme -- npx -y @acme/cli mcp',
      'npx skills add acme/acme-skills -a codex',
    ]);
    expect(commandsOf(project, 'gemini')?.[0]).toBe('gemini mcp add acme npx -- -y @acme/cli mcp');
    expect(commandsOf(project, 'skills')).toEqual([
      'npx skills add acme/acme-skills',
      'npx -y @acme/cli skills install',
    ]);
    const all = JSON.stringify(buildTools(project));
    expect(all).not.toMatch(/sdods/i);
  });

  it('falls back to plain MCP registration when the project has no plugin', () => {
    const bare: AgentProject = { name: 'Bare', serverName: 'bare', npmPackage: 'bare-mcp' };
    expect(commandsOf(bare, 'claude-code')).toEqual(['claude mcp add bare -- npx -y bare-mcp mcp']);
    expect(buildTools(bare).map((t) => t.id)).not.toContain('skills');
  });

  it('offers ChatGPT and Claude.ai only for a remote endpoint with OAuth', () => {
    expect(
      buildTools({ ...project, remoteMcpUrl: 'https://h/mcp' }).map((t) => t.id),
    ).not.toContain('chatgpt');
    const ids = buildTools({ ...project, remoteMcpUrl: 'https://h/mcp', remoteOAuth: true }).map(
      (t) => t.id,
    );
    expect(ids).toEqual(expect.arrayContaining(['chatgpt', 'claude-ai']));
  });

  it('encodes Cursor and VS Code install links the way each editor documents', () => {
    const cursor = new URL(cursorInstallLink(project));
    expect(cursor.protocol).toBe('cursor:');
    expect(cursor.searchParams.get('name')).toBe('acme');
    expect(JSON.parse(atob(cursor.searchParams.get('config')!))).toEqual({
      command: 'npx',
      args: ['-y', '@acme/cli', 'mcp'],
    });
    const vscode = vscodeInstallLink(project);
    expect(vscode.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(vscode.split('?')[1]!))).toEqual({
      name: 'acme',
      command: 'npx',
      args: ['-y', '@acme/cli', 'mcp'],
    });
  });

  it('renders tabs for the primary tools and a More menu for the rest', () => {
    const html = renderToStaticMarkup(
      createElement(AgentInstall, { project, learnMoreHref: 'https://docs.example.com/ai' }),
    );
    expect(html).toContain('Using an AI coding agent? Install Acme:');
    expect(html).toMatch(/role="tab"[^>]*>Claude Code</);
    expect(html).toMatch(/role="tab"[^>]*>Cursor</);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('/plugin install acme@acme');
    expect(html).toContain('href="https://docs.example.com/ai"');
  });
});

describe('support links', () => {
  it('keeps only https links on each provider’s own host, in a stable order', () => {
    const resolved = resolveSupportLinks({
      'ko-fi': 'https://ko-fi.com/acme',
      'github-sponsors': 'https://evil.example.com/acme',
      stripe: 'javascript:alert(1)',
      'open-collective': 'http://opencollective.com/acme',
      'sponsor-page': 'https://acme.dev/sponsor/',
      'buy-me-a-coffee': '',
    });
    expect(resolved.map((r) => [r.provider.id, r.href])).toEqual([
      ['sponsor-page', 'https://acme.dev/sponsor/'],
      ['ko-fi', 'https://ko-fi.com/acme'],
    ]);
  });

  it('says "open source" only when told the source is public', () => {
    expect(supportMessage({ name: 'Acme', license: 'MIT' })).toMatch(/^Acme is free — MIT\./);
    expect(supportMessage({ name: 'Acme', openSource: true })).toMatch(/free and open source/);
  });

  it('renders nothing without a valid link, and one link in the footer variant', () => {
    expect(
      renderToStaticMarkup(createElement(SupportProject, { project: { name: 'Acme' }, links: {} })),
    ).toBe('');
    const footer = renderToStaticMarkup(
      createElement(SupportProject, {
        project: { name: 'Acme' },
        links: { 'sponsor-page': 'https://acme.dev/sponsor/', 'ko-fi': 'https://ko-fi.com/acme' },
        variant: 'footer',
      }),
    );
    expect(footer.match(/<a /g)).toHaveLength(1);
    expect(footer).toContain('Support Acme');
  });
});
