import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  audit,
  deleteSessionById,
  deleteSessionsForUser,
  getUserById,
  getUserPreference,
  hashToken,
  listSessionsForUser,
  setUserPreference,
  updateUser,
} from '@sdods/db';
import { ChangePasswordBody, PatchMeBody } from '../schemas/index.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../errors.js';
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

  // UI preferences, e.g. `runForm:<workspace>:<project>` for the last run selection. Opaque to
  // the server: the web app validates what it reads back against the current project.
  const PREF_KEY = /^[A-Za-z0-9:._-]{1,200}$/;
  const PREF_MAX_BYTES = 16 * 1024;
  const prefKey = (req: FastifyRequest) => {
    const { key } = req.params as { key: string };
    if (!PREF_KEY.test(key)) throw badRequest('Preference keys are 1-200 of A-Z a-z 0-9 : . _ -');
    return key;
  };

  app.get('/api/me/preferences/:key', async (req) => {
    const p = sessionOnly(req);
    const pref = await getUserPreference(app.adb.db, p.userId, prefKey(req));
    return pref ?? { key: prefKey(req), value: null, updatedAt: null };
  });

  app.put('/api/me/preferences/:key', async (req) => {
    const p = sessionOnly(req);
    const key = prefKey(req);
    const { value } = (req.body ?? {}) as { value?: unknown };
    if (value === undefined) throw badRequest('Body must be { "value": … }.');
    if (Buffer.byteLength(JSON.stringify(value)) > PREF_MAX_BYTES)
      throw badRequest(`A preference is at most ${PREF_MAX_BYTES / 1024} KB.`);
    return setUserPreference(app.adb.db, p.userId, key, value);
  });

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
