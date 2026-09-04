import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildSdodsMcpServer, type BuildServerOptions } from '../server.js';

/** Serve SDODS over stdio (used by `sdods mcp`). Logs go to stderr only. */
export function serveSdodsStdio(opts: BuildServerOptions = {}): { close(): Promise<void> } {
  const built = buildSdodsMcpServer({
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
