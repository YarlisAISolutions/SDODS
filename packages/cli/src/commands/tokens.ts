import type { Command } from 'commander';
import { SdodsError } from '@sdods/core';
import { createContext } from '../context.js';
import { collect, json, ok, table, warn } from '../ui.js';

export function register(program: Command) {
  const tokens = program
    .command('tokens')
    .description('API tokens: free, scoped, revocable (used by MCP over HTTP and CI ingest)');

  tokens
    .command('create')
    .description('Create a token for a user; the value is printed once')
    .requiredOption('--user <username>', 'owner')
    .requiredOption('--name <name>', 'label, e.g. ci or mcp-laptop')
    .option('--scopes <list>', 'comma list (default: all scopes of the owner role)', collect, [])
    .option('--expires <days>', 'expiry in days (default: never)')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const db = await import('@sdods/db');
      const adb = await db.openDb();
      try {
        const u = await db.getUserByUsername(adb.db, opts.user);
        if (!u)
          throw new SdodsError('CONFIG_NOT_FOUND', `User ${opts.user} not found.`, {
            exitCode: 2,
          });
        const scopes = opts.scopes.length ? opts.scopes : db.scopesForRole(u.role);
        const created = await db.createApiToken(adb.db, {
          userId: u.id,
          name: opts.name,
          scopes,
          expiresInDays: opts.expires ? Number(opts.expires) : null,
          ownerRole: u.role,
        });
        await db.audit(adb.db, {
          actorType: 'cli',
          action: 'token.create',
          targetType: 'api_token',
          targetId: created.id,
          details: { name: opts.name, scopes: created.scopes },
        });
        if (ctx.opts.json) return json(created);
        ok(`Token ${opts.name} for ${opts.user} (scopes: ${created.scopes.join(', ')})`);
        console.log(`\n  ${created.token}\n`);
        warn('Store it now; it is not shown again. Tokens are free and unlimited.');
      } finally {
        await adb.close();
      }
    });

  tokens
    .command('list')
    .description('List tokens (prefix, scopes, expiry, last use)')
    .option('--user <username>', 'only this user')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const db = await import('@sdods/db');
      const adb = await db.openDb();
      try {
        let userId: string | undefined;
        if (opts.user) {
          const u = await db.getUserByUsername(adb.db, opts.user);
          if (!u)
            throw new SdodsError('CONFIG_NOT_FOUND', `User ${opts.user} not found.`, {
              exitCode: 2,
            });
          userId = u.id;
        }
        const rows = (await db.listApiTokens(adb.db, userId)).map((t) => ({
          id: t.id,
          user: t.username,
          name: t.name,
          prefix: t.prefix,
          scopes: t.scopes.join(','),
          expires: t.expiresAt ?? 'never',
          lastUsed: t.lastUsedAt ?? '',
          revoked: t.revokedAt ? 'yes' : '',
        }));
        if (ctx.opts.json) return json(rows);
        table(rows);
      } finally {
        await adb.close();
      }
    });

  tokens
    .command('revoke <id>')
    .description('Revoke a token by id')
    .action(async (id: string, _opts, cmd) => {
      const ctx = createContext(cmd);
      const db = await import('@sdods/db');
      const adb = await db.openDb();
      try {
        // Reporting success for an id that does not exist reads as "the token is gone" when
        // nothing was checked at all — an operator revoking a leaked token needs the difference.
        const revoked = await db.revokeApiToken(adb.db, id);
        if (revoked) {
          await db.audit(adb.db, {
            actorType: 'cli',
            action: 'token.revoke',
            targetType: 'api_token',
            targetId: id,
          });
        }
        if (ctx.opts.json) return json({ id, revoked });
        if (revoked) ok(`Revoked ${id}`);
        else warn(`No live token with id ${id}; nothing to revoke.`);
      } finally {
        await adb.close();
      }
    });
}
