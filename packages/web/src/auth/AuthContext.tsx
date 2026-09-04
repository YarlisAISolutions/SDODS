import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { effectiveWorkspaceRole, type Scope, type WorkspaceRole } from '@automax/contracts/scopes';
import { api, ApiError, setCsrfToken } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasScope: (scope: Scope) => boolean;
  workspaceRole: (workspaceSlug: string, orgSlug?: string) => WorkspaceRole | null;
  canEdit: (workspaceSlug?: string, orgSlug?: string) => boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/api/auth/me');
      setCsrfToken(m.csrfToken);
      setMe(m);
      setNeedsSetup(false);
    } catch (e) {
      setMe(null);
      setCsrfToken(null);
      if (e instanceof ApiError && e.code === 'SETUP_REQUIRED') setNeedsSetup(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(() => {
    const hasScope = (s: Scope) => Boolean(me?.scopes.includes(s));
    const workspaceRole = (ws: string, org?: string) =>
      me
        ? effectiveWorkspaceRole({
            platformRole: me.user.role,
            orgRole: org ? me.orgRoles[org] : undefined,
            workspaceRole: me.workspaceRoles[ws],
          })
        : null;
    return {
      me,
      loading,
      needsSetup,
      refresh,
      hasScope,
      workspaceRole,
      isAdmin: me?.user.role === 'admin',
      canEdit: (ws, org) => {
        if (!me) return false;
        if (me.user.role === 'admin') return true;
        if (!ws) return me.user.role === 'editor';
        const r = workspaceRole(ws, org);
        return r === 'editor' || r === 'admin';
      },
      login: async (username, password) => {
        await api('/api/auth/login', { json: { username, password } });
        await refresh();
      },
      logout: async () => {
        await api('/api/auth/logout', { method: 'POST' });
        setMe(null);
        setCsrfToken(null);
      },
    };
  }, [me, loading, needsSetup, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
