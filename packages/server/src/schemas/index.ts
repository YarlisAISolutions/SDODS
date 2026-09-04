import { z } from 'zod';
import {
  BrowserSchema,
  LayerSchema,
  ORG_ROLES,
  ROLES,
  SCOPES,
  SlugSchema,
  WORKSPACE_ROLES,
} from '@automax/contracts';

/** Request/response schemas shared with the web app (type-only import from `@automax/server/schemas`). */

export const LoginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });
export const SetupBody = z.object({
  token: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(8),
  email: z.string().email().optional(),
});

export const CreateUserBody = z.object({
  username: z
    .string()
    .min(3)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8),
  role: z.enum(ROLES).default('viewer'),
  email: z.string().email().optional(),
  orgOwner: z.boolean().optional(),
});
export const PatchUserBody = z.object({
  password: z.string().min(8).optional(),
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

export const OrgMemberBody = z.object({ userId: z.string().min(1), role: z.enum(ORG_ROLES) });
export const WorkspaceMemberBody = z.object({
  userId: z.string().min(1),
  role: z.enum(WORKSPACE_ROLES),
});
export const CreateWorkspaceBody = z.object({
  slug: SlugSchema,
  name: z.string().min(1),
  description: z.string().optional(),
});

export const CreateProjectBody = z.object({
  slug: SlugSchema,
  name: z.string().optional(),
  workspace: SlugSchema.optional(),
  layers: z.array(LayerSchema).optional(),
  browsers: z.array(BrowserSchema).optional(),
  uiUrl: z.string().url().optional(),
  apiUrl: z.string().url().optional(),
  env: z.string().default('local'),
  testId: z.string().optional(),
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
  adapter: z.enum(['claude', 'openai', 'fake']).optional(),
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

export type LoginBody = z.infer<typeof LoginBody>;
export type StartRunBody = z.infer<typeof StartRunBody>;
export type AgentJobBody = z.infer<typeof AgentJobBody>;
export type ScheduleBody = z.infer<typeof ScheduleBody>;
export type CreateTokenBody = z.infer<typeof CreateTokenBody>;
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;
