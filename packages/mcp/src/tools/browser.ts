import { z } from 'zod';
import { BrowserSchema } from '@sdods/contracts';
import { BROWSER_TOOLS } from '../browser/manifest.js';
import { UNSAFE_DISABLED_HINT, unsafeToolsEnabled } from '../browser/policy.js';
import { UPSTREAM_SHAPES, type UpstreamToolName } from '../browser/shapes.js';
import type { BrowserSessionManager } from '../browser/session.js';
import { defineTool, summarize, type SdodsTool, type ToolContext } from '../registry/registry.js';

/**
 * The governed browser surface.
 *
 * Every upstream Playwright MCP tool is wrapped rather than exposed directly, so that a browser an
 * agent drives is bound to a project and environment, carries that project's test-id attribute and
 * login state, writes its artifacts into the run directory, has its auth headers redacted on the
 * way out, and can be refused by scope. The raw server offered all of that ungoverned, with
 * `browser_run_code_unsafe` sitting in the same list as `browser_click`.
 */

const DEFAULT_SESSION = 'default';

/** Output beyond this is clipped: `summarize()` bounds `data`, never `text`, and one snapshot of a
 * large single-page app is tens of thousands of tokens. Every tool that can produce that much has
 * a `filename` argument, which the clip message points at. */
const MAX_TEXT = 20_000;

const sessionArg = {
  sessionId: z
    .string()
    .optional()
    .describe(`Browser session (default: "${DEFAULT_SESSION}"). See browser_session_open.`),
};

function clip(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  return `${text.slice(0, MAX_TEXT)}\n\n… truncated at ${MAX_TEXT} characters. Re-run with a \`filename\` argument to write the full output into the session directory.`;
}

function sessions(ctx: ToolContext): BrowserSessionManager {
  const mgr = ctx.browser as BrowserSessionManager | undefined;
  if (!mgr)
    throw Object.assign(new Error('The browser capability is disabled on this server.'), {
      error: {
        code: 'CAPABILITY_DISABLED',
        hint: 'Start with --caps browser (it is on by default).',
      },
    });
  return mgr;
}

/** One wrapper per upstream tool. */
function wrap(name: UpstreamToolName): SdodsTool<any> {
  const spec = BROWSER_TOOLS[name];
  const upstreamShape = UPSTREAM_SHAPES[name] as Record<string, z.ZodTypeAny>;
  return defineTool({
    name,
    title: name.replace(/^browser_/, '').replace(/_/g, ' '),
    description: [
      `Playwright MCP \`${name}\`, bound to an SDODS project and environment.`,
      spec.note,
      spec.pack === 'default' ? undefined : `Requires the \`${spec.pack}\` capability pack.`,
    ]
      .filter(Boolean)
      .join(' '),
    shape: { ...sessionArg, ...upstreamShape },
    access: spec.access,
    domain: 'browser',
    capability: 'browser',
    ...(spec.scope ? { scope: spec.scope } : {}),
    annotations: {
      readOnlyHint: spec.access === 'read',
      destructiveHint: spec.access === 'write',
      openWorldHint: true,
    },
    docsPath: '/docs/reference/mcp-tools',
    handler: async (args, ctx) => {
      if (spec.scope === 'browser:admin' && !unsafeToolsEnabled())
        throw Object.assign(new Error(`${name} is disabled.`), {
          error: { code: 'BROWSER_UNSAFE_DISABLED', hint: UNSAFE_DISABLED_HINT },
        });

      const mgr = sessions(ctx);
      const id = (args as { sessionId?: string }).sessionId ?? DEFAULT_SESSION;

      // Only a tool that acts may bring a browser up. `browser:read` is granted to every viewer by
      // the READ_SCOPES filter, so letting an observe tool open a session would let a viewer start
      // a browser without ever holding browser:write.
      if (spec.access === 'read' && !mgr.has(id))
        throw Object.assign(new Error(`No browser session "${id}".`), {
          error: {
            code: 'BROWSER_NO_SESSION',
            hint: 'Open one with browser_session_open, or call an action tool first.',
          },
        });

      if (!ctx.project && !mgr.has(id))
        throw Object.assign(new Error('No project for an implicit browser session.'), {
          error: {
            code: 'BROWSER_NO_PROJECT',
            hint: 'Call browser_session_open with a project, or start the server with --project.',
          },
        });

      const entry = await mgr.ensure(id, { project: ctx.project!, env: ctx.env });
      const result = await entry.driver.call(name, args as Record<string, unknown>);
      return {
        text: clip(result.text) || `${name} ok`,
        images: result.images,
        isError: result.isError,
      };
    },
  });
}

const sessionTools: Array<SdodsTool<any>> = [
  defineTool({
    name: 'browser_session_open',
    title: 'Open a browser session',
    description:
      'Start a browser bound to a project and environment. Applies the project test-id attribute, the environment locale/timezone/headers, an optional role login state, and writes artifacts into the run directory. Calling an action tool without a session opens a default one, so this is for overrides.',
    shape: {
      sessionId: z.string().optional().describe(`default: "${DEFAULT_SESSION}"`),
      project: z.string().optional().describe('project slug (default: the server’s --project)'),
      env: z.string().optional(),
      role: z
        .string()
        .optional()
        .describe('reuse the login state captured for this @user:<role>; must already exist'),
      browser: BrowserSchema.optional().describe('default: chromium'),
      headed: z.boolean().optional().describe('default: false (headless)'),
      device: z.string().optional().describe('Playwright device profile, e.g. "iPhone 15"'),
      viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
      caps: z
        .array(z.enum(['vision', 'pdf', 'devtools']))
        .optional()
        .describe('extra Playwright capability packs to enable for this session'),
      snapshotMode: z
        .enum(['full', 'none'])
        .optional()
        .describe('"none" keeps accessibility snapshots out of every response'),
      images: z.enum(['allow', 'omit']).optional(),
    },
    access: 'write',
    domain: 'browser',
    capability: 'browser',
    annotations: { destructiveHint: true, openWorldHint: true },
    docsPath: '/docs/reference/mcp-tools',
    handler: async (args, ctx) => {
      const project = args.project ?? ctx.project;
      if (!project)
        throw Object.assign(new Error('A project is required to open a browser session.'), {
          error: { code: 'BROWSER_NO_PROJECT', hint: 'Pass project, or start with --project.' },
        });
      const info = await sessions(ctx).open({
        sessionId: args.sessionId ?? DEFAULT_SESSION,
        project,
        env: args.env ?? ctx.env,
        role: args.role,
        browser: args.browser,
        headed: args.headed,
        device: args.device,
        viewport: args.viewport,
        caps: args.caps,
        snapshotMode: args.snapshotMode,
        images: args.images,
      });
      return { text: summarize(`Browser session ${info.sessionId}`, info), data: info };
    },
  }),
  defineTool({
    name: 'browser_session_close',
    title: 'Close a browser session',
    description:
      'End a session and stop its browser. Distinct from browser_close, which closes the page and leaves the session running. Artifacts stay on disk.',
    shape: { sessionId: z.string().optional() },
    access: 'write',
    domain: 'browser',
    capability: 'browser',
    annotations: { destructiveHint: true },
    docsPath: '/docs/reference/mcp-tools',
    handler: async (args, ctx) => {
      const id = args.sessionId ?? DEFAULT_SESSION;
      const closed = await sessions(ctx).close(id);
      return { text: closed ? `Closed browser session ${id}.` : `No browser session ${id}.` };
    },
  }),
  defineTool({
    name: 'browser_session_list',
    title: 'List browser sessions',
    description: 'Open browser sessions on this connection, with their project, env and artifacts.',
    shape: {},
    access: 'read',
    domain: 'browser',
    capability: 'browser',
    docsPath: '/docs/reference/mcp-tools',
    handler: async (_args, ctx) => {
      const list = sessions(ctx).list();
      return { text: summarize('Browser sessions', list), data: list };
    },
  }),
];

export const browserTools: Array<SdodsTool<any>> = [
  ...sessionTools,
  ...(Object.keys(BROWSER_TOOLS) as UpstreamToolName[]).sort().map(wrap),
];
