import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { ResourceTemplate } from '@modelcontextprotocol/server';
import { runFiles } from '@sdods/contracts';
import { getRun, listRuns, projectRoot, safeJoin, walk } from './fs.js';
import { ProposalStore } from './proposals.js';
import type { ToolContext } from './registry/registry.js';

/** MCP resources: features, run summaries, NDJSON, screenshots and proposals. */
export function registerResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource(
    'feature',
    new ResourceTemplate('sdods://project/{slug}/features/{+path}', {
      list: async () => {
        const resources: Array<{ uri: string; name: string; mimeType: string }> = [];
        const projectsDir = join(ctx.rootDir, process.env.SDODS_PROJECTS_DIR ?? 'projects');
        for (const f of walk(projectsDir, (x) => x.endsWith('.feature'), 500)) {
          const rel = f.slice(projectsDir.length + 1).replace(/\\/g, '/');
          const [slug, ...rest] = rel.split('/');
          if (!slug || rest[0] !== 'features') continue;
          resources.push({
            uri: `sdods://project/${slug}/features/${rest.slice(1).join('/')}`,
            name: rel,
            mimeType: 'text/x-gherkin',
          });
        }
        return { resources };
      },
    }),
    {
      title: 'Feature file',
      description: 'Gherkin feature files per project',
      mimeType: 'text/x-gherkin',
    },
    async (uri, variables) => {
      const slug = String(variables.slug);
      const path = String(variables.path);
      const file = safeJoin(join(projectRoot(ctx.rootDir, slug), 'features'), path);
      if (!existsSync(file)) throw new Error(`No such feature: ${path}`);
      return {
        contents: [{ uri: uri.href, mimeType: 'text/x-gherkin', text: readFileSync(file, 'utf8') }],
      };
    },
  );

  server.registerResource(
    'run-summary',
    new ResourceTemplate('sdods://run/{runId}/summary', {
      list: async () => ({
        resources: listRuns(ctx.rootDir, 50).map((r) => ({
          uri: `sdods://run/${r.runId}/summary`,
          name: `run ${r.runId}`,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Run summary',
      description: 'run.json + summary.json of a run',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const run = getRun(ctx.rootDir, String(variables.runId));
      if (!run) throw new Error(`Unknown run ${String(variables.runId)}`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ manifest: run.manifest, summary: run.summary }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'run-messages',
    new ResourceTemplate('sdods://run/{runId}/messages.ndjson', { list: undefined }),
    {
      title: 'Cucumber messages',
      description: 'NDJSON messages of a run',
      mimeType: 'application/x-ndjson',
    },
    async (uri, variables) => {
      const run = getRun(ctx.rootDir, String(variables.runId));
      const file = run ? join(run.dir, runFiles.messages) : undefined;
      if (!file || !existsSync(file))
        throw new Error(`No messages for run ${String(variables.runId)}`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/x-ndjson', text: readFileSync(file, 'utf8') },
        ],
      };
    },
  );

  server.registerResource(
    'screenshot',
    new ResourceTemplate('sdods://screenshot/{runId}/{fingerprint}/{retry}/{file}', {
      list: undefined,
    }),
    {
      title: 'Screenshot',
      description: 'Before/after and scenario screenshots of a run',
      mimeType: 'image/png',
    },
    async (uri, variables) => {
      const run = getRun(ctx.rootDir, String(variables.runId));
      if (!run) throw new Error(`Unknown run ${String(variables.runId)}`);
      const slug = run.manifest?.projectSlug;
      const base = slug ? join(run.dir, slug) : run.dir;
      const file = safeJoin(
        base,
        `${String(variables.fingerprint)}/r${String(variables.retry)}/${String(variables.file)}`,
      );
      if (!existsSync(file)) throw new Error(`No such screenshot: ${String(variables.file)}`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'image/png', blob: readFileSync(file).toString('base64') },
        ],
      };
    },
  );

  server.registerResource(
    'proposal',
    new ResourceTemplate('sdods://proposal/{id}', {
      list: async () => ({
        resources: new ProposalStore(ctx.rootDir).list().map((p) => ({
          uri: `sdods://proposal/${p.id}`,
          name: p.summary,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Proposal',
      description: 'Agent proposal manifest and diff',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const store = new ProposalStore(ctx.rootDir);
      const m = store.get(String(variables.id));
      if (!m) throw new Error(`Unknown proposal ${String(variables.id)}`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ ...m, diff: store.diff(m.id) }, null, 2),
          },
        ],
      };
    },
  );
}
