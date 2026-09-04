import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useOrgs, useWorkspaces } from '../api/queries';
import type { Organization, Workspace } from '../api/types';
import { readPref, writePref } from '../lib/utils';

interface WorkspaceState {
  orgs: Organization[];
  org: Organization | null;
  setOrg: (slug: string) => void;
  workspaces: Workspace[];
  workspace: Workspace | null;
  setWorkspace: (slug: string) => void;
  loading: boolean;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const orgsQ = useOrgs();
  const [orgSlug, setOrgSlug] = useState<string | null>(() => readPref<string | null>('org', null));
  const org = useMemo(
    () => orgsQ.data?.find((o) => o.slug === orgSlug) ?? orgsQ.data?.[0] ?? null,
    [orgsQ.data, orgSlug],
  );
  const wsQ = useWorkspaces(org?.slug);
  const [wsSlug, setWsSlug] = useState<string | null>(() =>
    readPref<string | null>('workspace', null),
  );
  const workspace = useMemo(
    () => wsQ.data?.find((w) => w.slug === wsSlug) ?? wsQ.data?.[0] ?? null,
    [wsQ.data, wsSlug],
  );

  useEffect(() => {
    if (org) writePref('org', org.slug);
  }, [org]);
  useEffect(() => {
    if (workspace) writePref('workspace', workspace.slug);
  }, [workspace]);

  const value = useMemo<WorkspaceState>(
    () => ({
      orgs: orgsQ.data ?? [],
      org,
      setOrg: (s) => {
        setOrgSlug(s);
        setWsSlug(null);
      },
      workspaces: wsQ.data ?? [],
      workspace,
      setWorkspace: setWsSlug,
      loading: orgsQ.isLoading || wsQ.isLoading,
    }),
    [orgsQ.data, orgsQ.isLoading, org, wsQ.data, wsQ.isLoading, workspace],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
