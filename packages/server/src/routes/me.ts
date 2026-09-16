import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  audit,
  deleteSessionById,
  deleteSessionsForUser,
  getUserById,
  hashToken,
  listSessionsForUser,
  updateUser,
} from '@sdods/db';
import { ChangePasswordBody, PatchMeBody } from '../schemas/index.js';
import { HttpError, forbidden, notFound, parse } from '../errors.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import type { Principal } from '../types.js';
import { publicUser } from './auth.js';

/**
 * The signed-in user's own account: profile, password and sessions. Every route needs a browser
 * session. A leaked API token must not be able to change the password or sign its owner out, so
 * bearer callers get 403 here, the same rule as minting tokens.
 */
export async function meRoutes(app: FastifyInstance) {
  const sessionOnly = (req: FastifyRequest): Principal & { sessionToken: string } => {
    const p = req.principal!;
    if (p.via !== 'session' || !p.sessionToken)
      throw forbidden('Account settings need a browser session, not an API token.');
    return p as Principal & { sessionToken: string };
  };

  app.patch('/api/me', async (req) => {
    const p = sessionOnly(req);
    const body = parse(PatchMeBody, req.body);
    const clean = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
    await updateUser(app.adb.db, app.adb.driver, p.userId, {
      displayName: clean(body.displayName),
      email: clean(body.email),
    });
    await audit(app.adb.db, {
      actorUserId: p.userId,
      actorType: 'user',
      action: 'user.profile.update',
      targetType: 'user',
      targetId: p.userId,
      details: { fields: Object.keys(body) },
      ip: req.ip,
    });
    const user = await getUserById(app.adb.db, p.userId);
    if (!user) throw notFound('User');
    return publicUser(user);
  });

  app.post(
    '/api/me/password',
    // A stolen session could otherwise guess the current password without limit.
    { config: { rateLimit: { max: app.config.loginRateLimit, timeWindow: '1 minute' } } },
    async (req) => {
      const p = sessionOnly(req);
      const body = parse(ChangePasswordBody, req.body);
      const user = await getUserById(app.adb.db, p.userId);
      if (!user) throw notFound('User');
      // 400, not 401: the session is fine, and a 401 would make the web client sign the user out.
      if (!(await verifyPassword(user.passwordHash, body.currentPassword)))
        throw new HttpError(400, 'INVALID_PASSWORD', 'The current password is not correct.');
      await updateUser(app.adb.db, app.adb.driver, p.userId, {
        passwordHash: await hashPassword(body.newPassword),
      });
      const signedOut = await deleteSessionsForUser(app.adb.db, p.userId, {
        exceptToken: p.sessionToken,
      });
      await audit(app.adb.db, {
        actorUserId: p.userId,
        actorType: 'user',
        action: 'user.password.change',
        targetType: 'user',
        targetId: p.userId,
        details: { otherSessionsSignedOut: signedOut },
        ip: req.ip,
      });
      return { ok: true, otherSessionsSignedOut: signedOut };
    },
  );

  app.get('/api/me/sessions', async (req) => {
    const p = sessionOnly(req);
    const current = hashToken(p.sessionToken);
    return (await listSessionsForUser(app.adb.db, p.userId)).map((s) => ({
      ...s,
      current: s.id === current,
    }));
  });

  app.delete('/api/me/sessions/:id', async (req) => {
    const p = sessionOnly(req);
    const { id } = req.params as { id: string };
    if (id === hashToken(p.sessionToken))
      throw new HttpError(
        400,
        'CURRENT_SESSION',
        'This is the session you are using.',
        'Use Sign out to end it.',
      );
    if (!(await deleteSessionById(app.adb.db, p.userId, id))) throw notFound('Session');
    await audit(app.adb.db, {
      actorUserId: p.userId,
      actorType: 'user',
      action: 'user.session.revoke',
      targetType: 'session',
      targetId: id,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.post('/api/me/sessions/revoke-others', async (req) => {
    const p = sessionOnly(req);
    const revoked = await deleteSessionsForUser(app.adb.db, p.userId, {
      exceptToken: p.sessionToken,
    });
    await audit(app.adb.db, {
      actorUserId: p.userId,
      actorType: 'user',
      action: 'user.session.revoke-others',
      targetType: 'user',
      targetId: p.userId,
      details: { revoked },
      ip: req.ip,
    });
    return { ok: true, revoked };
  });
}
