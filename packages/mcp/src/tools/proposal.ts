import { z } from 'zod';
import { ProposalStore } from '../proposals.js';
import { defineTool, summarize } from '../registry/registry.js';

export const proposalTools = [
  defineTool({
    name: 'proposal_list',
    title: 'List proposals',
    description: 'Pending/accepted/rejected proposals written by agents and write tools.',
    shape: {
      status: z.enum(['pending', 'accepted', 'rejected']).optional(),
      project: z.string().optional(),
    },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      const rows = new ProposalStore(ctx.rootDir)
        .list(args)
        .map((m) => ({
          id: m.id,
          role: m.role,
          project: m.project,
          status: m.status,
          summary: m.summary,
          files: m.files.length,
          createdAt: m.createdAt,
          costUsd: m.costUsd,
        }));
      return { text: summarize(`Proposals (${rows.length})`, rows), data: rows };
    },
  }),
  defineTool({
    name: 'proposal_get',
    title: 'Get proposal',
    description: 'Manifest, files and a diff against the working tree for one proposal.',
    shape: { id: z.string(), includeDiff: z.boolean().optional() },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      const store = new ProposalStore(ctx.rootDir);
      const m = store.get(args.id);
      if (!m)
        throw Object.assign(new Error(`Unknown proposal ${args.id}`), {
          error: { code: 'NOT_FOUND' },
        });
      const files = m.files.map((f) => ({
        ...f,
        content: f.op === 'delete' ? undefined : store.readFile(args.id, f),
      }));
      const diff = args.includeDiff === false ? undefined : store.diff(args.id);
      return {
        text: `${m.summary}\n\n${diff ? `\`\`\`diff\n${diff.slice(0, 6000)}\n\`\`\`` : ''}`,
        data: { ...m, files, diff },
      };
    },
  }),
  defineTool({
    name: 'proposal_accept',
    title: 'Accept proposal',
    description:
      'Apply a proposal to the working tree (a person should have reviewed the diff first).',
    shape: { id: z.string(), reviewedBy: z.string().optional() },
    access: 'write',
    domain: 'agents',
    capability: 'agents',
    annotations: { destructiveHint: true },
    handler: async (args, ctx) => {
      const written = new ProposalStore(ctx.rootDir).accept(args.id, {
        reviewedBy: args.reviewedBy ?? ctx.principal.name,
      });
      return {
        text: `Applied ${written.length} file(s):\n${written.map((w) => `- ${w}`).join('\n')}\nRun feature_lint next.`,
        data: { id: args.id, written },
      };
    },
  }),
  defineTool({
    name: 'proposal_reject',
    title: 'Reject proposal',
    description: 'Mark a proposal rejected with an optional reason.',
    shape: { id: z.string(), reason: z.string().optional() },
    access: 'write',
    domain: 'agents',
    capability: 'agents',
    handler: async (args, ctx) => {
      const m = new ProposalStore(ctx.rootDir).reject(args.id, args.reason, ctx.principal.name);
      return { text: `Rejected ${m.id}.`, data: m };
    },
  }),
];
