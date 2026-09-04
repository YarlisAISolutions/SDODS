import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildAutomaxMcpServer, type BuildServerOptions } from '../server.js';

/** Serve AutoMax over stdio (used by `automax mcp`). Logs go to stderr only. */
export function serveAutomaxStdio(opts: BuildServerOptions = {}): { close(): Promise<void> } {
  const built = buildAutomaxMcpServer({
    ...opts,
    principal: opts.principal ?? { name: 'local', scopes: ['*'], via: 'stdio' },
  });
  built.ctx.logger.info(
    `serving ${built.toolCount} tools over stdio (caps: ${[...built.ctx.caps].join(',')})`,
  );
  const handle = serveStdio(() => built.server, {
    onerror: (e: unknown) =>
      built.ctx.logger.warn('stdio error', { message: (e as Error)?.message ?? String(e) }),
  } as never);
  return { close: () => handle.close() };
}
