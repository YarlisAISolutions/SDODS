import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
  toJSON() {
    return {
      error: { code: this.code, message: this.message, hint: this.hint, details: this.details },
    };
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', msg, undefined, details);
export const unauthorized = (msg = 'Authentication required.') =>
  new HttpError(401, 'AUTH_REQUIRED', msg, 'Log in or pass Authorization: Bearer <token>.');
export const forbidden = (msg = 'Insufficient permissions.') =>
  new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);
export const unprocessable = (msg: string, details?: unknown) =>
  new HttpError(422, 'UNPROCESSABLE', msg, undefined, details);

/** Validate with zod; 400 with issues on failure. */
export function parse<T extends ZodType>(schema: T, value: unknown, where = 'body'): T['_output'] {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw badRequest(
      `Invalid ${where}.`,
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export function errorHandler(error: unknown, _req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) return reply.code(error.statusCode).send(error.toJSON());
  if (error instanceof ZodError) {
    return reply
      .code(400)
      .send({ error: { code: 'BAD_REQUEST', message: 'Invalid input.', details: error.issues } });
  }
  const e = error as { statusCode?: number; code?: string; message?: string; validation?: unknown };
  if (e?.statusCode && e.statusCode < 500) {
    return reply.code(e.statusCode).send({
      error: {
        code: e.code ?? 'BAD_REQUEST',
        message: e.message ?? 'Bad request',
        details: e.validation,
      },
    });
  }
  const anyErr = error as { code?: string; message?: string; hint?: string; exitCode?: number };
  if (anyErr && typeof anyErr.code === 'string' && anyErr.code !== 'ERR_INTERNAL') {
    // AutomaxError from core/cli: config/usage errors are 4xx
    const status =
      anyErr.exitCode === 2 || anyErr.code.endsWith('NOT_FOUND') || anyErr.code.startsWith('CONFIG')
        ? 400
        : 500;
    return reply
      .code(status)
      .send({ error: { code: anyErr.code, message: anyErr.message, hint: anyErr.hint } });
  }
  _req.log.error(error);
  return reply
    .code(500)
    .send({ error: { code: 'INTERNAL', message: (error as Error)?.message ?? 'Internal error' } });
}
