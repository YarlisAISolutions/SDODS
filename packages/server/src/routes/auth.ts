import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import {
  audit,
  countUsers,
  createSession,
  createUser,
  deleteSession,
  getUserByUsername,
  updateUser,
} from '@automax/db';
import { LoginBody, SetupBody } from '../schemas/index.js';
import { badRequest, forbidden, parse, unauthorized } from '../errors.js';
import { SESSION_COOKIE } from '../plugins/auth.js';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    // AUTOMAX_LOGIN_RATE_LIMIT raises the per-IP limit for test rigs (dogfood runs sign in a lot).
    { config: { rateLimit: { max: app.config.loginRateLimit, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(LoginBody, req.body);
      const user = await getUserByUsername(app.adb.db, body.username);
      const ok =
        user &&
        user.active &&
        (await argon2.verify(user.passwordHash, body.password).catch(() => false));
      if (!ok || !user) throw unauthorized('Invalid username or password.');
      const session = await createSession(app.adb.db, {
        userId: user.id,
        ttlMs: app.config.sessionTtlMs,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      await updateUser(app.adb.db, app.adb.driver, user.id, {
        lastLoginAt: new Date().toISOString(),
      });
      await audit(app.adb.db, {
        actorUserId: user.id,
        actorType: 'user',
        action: 'auth.login',
        ip: req.ip,
      });
      reply.setCookie(SESSION_COOKIE, session.token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        signed: true,
        maxAge: Math.floor(app.config.sessionTtlMs / 1000),
      });
      return { user: publicUser(user), csrfToken: session.csrfToken };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.principal?.sessionToken) await deleteSession(app.adb.db, req.principal.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const p = req.principal!;
    const orgs = Object.entries(p.orgRoles).map(([organizationId, role]) => ({
      organizationId,
      role,
    }));
    const workspaces = await app.hierarchy.workspacesForUser(p.userId, p.role).catch(() => []);
    return {
      user: { id: p.userId, username: p.username, role: p.role, via: p.via },
      scopes: p.scopes,
      csrfToken: p.csrfToken ?? null,
      orgs,
      workspaces: workspaces.map((w) => ({
        id: w.id,
        slug: w.slug,
        name: w.name,
        organizationSlug: w.organizationSlug,
        role: w.role,
      })),
    };
  });

  /** First-boot bootstrap: only while no users exist and the one-time token matches. */
  app.get('/api/auth/setup-status', async () => ({
    needsSetup: (await countUsers(app.adb.db)) === 0,
  }));

  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(SetupBody, req.body);
      if ((await countUsers(app.adb.db)) > 0) throw forbidden('Setup already completed.');
      if (!app.setupState.token || body.token !== app.setupState.token)
        throw badRequest('Invalid setup token. Copy it from the `automax serve` output.');
      const id = await createUser(app.adb.db, app.adb.driver, {
        username: body.username,
        passwordHash: await hashPassword(body.password),
        role: 'admin',
        email: body.email ?? null,
      });
      const owned = await app.hierarchy.bootstrapOwner(id);
      app.setupState.token = null;
      await audit(app.adb.db, {
        actorUserId: id,
        actorType: 'user',
        action: 'auth.setup',
        details: { ownerOf: owned },
      });
      const session = await createSession(app.adb.db, {
        userId: id,
        ttlMs: app.config.sessionTtlMs,
        ip: req.ip,
      });
      reply.setCookie(SESSION_COOKIE, session.token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        signed: true,
        maxAge: Math.floor(app.config.sessionTtlMs / 1000),
      });
      return {
        user: { id, username: body.username, role: 'admin' },
        csrfToken: session.csrfToken,
        ownerOf: owned,
      };
    },
  );
}

export function publicUser(u: {
  id: string;
  username: string;
  role: string;
  email?: string | null;
  active?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string | null;
}) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    email: u.email ?? null,
    active: u.active ?? true,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt ?? null,
  };
}
