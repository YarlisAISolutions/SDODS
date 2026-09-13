import type { FastifyInstance } from 'fastify';
import {
  audit,
  countUsers,
  createSession,
  createUser,
  deleteSession,
  getUserByUsername,
  updateUser,
} from '@sdods/db';
import { LoginBody, SetupBody } from '../schemas/index.js';
import { HttpError, badRequest, forbidden, parse, unauthorized } from '../errors.js';
import { SESSION_COOKIE } from '../plugins/auth.js';

import { hashPassword, verifyPassword } from '../services/password.js';

// Re-exported so existing consumers keep importing it from here (index.ts, routes/hierarchy.ts,
// and the CLI's `users create` via @sdods/server).
export { hashPassword, verifyPassword };

/**
 * Failed sign-ins per username. The per-IP limit below trusts whatever address the proxy settings
 * produce, and a forged X-Forwarded-For used to give every guess a fresh address; counting against
 * the account works whatever the network path. Only failures count, and a success clears them.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
    private readonly now = () => Date.now(),
  ) {}
  blocked(username: string): boolean {
    const e = this.failures.get(username.toLowerCase());
    return !!e && e.resetAt > this.now() && e.count >= this.max;
  }
  fail(username: string): void {
    const key = username.toLowerCase();
    const now = this.now();
    if (this.failures.size > 10_000)
      for (const [k, v] of this.failures) if (v.resetAt <= now) this.failures.delete(k);
    const e = this.failures.get(key);
    if (!e || e.resetAt <= now) this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    else e.count++;
  }
  clear(username: string): void {
    this.failures.delete(username.toLowerCase());
  }
}

export async function authRoutes(app: FastifyInstance) {
  const throttle = new LoginThrottle(app.config.loginRateLimit);
  app.post(
    '/api/auth/login',
    // SDODS_LOGIN_RATE_LIMIT raises the per-IP limit for test rigs (dogfood runs sign in a lot).
    { config: { rateLimit: { max: app.config.loginRateLimit, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(LoginBody, req.body);
      if (throttle.blocked(body.username))
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'Too many failed sign-ins. Try again in a minute.',
        );
      const user = await getUserByUsername(app.adb.db, body.username);
      const ok = user && user.active && (await verifyPassword(user.passwordHash, body.password));
      if (!ok || !user) {
        throttle.fail(body.username);
        throw unauthorized('Invalid username or password.');
      }
      throttle.clear(body.username);
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

  /**
   * Idempotent by design: succeeds whether or not a session is present, so a client whose cookie
   * has already expired can still complete a sign-out instead of being told it is unauthenticated.
   * The cookie is cleared unconditionally; the session row is deleted whenever one is identified.
   */
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
        throw badRequest('Invalid setup token. Copy it from the `sdods serve` output.');
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
