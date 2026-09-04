import type { SdodsDb } from '@sdods/db';
import {
  addOrgMember,
  addWorkspaceMember,
  bootstrapOwner,
  effectiveRoleForWorkspace,
  listOrgMembers,
  listOrganizations,
  listUserWorkspaces,
  listWorkspaceMembers,
  listWorkspaces,
  removeOrgMember,
  removeWorkspaceMember,
  setRole,
  syncHierarchy,
  upsertWorkspace,
  type SyncHierarchyResult,
} from '@sdods/db';
import type { OrgRole, Role, WorkspaceRole } from '@sdods/contracts';
import type { ProjectRegistry } from '@sdods/core/config';

/** Keeps the org/workspace/project/module/process tables in sync with the yaml files and exposes membership ops. */
export class HierarchyService {
  constructor(private readonly adb: SdodsDb) {}

  async sync(registry: ProjectRegistry): Promise<SyncHierarchyResult> {
    return syncHierarchy(this.adb.db, this.adb.driver, {
      workspaceFile: registry.workspaceFile,
      projects: registry.entriesList().map((e) => ({ config: e.config, root: e.root })),
    });
  }

  organizations() {
    return listOrganizations(this.adb.db);
  }

  workspaces(organizationId?: string) {
    return listWorkspaces(this.adb.db, organizationId);
  }

  async workspacesForUser(userId: string, platformRole: Role) {
    return listUserWorkspaces(this.adb.db, userId, platformRole);
  }

  async createWorkspace(input: {
    organizationId: string;
    slug: string;
    name: string;
    description?: string | null;
  }) {
    return upsertWorkspace(this.adb.db, input);
  }

  roleFor(userId: string, workspaceId: string, platformRole: Role) {
    return effectiveRoleForWorkspace(this.adb.db, userId, workspaceId, platformRole);
  }

  orgMembers(organizationId: string) {
    return listOrgMembers(this.adb.db, organizationId);
  }
  workspaceMembers(workspaceId: string) {
    return listWorkspaceMembers(this.adb.db, workspaceId);
  }
  addOrgMember(organizationId: string, userId: string, role: OrgRole) {
    return addOrgMember(this.adb.db, organizationId, userId, role);
  }
  removeOrgMember(organizationId: string, userId: string) {
    return removeOrgMember(this.adb.db, organizationId, userId);
  }
  addWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole) {
    return addWorkspaceMember(this.adb.db, workspaceId, userId, role);
  }
  removeWorkspaceMember(workspaceId: string, userId: string) {
    return removeWorkspaceMember(this.adb.db, workspaceId, userId);
  }
  setOrgRole(organizationId: string, userId: string, role: OrgRole) {
    return setRole(this.adb.db, { organizationId, userId, role });
  }
  setWorkspaceRole(workspaceId: string, userId: string, role: WorkspaceRole) {
    return setRole(this.adb.db, { workspaceId, userId, role });
  }
  bootstrapOwner(userId: string) {
    return bootstrapOwner(this.adb.db, userId);
  }
}
