import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { findRepoRoot } from '../src/cli.js';

/** End-to-end over stdio: spawns `sdods mcp` exactly the way an MCP client would. */
describe('sdods mcp (stdio)', () => {
  const root = findRepoRoot(process.cwd());
  const client = new Client({ name: 'sdods-test-client', version: '0.0.0' });
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        'tsx',
        join(root, 'packages', 'cli', 'src', 'bin.ts'),
        'mcp',
        '--project',
        'demo-shop',
        '--caps',
        'all',
      ],
      cwd: root,
      env: { ...process.env, SDODS_MCP_QUIET: '1', NO_COLOR: '1' } as Record<string, string>,
      stderr: 'pipe',
    });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client.close().catch(() => undefined);
  });

  it('lists tools, prompts and resource templates', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'project_list',
        'workspace_tree',
        'process_list',
        'feature_list',
        'run_tests',
        'analyze_project',
        'proposal_list',
        'issue_create',
      ]),
    );
    const echoTool = tools.tools.find((t) => t.name === 'project_get_config')!;
    expect((echoTool.inputSchema as any).properties.project).toBeDefined();
    expect(echoTool.annotations?.readOnlyHint).toBe(true);
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'sdods-plan',
        'sdods-generate',
        'sdods-heal',
        'sdods-upgrade',
        'sdods-review',
      ]),
    );
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((t) => t.uriTemplate)).toEqual(
      expect.arrayContaining(['sdods://run/{runId}/summary', 'sdods://proposal/{id}']),
    );
  }, 60_000);

  it('calls project_list, workspace_tree and process_list through the CLI', async () => {
    const list = await client.callTool({ name: 'project_list', arguments: {} });
    const items = (list.structuredContent as any).items as Array<{ slug: string }>;
    expect(items.map((i) => i.slug)).toContain('demo-shop');

    const tree = await client.callTool({ name: 'workspace_tree', arguments: {} });
    expect((tree.structuredContent as any).organization.slug).toBe('sdods');
    expect((tree.structuredContent as any).workspaces.map((w: any) => w.workspace.slug)).toEqual(
      expect.arrayContaining(['default', 'platform-qa']),
    );

    const procs = await client.callTool({
      name: 'process_list',
      arguments: { project: 'demo-shop' },
    });
    const names = ((procs.structuredContent as any).items as Array<{ name: string }>).map(
      (p) => p.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['pr-check', 'nightly-regression', 'release-gate']),
    );
  }, 120_000);

  it('reads a prompt with project context and reports invalid args cleanly', async () => {
    const p = await client.getPrompt({
      name: 'sdods-review',
      arguments: { project: 'demo-shop', goal: 'tags' },
    });
    const text = (p.messages[0]!.content as { text: string }).text;
    expect(text).toContain('SDODS REVIEWER');
    expect(text).toContain('Project: demo-shop');
    const bad = await client.callTool({ name: 'project_get_config', arguments: {} });
    expect(bad.isError).toBe(true);
    // the SDK validates the input schema itself; our registry adds [INVALID_ARGS] when it reaches the handler
    expect((bad.content[0] as { text: string }).text).toMatch(/INVALID_ARGS|Invalid arguments/);
  }, 120_000);
});
