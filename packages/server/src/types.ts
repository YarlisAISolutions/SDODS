// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SdodsDb } from '@sdods/db';
import type { OrgRole, Role, WorkspaceRole } from '@sdods/contracts';
import type { ProjectRegistry } from '@sdods/core/config';
import type { ServerConfig } from './config.js';
import type { RunManager } from './services/run-manager.js';
import type { Scheduler } from './services/scheduler.js';
import type { AgentManager } from './services/agent-manager.js';
import type { HierarchyService } from './services/hierarchy.js';

export interface Principal {
  userId: string;
  username: string;
  role: Role;
  scopes: string[];
  via: 'session' | 'token' | 'disabled';
  tokenId?: string;
  sessionToken?: string;
  csrfToken?: string;
  /** organizationId → role */
  orgRoles: Record<string, OrgRole>;
  /** workspaceId → explicit role */
  workspaceRoles: Record<string, WorkspaceRole>;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: ServerConfig;
    adb: SdodsDb;
    registry: ProjectRegistry;
    reloadRegistry(): ProjectRegistry;
    runManager: RunManager;
    scheduler: Scheduler;
    agentManager: AgentManager;
    hierarchy: HierarchyService;
    setupState: { token: string | null };
    requireScope(scope: string): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireWorkspaceRole(
      min: WorkspaceRole,
    ): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    workspaceRoleFor(
      principal: Principal,
      workspaceId: string | null,
    ): Promise<WorkspaceRole | null>;
    workspaceRoleForProject(
      principal: Principal,
      projectSlug: string,
    ): Promise<WorkspaceRole | null>;
  }
  interface FastifyRequest {
    principal: Principal | null;
  }
  interface FastifyReply {
    sse(source: AsyncIterable<SseEvent>): FastifyReply;
  }
}

export interface SseEvent {
  event: string;
  data: unknown;
  id?: string | number;
}
