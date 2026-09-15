import { MIN_PASSWORD_LENGTH } from '@sdods/contracts/names';
import { z } from 'zod';
import {
  BrowserSchema,
  LayerSchema,
  ORG_ROLES,
  ROLES,
  SCOPES,
  SlugSchema,
  WORKSPACE_ROLES,
} from '@sdods/contracts';

/** Request/response schemas shared with the web app (type-only import from `@sdods/server/schemas`). */

export const LoginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });
export const SetupBody = z.object({
  token: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  email: z.string().email().optional(),
});

export const CreateUserBody = z.object({
  username: z
    .string()
    .min(3)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  role: z.enum(ROLES).default('viewer'),
  email: z.string().email().optional(),
  orgOwner: z.boolean().optional(),
});
export const PatchUserBody = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  email: z.string().email().nullable().optional(),
});

export const CreateTokenBody = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1),
  expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
  userId: z.string().optional(),
});

/** Members can be addressed by user id or by username (the web UI types a username). */
const memberTarget = {
  userId: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
};
export const OrgMemberBody = z
  .object({ ...memberTarget, role: z.enum(ORG_ROLES) })
  .refine((b) => b.userId || b.username, { message: 'userId or username is required' });
export const WorkspaceMemberBody = z
  .object({ ...memberTarget, role: z.enum(WORKSPACE_ROLES) })
  .refine((b) => b.userId || b.username, { message: 'userId or username is required' });
export const CreateWorkspaceBody = z.object({
  slug: SlugSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  /** organization id or slug; optional when the platform has a single organization */
  organization: z.string().optional(),
});

/**
 * Strict on purpose. This used to be a plain `z.object`, and because `parse()` strips unknown keys
 * without complaining, the web form's `description`, `tags`, `routes`, `modules`, `processes`,
 * `screenshots` and whole `envs` object were silently discarded on create -- and its
 * `testIdAttribute` never matched this `testId`. A 400 naming the offending key is the only way
 * that drift stays visible.
 */
export const CreateProjectBody = z.strictObject({
  slug: SlugSchema,
  name: z.string().optional(),
  description: z.string().max(280).optional(),
  workspace: SlugSchema.optional(),
  layers: z.array(LayerSchema).optional(),
  browsers: z.array(BrowserSchema).optional(),
  uiUrl: z.string().url().optional(),
  apiUrl: z.string().url().optional(),
  env: z.string().default('local'),
  testId: z.string().optional(),
});

/** Import kinds. `zip` arrives as multipart instead of this body. */
export const IMPORT_KINDS = ['path', 'git'] as const;

export const ImportProjectBody = z.strictObject({
  kind: z.enum(IMPORT_KINDS),
  /** an absolute path on the server host, or a git URL */
  source: z.string().min(1),
  slug: SlugSchema.optional(),
  workspace: SlugSchema.optional(),
  force: z.boolean().optional(),
  /** validate and report what would happen, without writing */
  dryRun: z.boolean().optional(),
});

export const EnvBody = z.object({
  uiUrl: z.string().url(),
  apiUrl: z.string().url(),
  poolSize: z.number().int().positive().optional(),
  makeDefault: z.boolean().optional(),
});

export const StartRunBody = z.object({
  project: SlugSchema,
  env: z.string().optional(),
  tags: z.string().optional(),
  layers: z.array(LayerSchema).optional(),
  browsers: z.array(BrowserSchema).optional(),
  modules: z.array(z.string()).optional(),
  process: z.string().optional(),
  headed: z.boolean().optional(),
  workers: z.number().int().positive().optional(),
  feature: z.string().optional(),
  scenario: z.string().optional(),
  harMode: z.enum(['off', 'update', 'replay']).optional(),
  strict: z.boolean().optional(),
  projectMatrix: z.boolean().optional(),
  retries: z.number().int().min(0).optional(),
});

export const RunListQuery = z.object({
  project: z.string().optional(),
  status: z.string().optional(),
  env: z.string().optional(),
  process: z.string().optional(),
  workspace: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  before: z.string().optional(),
});

export const FeatureWriteBody = z.object({ content: z.string() });

export const AgentJobBody = z.object({
  project: SlugSchema,
  kind: z.enum(['plan', 'generate', 'heal', 'upgrade', 'review', 'convert']),
  env: z.string().optional(),
  goal: z.string().optional(),
  plan: z.string().optional(),
  scenario: z.string().optional(),
  diff: z.string().optional(),
  spec: z.string().optional(),
  adapter: z.enum(['claude', 'claude-code', 'codex', 'openai', 'ollama', 'fake']).optional(),
  model: z.string().optional(),
  dryRun: z.boolean().optional(),
  budgetUsd: z.number().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
});

export const ScheduleBody = z.object({
  project: SlugSchema,
  name: z.string().min(1),
  cron: z.string().min(5),
  timezone: z.string().default('UTC'),
  env: z.string().optional(),
  tags: z.string().optional(),
  layers: z.array(LayerSchema).optional(),
  browsers: z.array(BrowserSchema).optional(),
  process: z.string().optional(),
  workers: z.number().int().positive().optional(),
  harMode: z.enum(['off', 'update', 'replay']).optional(),
  overlap: z.enum(['skip', 'queue', 'cancel-previous']).default('skip'),
  jitterSeconds: z.number().int().min(0).default(0),
  catchUp: z.boolean().default(false),
  enabled: z.boolean().default(true),
  notify: z.array(z.enum(['github', 'jira', 'webhook'])).default([]),
});

export const IntegrationsBody = z.object({
  github: z.record(z.string(), z.unknown()).optional(),
  jira: z.record(z.string(), z.unknown()).optional(),
  mcp: z.record(z.string(), z.unknown()).optional(),
});

export const CompareQuery = z.object({
  before: z.string().min(1),
  after: z.string().min(1),
  threshold: z.coerce.number().min(0).max(1).default(0.1),
});

/** `names` match `inventory`, `inventory.png` or `<run target>/inventory`; or `all: true`. */
export const AcceptBaselinesBody = z
  .object({
    names: z.array(z.string().min(1)).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((b) => b.all === true || (b.names?.length ?? 0) > 0, {
    message: 'Pass the baseline names to accept, or all: true.',
  })
  .refine((b) => !(b.all && b.names?.length), { message: 'Pass names or all, not both.' });

export type LoginBody = z.infer<typeof LoginBody>;
export type StartRunBody = z.infer<typeof StartRunBody>;
export type AgentJobBody = z.infer<typeof AgentJobBody>;
export type ScheduleBody = z.infer<typeof ScheduleBody>;
export type CreateTokenBody = z.infer<typeof CreateTokenBody>;
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;
