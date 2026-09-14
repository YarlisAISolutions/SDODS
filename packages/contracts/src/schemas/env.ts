import { z } from 'zod';
import {
  EvidencePatchSchema,
  HealConfigSchema,
  PerfBudgetsSchema,
  ScreenshotConfigSchema,
  TimeoutsSchema,
} from './project.js';

export const ApiAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string() }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('header'), name: z.string(), value: z.string() }),
  z.object({
    type: z.literal('oauth-client-credentials'),
    tokenUrl: z.string().url(),
    clientId: z.string(),
    clientSecret: z.string(),
    scope: z.string().optional(),
    audience: z.string().optional(),
  }),
]);

export const EnvUseSchema = z.object({
  locale: z.string().optional(),
  timezoneId: z.string().optional(),
  geolocation: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  permissions: z.array(z.string()).optional(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  ignoreHTTPSErrors: z.boolean().optional(),
  extraHTTPHeaders: z.record(z.string(), z.string()).optional(),
  httpCredentials: z.object({ username: z.string(), password: z.string() }).optional(),
});

/**
 * The mail catcher the email steps read. Only Mailpit today: MailHog's API hands back raw MIME
 * (quoted-printable, nested multiparts) and is unmaintained, so an enum value for it would be a
 * half-working promise. `auth.password` trips the secret-literal check, so it must be `${VAR}`.
 */
export const MailConfigSchema = z.object({
  provider: z.enum(['mailpit']).default('mailpit'),
  url: z.string().url(),
  auth: z
    .object({ type: z.literal('basic'), username: z.string(), password: z.string() })
    .optional(),
  pollIntervalMs: z.number().int().positive().default(1000),
  clockSkewMs: z.number().int().nonnegative().default(2000),
  timeoutSeconds: z.number().int().positive().default(15),
});

export const EnvConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  ui: z.object({ baseUrl: z.string().url() }),
  api: z.object({
    baseUrl: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    auth: ApiAuthSchema.default({ type: 'none' }),
    openapi: z.string().optional(),
  }),
  aliases: z.array(z.string().url()).default([]),
  db: z.object({ driver: z.enum(['sqlite', 'postgres']), url: z.string() }).optional(),
  mail: MailConfigSchema.optional(),
  users: z.object({ poolSize: z.number().int().positive().optional() }).default({}),
  vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  use: EnvUseSchema.default({}),
  screenshots: ScreenshotConfigSchema.partial().optional(),
  evidence: EvidencePatchSchema.optional(),
  heal: HealConfigSchema.partial().optional(),
  timeouts: TimeoutsSchema.partial().optional(),
  perf: z.object({ budgets: PerfBudgetsSchema.partial() }).optional(),
  ci: z.boolean().optional(),
});

export type EnvConfig = z.infer<typeof EnvConfigSchema>;
export type EnvConfigInput = z.input<typeof EnvConfigSchema>;
export type MailConfig = z.infer<typeof MailConfigSchema>;
export type ApiAuthConfig = z.infer<typeof ApiAuthSchema>;
