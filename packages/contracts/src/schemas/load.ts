import { z } from 'zod';

/**
 * Load testing is opt-in per environment. Load against a shared or production environment is
 * destructive, and load against an environment that caps writes measures the cap rather than the
 * system, so `sdods load` refuses to run unless the environment says `load.allowed: true`.
 */
export const EnvLoadSchema = z.object({
  /** The environment is sized for load and owned by the team running it. */
  allowed: z.boolean().default(false),
  /** Refuse profiles whose peak virtual users exceed this. */
  maxVus: z.number().int().positive().optional(),
  /** Allow POST, PUT, PATCH and DELETE requests; read-only profiles need nothing. */
  allowWrites: z.boolean().default(false),
});

/** k6 duration: `30s`, `1m30s`, `500ms`, `2h`. */
export const K6DurationSchema = z
  .string()
  .regex(/^(\d+(\.\d+)?(ms|s|m|h))+$/, 'expected a k6 duration such as 30s, 1m30s or 500ms');

export const LOAD_READ_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;
export const LOAD_METHODS = [...LOAD_READ_METHODS, 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const LoadRequestSchema = z.object({
  /** Shown in k6 output and used as the request's `name` tag. Defaults to `METHOD path`. */
  name: z.string().min(1).optional(),
  method: z
    .string()
    .transform((m) => m.toUpperCase())
    .pipe(z.enum(LOAD_METHODS))
    .default('GET'),
  /** Relative to the environment's `api.baseUrl`; absolute URLs are refused. */
  path: z
    .string()
    .min(1)
    .refine((p) => p.startsWith('/'), 'path must start with "/" (it is relative to api.baseUrl)'),
  headers: z.record(z.string(), z.string()).default({}),
  /** A string is sent as-is; an object or array is sent as JSON. `${VAR}` reads `__ENV`. */
  body: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  expect: z
    .object({
      status: z
        .union([z.number().int(), z.array(z.number().int()).min(1)])
        .default(200)
        .transform((s) => (Array.isArray(s) ? s : [s])),
      bodyContains: z.string().optional(),
      maxDurationMs: z.number().positive().optional(),
    })
    .default({ status: [200] }),
});

export const LoadStageSchema = z.object({
  duration: K6DurationSchema,
  target: z.number().int().nonnegative(),
});

/** `projects/<slug>/load/<name>.yaml` */
export const LoadProfileSchema = z
  .object({
    description: z.string().optional(),
    /** `env` sends the environment's `api.auth` and `api.headers`; `none` sends neither. */
    auth: z.enum(['env', 'none']).default('env'),
    /** Pause between iterations of one virtual user, in seconds. */
    thinkTimeSeconds: z.number().nonnegative().default(1),
    vus: z.number().int().positive().optional(),
    duration: K6DurationSchema.optional(),
    iterations: z.number().int().positive().optional(),
    stages: z.array(LoadStageSchema).min(1).optional(),
    /** k6 thresholds, e.g. `http_req_duration: ['p(95)<500']`. A single string is accepted. */
    thresholds: z
      .record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))
      .default({})
      .transform((t) =>
        Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])),
      ),
    requests: z.array(LoadRequestSchema).min(1),
  })
  .superRefine((p, ctx) => {
    if (p.stages && (p.duration || p.iterations || p.vus)) {
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'use either stages, or vus with duration or iterations — not both',
      });
    }
    if (!p.stages && !(p.vus && (p.duration || p.iterations))) {
      ctx.addIssue({
        code: 'custom',
        path: ['vus'],
        message: 'set stages, or vus with duration or iterations',
      });
    }
  });

export type EnvLoadConfig = z.infer<typeof EnvLoadSchema>;
export type LoadRequest = z.infer<typeof LoadRequestSchema>;
export type LoadProfile = z.infer<typeof LoadProfileSchema>;
export type LoadProfileInput = z.input<typeof LoadProfileSchema>;
