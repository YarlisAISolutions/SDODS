import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { effectiveWorkspaceRole, type Scope, type WorkspaceRole } from '@sdods/contracts/scopes';
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from '../api/client';
import type { Me } from '../api/types';
import { normalizeMe } from '../api/normalize';

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
  const queryClient = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const m = normalizeMe(await api<Record<string, unknown>>('/api/auth/me'));
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

  /**
   * A session can end while the app is open — it expires, an admin deactivates the user, or the
   * server restarts. Without this, the next request just rendered "AUTH_REQUIRED: Authentication
   * required" inside a shell that still showed the user signed in, with no way back to the login
   * form. Dropping the local session sends the router to /login instead.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      setMe(null);
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

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
      /**
       * Never rejects. The button that calls this discards the promise, so a thrown error used to
       * leave the user signed in with no feedback at all -- the sign-out did nothing.
       *
       * Local state is cleared in `finally` so the UI cannot be left showing an authenticated
       * shell, and the query cache is dropped with it: cached projects, runs and users must not
       * survive into the next session on a shared machine.
       */
      logout: async () => {
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } catch (e) {
          // The server session may still be alive (for example a rejected CSRF token). Say so
          // rather than silently pretending the sign-out worked.
          console.error('Sign out did not reach the server; clearing this browser anyway.', e);
        } finally {
          setCsrfToken(null);
          setMe(null);
          queryClient.clear();
        }
      },
    };
  }, [me, loading, needsSetup, refresh, queryClient]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
