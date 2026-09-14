import type { Command } from 'commander';
import pc from 'picocolors';
import { SdodsError } from '@sdods/core';
import { ALL_CAPABILITIES, DEFAULT_CAPABILITIES, MCP_CLIENTS, type McpClient } from '@sdods/mcp';
import { createContext } from '../context.js';
import { json, ok, out } from '../ui.js';

const CLIENTS = MCP_CLIENTS;
type Client = McpClient;

/**
 * The default capability list, derived rather than restated. It used to be spelled out in three
 * places in this file — the fallback, the flag default and the "did the user change it" sentinel —
 * so adding a capability silently left the CLI handing out the old set.
 */
const DEFAULT_CAPS = DEFAULT_CAPABILITIES.join(',');

function capsOf(raw: string | undefined): string[] | 'all' {
  if (!raw || raw === 'all') return raw === 'all' ? 'all' : [...DEFAULT_CAPABILITIES];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function register(program: Command) {
  const mcp = program
    .command('mcp')
    .description('Start the SDODS MCP server (stdio by default) or install client configuration')
    .option('-p, --project <slug>', 'default project for tools and prompts')
    .option('-e, --env <name>', 'default environment')
    .option('--caps <list>', `capabilities: ${ALL_CAPABILITIES.join(',')} or "all"`, DEFAULT_CAPS)
    .option('--http', 'serve streamable HTTP instead of stdio')
    .option('--port <n>', 'HTTP port', '4001')
    .option('--host <host>', 'HTTP host', '127.0.0.1')
    .option(
      '--token <token>',
      'HTTP: accept this single bearer token (dev only; production uses `sdods tokens`)',
    )
    .option('--list-tools', 'print the tool catalogue and exit')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const {
        serveSdodsStdio,
        serveSdodsHttp,
        createRegistry,
        buildToolContext,
        ALL_CAPABILITIES,
      } = await import('@sdods/mcp');
      const caps = capsOf(opts.caps);
      if (opts.listTools) {
        const registry = createRegistry();
        const tctx = buildToolContext({ rootDir: ctx.rootDir, caps });
        const rows = registry.list(tctx).map((t) => ({
          name: t.name,
          access: t.access,
          capability: t.capability,
          description: t.description,
        }));
        if (ctx.opts.json) return json(rows);
        for (const r of rows)
          out(
            `${pc.bold(r.name.padEnd(28))} ${pc.dim(r.capability.padEnd(9))} ${pc.dim(r.access.padEnd(5))} ${r.description}`,
          );
        out(pc.dim(`\n${rows.length} tools · capabilities: ${ALL_CAPABILITIES.join(', ')}`));
        return;
      }
      if (opts.http) {
        const token = opts.token ?? process.env.SDODS_MCP_TOKEN;
        if (!token) {
          throw new SdodsError('AUTH_FAILED', 'HTTP mode needs a bearer token.', {
            hint: 'Pass --token <secret> (dev) or set SDODS_MCP_TOKEN. Production deployments use scoped tokens from `sdods tokens create` via the web server.',
            exitCode: 2,
          });
        }
        const srv = await serveSdodsHttp({
          rootDir: ctx.rootDir,
          project: opts.project,
          env: opts.env,
          caps,
          port: Number(opts.port),
          host: opts.host,
          authenticate: (t) => (t === token ? { name: 'token', scopes: ['*'], via: 'http' } : null),
        });
        ok(`SDODS MCP over HTTP at http://${opts.host}:${srv.port}/mcp (Ctrl+C to stop)`);
        await new Promise<void>((resolve) => {
          process.once('SIGINT', () => srv.close().then(resolve));
          process.once('SIGTERM', () => srv.close().then(resolve));
        });
        return;
      }
      // stdio: stdout carries protocol messages only; logs go to stderr
      serveSdodsStdio({ rootDir: ctx.rootDir, project: opts.project, env: opts.env, caps });
      await new Promise<void>(() => undefined);
    });

  mcp
    .command('install <client>')
    .description(
      'Register the SDODS MCP server with a client: claude | codex | cursor | vscode | windsurf | gemini (merges, never clobbers)',
    )
    .option('-p, --project <slug>')
    .option('-e, --env <name>')
    .option('--caps <list>')
    .option('--http-url <url>', 'configure the HTTP transport instead of stdio')
    .option('--token-placeholder <text>', 'placeholder written for the bearer token')
    .option(
      '--with-playwright',
      'also register the raw upstream Playwright MCP server (ungoverned; the sdods server already wraps it as browser_*)',
    )
    .option(
      '--file',
      'always write the config file instead of calling `claude mcp add` / `codex mcp add`',
    )
    .option('--print', 'print the snippet instead of writing files')
    .action(async (client: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const { installClientConfig, snippets, cliCommands } = await import('@sdods/mcp');
      if (!CLIENTS.includes(client as Client)) {
        throw new SdodsError('NOT_SUPPORTED', `Unknown client "${client}".`, {
          hint: `Use one of ${CLIENTS.join(', ')}.`,
          exitCode: 2,
        });
      }
      // commander also accepts `-p/-e/--caps` on the parent `mcp` command; honour both
      const parent = mcp.opts() as { project?: string; env?: string; caps?: string };
      const o = {
        project: opts.project ?? parent.project,
        env: opts.env ?? parent.env,
        caps: opts.caps ?? (parent.caps !== DEFAULT_CAPS ? parent.caps : undefined),
        httpUrl: opts.httpUrl,
        tokenPlaceholder: opts.tokenPlaceholder,
        withPlaywright: opts.withPlaywright === true,
      };
      const s = snippets(o)[client as Client];
      if (opts.print || ctx.opts.json) {
        if (ctx.opts.json) return json({ file: s.file, config: s.json ?? s.toml, cli: s.cli });
        out(pc.bold(s.file));
        out(s.json ? JSON.stringify(s.json, null, 2) : (s.toml ?? ''));
        if (s.cli) out(`\n${pc.dim('or:')} ${s.cli}`);
        return;
      }
      // Prefer the client's own CLI so its config format stays authoritative.
      if (!opts.file && (client === 'claude' || client === 'codex')) {
        const done = await registerViaClientCli(client, o, ctx.rootDir);
        if (done) {
          ok(`Registered the sdods MCP server with ${client} (${cliCommands(o)[client]})`);
          if (o.withPlaywright === true && client === 'codex')
            out(pc.dim('Also registered the bundled Playwright MCP server as "playwright".'));
          return;
        }
      }
      const r = installClientConfig(ctx.rootDir, client as Client, o);
      ok(`${r.created ? 'Created' : 'Updated'} ${r.file}`);
      if (s.cli) out(pc.dim(`Alternative: ${s.cli}`));
    });
}

/** `claude mcp add` (project scope) or `codex mcp add`; false when the CLI is unavailable. */
async function registerViaClientCli(
  client: 'claude' | 'codex',
  o: {
    project?: string;
    env?: string;
    caps?: string;
    httpUrl?: string;
    withPlaywright?: boolean;
  },
  cwd: string,
): Promise<boolean> {
  const { execa } = await import('execa');
  // `npx sdods` resolves only when the cwd happens to sit inside a checkout that has the binary in
  // node_modules/.bin. From anywhere else npx goes to the registry, where no package named `sdods`
  // exists, and the client reports CONNECTION_CLOSED. Name the package that owns the bin instead.
  const stdio = ['npx', '-y', '@sdods/cli', 'mcp'];
  if (o.project) stdio.push('--project', o.project);
  if (o.env) stdio.push('--env', o.env);
  if (o.caps) stdio.push('--caps', o.caps);
  const run = async (args: string[]) => {
    try {
      await execa(client, args, { cwd, timeout: 30_000 });
      return true;
    } catch (e) {
      const msg = String(
        (e as { stderr?: string; shortMessage?: string }).stderr ?? (e as Error).message,
      );
      if (/ENOENT|not found/i.test(msg)) return false;
      // already registered → remove and re-add so the args are current
      if (/already exists/i.test(msg)) {
        await execa(client, ['mcp', 'remove', args[2] ?? 'sdods'], { cwd, reject: false });
        await execa(client, args, { cwd, timeout: 30_000 });
        return true;
      }
      throw new SdodsError('NOT_SUPPORTED', `${client} mcp add failed: ${msg.trim()}`, {
        hint: 'Re-run with --file to write the config file directly.',
      });
    }
  };
  // A remote server without credentials answers 401 to every call, so the token is part of the
  // registration. Neither form writes the secret: Claude Code expands ${SDODS_TOKEN} from the
  // environment when it reads .mcp.json, and Codex reads the variable named by
  // --bearer-token-env-var at connect time.
  const addArgs =
    client === 'claude'
      ? o.httpUrl
        ? [
            'mcp',
            'add',
            '-s',
            'project',
            '--transport',
            'http',
            'sdods',
            o.httpUrl,
            '--header',
            'Authorization: Bearer ${SDODS_TOKEN}',
          ]
        : ['mcp', 'add', '-s', 'project', 'sdods', '--', ...stdio]
      : o.httpUrl
        ? ['mcp', 'add', 'sdods', '--url', o.httpUrl, '--bearer-token-env-var', 'SDODS_TOKEN']
        : ['mcp', 'add', 'sdods', '--', ...stdio];
  const ok1 = await run(addArgs);
  if (!ok1) return false;
  if (o.withPlaywright === true) {
    const pw =
      client === 'claude'
        ? [
            'mcp',
            'add',
            '-s',
            'project',
            'playwright',
            '--',
            'npx',
            'playwright',
            'mcp',
            '--headless',
          ]
        : ['mcp', 'add', 'playwright', '--', 'npx', 'playwright', 'mcp', '--headless'];
    await run(pw).catch(() => false);
  }
  return true;
}
