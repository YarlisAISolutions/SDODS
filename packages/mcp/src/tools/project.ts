import { z } from 'zod';
import { sdodsCli, cliOrNote } from '../cli.js';
import { defineTool, summarize } from '../registry/registry.js';

export const projectTools = [
  defineTool({
    name: 'project_list',
    title: 'List projects',
    description:
      'List SDODS projects discovered under projects/ with layers, browsers and environments.',
    shape: {},
    access: 'read',
    domain: 'projects',
    capability: 'core',
    docsPath: '/docs/reference/mcp-tools',
    handler: async (_args, ctx) => {
      const r = await sdodsCli<unknown[]>(['project', 'list'], {
        cwd: ctx.rootDir,
        signal: ctx.signal,
      });
      return { text: summarize('Projects', r.json), data: r.json };
    },
  }),
  defineTool({
    name: 'project_get_config',
    title: 'Get resolved project config',
    description:
      'Resolved configuration for a project and environment (defaults → project yaml → env yaml → .env → process → CLI). Secrets are redacted. Use explain=true to see which layer produced each key.',
    shape: {
      project: z.string().describe('project slug'),
      env: z.string().optional().describe('environment name (default: project envs.default)'),
      explain: z.boolean().optional().describe('return provenance rows instead of the tree'),
    },
    access: 'read',
    domain: 'projects',
    capability: 'core',
    handler: async (args, ctx) => {
      const cli = ['config', 'show', '-p', args.project];
      if (args.env) cli.push('-e', args.env);
      if (args.explain) cli.push('--explain');
      const r = await sdodsCli(cli, { cwd: ctx.rootDir, signal: ctx.signal });
      return {
        text: summarize(`Config for ${args.project}${args.env ? ` (${args.env})` : ''}`, r.json),
        data: r.json,
      };
    },
  }),
  defineTool({
    name: 'project_list_envs',
    title: 'List environments',
    description:
      'Environments of a project with UI/API base URLs and whether they resolve without errors.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'envs',
    capability: 'core',
    handler: async (args, ctx) => {
      const r = await sdodsCli<unknown[]>(['env', 'list', '-p', args.project], {
        cwd: ctx.rootDir,
        signal: ctx.signal,
      });
      return { text: summarize(`Environments of ${args.project}`, r.json), data: r.json };
    },
  }),
  defineTool({
    name: 'project_validate_config',
    title: 'Validate all configs',
    description: 'Validate every project and environment yaml without running anything.',
    shape: {},
    access: 'read',
    domain: 'projects',
    capability: 'core',
    handler: async (_args, ctx) => {
      let data: unknown;
      try {
        data = (await sdodsCli(['config', 'validate'], { cwd: ctx.rootDir, signal: ctx.signal }))
          .json;
      } catch (e) {
        // exit code 2 still prints the table as JSON
        const err = e as { stderr?: string; message: string };
        return {
          text: `Validation reported problems: ${err.message}`,
          data: { error: err.message },
          isError: true,
        };
      }
      return { text: summarize('Configuration validation', data), data };
    },
  }),
  defineTool({
    name: 'project_doctor',
    title: 'Doctor',
    description: 'Check Node, Bun, browser engines, projects, env vars and database settings.',
    shape: { project: z.string().optional() },
    access: 'read',
    domain: 'projects',
    capability: 'core',
    annotations: { openWorldHint: true },
    handler: async (args, ctx) => {
      const cli = ['doctor', ...(args.project ? ['-p', args.project] : [])];
      let data: unknown;
      try {
        data = (await sdodsCli(cli, { cwd: ctx.rootDir, signal: ctx.signal, timeoutMs: 60_000 }))
          .json;
      } catch (e) {
        const err = e as { stderr?: string; message: string };
        // doctor exits 1 when a check fails but still prints JSON on stdout
        const m = /\[[\s\S]*\]/.exec(err.stderr ?? '');
        data = m ? JSON.parse(m[0]) : { error: err.message };
      }
      return { text: summarize('Doctor', data), data };
    },
  }),
  defineTool({
    name: 'workspace_tree',
    title: 'Workspace tree',
    description:
      'Hierarchy: organization → workspaces → projects → modules (testing types, tags) → processes.',
    shape: {},
    access: 'read',
    domain: 'workspaces',
    capability: 'core',
    handler: async (_args, ctx) => {
      const data = await cliOrNote(['workspace', 'tree'], { cwd: ctx.rootDir, signal: ctx.signal });
      return { text: summarize('Workspace tree', data), data };
    },
  }),
  defineTool({
    name: 'process_list',
    title: 'List processes',
    description:
      'Named run recipes (pr-check, nightly-regression, release-gate …) visible to a project: trigger, tags, layers, browsers, gates.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'processes',
    capability: 'core',
    handler: async (args, ctx) => {
      const data = await cliOrNote(['processes', 'list', '-p', args.project], {
        cwd: ctx.rootDir,
        signal: ctx.signal,
      });
      return { text: summarize(`Processes for ${args.project}`, data), data };
    },
  }),
];
