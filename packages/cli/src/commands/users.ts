import type { Command } from 'commander';
import { SdodsError } from '@sdods/core';
import { MIN_PASSWORD_LENGTH } from '@sdods/contracts/names';
import { ROLES, type Role } from '@sdods/contracts/scopes';
import { createContext } from '../context.js';
import { info, json, ok, table, warn } from '../ui.js';

async function openDb() {
  const db = await import('@sdods/db');
  return db.openDb();
}

function assertPassword(password: unknown) {
  if (String(password).length < MIN_PASSWORD_LENGTH)
    throw new SdodsError(
      'CONFIG_INVALID',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      { exitCode: 2 },
    );
}

export function register(program: Command) {
  const users = program
    .command('users')
    .description('Manage web UI users (stored in the platform database)');

  users
    .command('create')
    .description('Create a user; --admin makes a platform admin and organization owner')
    .requiredOption('--username <name>', 'login name')
    .requiredOption('--password <password>', `password (min ${MIN_PASSWORD_LENGTH} chars)`)
    .option('--admin', 'platform admin + owner of every organization without an owner')
    .option('--role <role>', 'viewer | editor | admin', 'viewer')
    .option('--email <email>', 'email')
    .option('--org-owner', 'grant organization owner on orgs without an owner')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      assertPassword(opts.password);
      const adb = await openDb();
      try {
        const db = await import('@sdods/db');
        const { hashPassword } = await import('@sdods/server');
        if (await db.getUserByUsername(adb.db, opts.username))
          throw new SdodsError('CONFIG_INVALID', `User ${opts.username} already exists.`, {
            exitCode: 2,
          });
        const role = opts.admin ? 'admin' : opts.role;
        if (!['viewer', 'editor', 'admin'].includes(role))
          throw new SdodsError('CONFIG_INVALID', `Unknown role ${role}.`, { exitCode: 2 });
        const id = await db.createUser(adb.db, adb.driver, {
          username: opts.username,
          passwordHash: await hashPassword(opts.password),
          role,
          email: opts.email ?? null,
        });
        // make sure the hierarchy exists before granting ownership
        const { HierarchyService } = await import('@sdods/server');
        const h = new HierarchyService(adb);
        await h.sync(ctx.registry).catch(() => undefined);
        const ownerOf = opts.admin || opts.orgOwner ? await h.bootstrapOwner(id) : [];
        await db.audit(adb.db, {
          actorType: 'cli',
          action: 'user.create',
          targetType: 'user',
          targetId: id,
          details: { username: opts.username, role },
        });
        if (ctx.opts.json) return json({ id, username: opts.username, role, ownerOf });
        ok(
          `Created ${role} user ${opts.username}${ownerOf.length ? ` (owner of ${ownerOf.join(', ')})` : ''}`,
        );
      } finally {
        await adb.close();
      }
    });

  users
    .command('list')
    .description('List users')
    .action(async (_opts, cmd) => {
      const ctx = createContext(cmd);
      const adb = await openDb();
      try {
        const db = await import('@sdods/db');
        const rows = (await db.listUsers(adb.db)).map((u) => ({
          id: u.id,
          username: u.username,
          role: u.role,
          active: u.active,
          email: u.email ?? '',
          lastLogin: u.lastLoginAt ?? '',
        }));
        if (ctx.opts.json) return json(rows);
        table(rows);
      } finally {
        await adb.close();
      }
    });

  users
    .command('set-role <username> <role>')
    .description('Change a platform role (viewer | editor | admin)')
    .action(async (username: string, role: string, _opts, cmd) => {
      const ctx = createContext(cmd);
      // Checked before opening the database: an unknown role used to be accepted and silently
      // left the user's role unchanged while reporting success.
      if (!(ROLES as readonly string[]).includes(role))
        throw new SdodsError(
          'CONFIG_INVALID',
          `Unknown role "${role}". Use one of: ${ROLES.join(', ')}.`,
          { exitCode: 2 },
        );
      const adb = await openDb();
      try {
        const db = await import('@sdods/db');
        const u = await db.getUserByUsername(adb.db, username);
        if (!u)
          throw new SdodsError('CONFIG_NOT_FOUND', `User ${username} not found.`, {
            exitCode: 2,
          });
        await db.updateUser(adb.db, adb.driver, u.id, {
          role: role as Role,
        });
        if (ctx.opts.json) return json({ id: u.id, username, role });
        ok(`${username} is now ${role}`);
      } finally {
        await adb.close();
      }
    });

  users
    .command('deactivate <username>')
    .description('Deactivate a user (sessions and tokens stop working)')
    .action(async (username: string, _opts, cmd) => {
      const ctx = createContext(cmd);
      const adb = await openDb();
      try {
        const db = await import('@sdods/db');
        const u = await db.getUserByUsername(adb.db, username);
        if (!u)
          throw new SdodsError('CONFIG_NOT_FOUND', `User ${username} not found.`, {
            exitCode: 2,
          });
        await db.updateUser(adb.db, adb.driver, u.id, { active: false });
        if (ctx.opts.json) return json({ id: u.id, username, active: false });
        ok(`${username} deactivated`);
      } finally {
        await adb.close();
      }
    });

  users
    .command('set-password <username>')
    .description(
      'Set a password and sign the user out everywhere; --activate re-enables the account',
    )
    .requiredOption('--password <password>', `new password (min ${MIN_PASSWORD_LENGTH} chars)`)
    .option('--activate', 're-enable a deactivated account')
    .action(async (username: string, opts, cmd) => {
      const ctx = createContext(cmd);
      assertPassword(opts.password);
      const adb = await openDb();
      try {
        const db = await import('@sdods/db');
        const { hashPassword } = await import('@sdods/server');
        const u = await db.getUserByUsername(adb.db, username);
        if (!u)
          throw new SdodsError('CONFIG_NOT_FOUND', `User ${username} not found.`, {
            exitCode: 2,
          });
        await db.updateUser(adb.db, adb.driver, u.id, {
          passwordHash: await hashPassword(opts.password),
          ...(opts.activate ? { active: true } : {}),
        });
        await db.deleteSessionsForUser(adb.db, u.id);
        await db.audit(adb.db, {
          actorType: 'cli',
          action: 'user.password',
          targetType: 'user',
          targetId: u.id,
          details: { username, activated: Boolean(opts.activate) },
        });
        const active = opts.activate ? true : u.active;
        if (ctx.opts.json) return json({ id: u.id, username, active });
        ok(`Password set for ${username}; existing sessions signed out`);
        if (!active) warn(`${username} is deactivated; pass --activate to let them sign in`);
      } finally {
        await adb.close();
      }
    });

  users
    .command('reset')
    .description(
      'Remove every user, session, API token and membership; projects and runs stay (next serve offers /setup)',
    )
    .option('--yes', 'confirm')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      if (!opts.yes)
        throw new SdodsError(
          'NOT_SUPPORTED',
          'users reset removes every user; pass --yes to confirm.',
          { exitCode: 2 },
        );
      const adb = await openDb();
      try {
        const db = await import('@sdods/db');
        const removed = await db.deleteAllUsers(adb.db);
        await db.audit(adb.db, {
          actorType: 'cli',
          action: 'users.reset',
          targetType: 'user',
          details: { removed },
        });
        if (ctx.opts.json) return json({ removed });
        ok(
          `Removed ${removed} user${removed === 1 ? '' : 's'}; projects, runs and schedules are kept`,
        );
        info(
          'Restart `sdods serve` for a one-time /setup link, or run: sdods users create --admin --username <name> --password <pw>',
        );
      } finally {
        await adb.close();
      }
    });

  users
    .command('grant <username>')
    .description(
      'Grant a membership role: --org <slug> --role owner|admin|member, or --workspace <slug> --role admin|editor|viewer',
    )
    .option('--org <slug>', 'organization slug')
    .option('--workspace <slug>', 'workspace slug')
    .requiredOption('--role <role>', 'role')
    .action(async (username: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const adb = await openDb();
      try {
        const db = await import('@sdods/db');
        const { HierarchyService } = await import('@sdods/server');
        const h = new HierarchyService(adb);
        await h.sync(ctx.registry);
        const u = await db.getUserByUsername(adb.db, username);
        if (!u)
          throw new SdodsError('CONFIG_NOT_FOUND', `User ${username} not found.`, {
            exitCode: 2,
          });
        if (opts.workspace) {
          const ws = (await h.workspaces()).find((w) => w.slug === opts.workspace);
          if (!ws)
            throw new SdodsError('CONFIG_NOT_FOUND', `Workspace ${opts.workspace} not found.`, {
              exitCode: 2,
            });
          await h.setWorkspaceRole(ws.id, u.id, opts.role);
        } else if (opts.org) {
          const org = (await h.organizations()).find((o) => o.slug === opts.org);
          if (!org)
            throw new SdodsError('CONFIG_NOT_FOUND', `Organization ${opts.org} not found.`, {
              exitCode: 2,
            });
          await h.setOrgRole(org.id, u.id, opts.role);
        } else
          throw new SdodsError('CONFIG_INVALID', 'Pass --org <slug> or --workspace <slug>.', {
            exitCode: 2,
          });
        const list = await h.workspacesForUser(u.id, u.role);
        if (ctx.opts.json) return json(list);
        ok(
          `${username}: ${list.map((w) => `${w.slug}=${w.role}`).join(', ') || '(no workspace access)'}`,
        );
      } finally {
        await adb.close();
      }
    });
}
