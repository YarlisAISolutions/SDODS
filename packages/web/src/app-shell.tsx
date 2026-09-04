import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useEffect, useMemo } from 'react';
import { useAuth } from './auth/AuthContext';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { useProjects } from './api/queries';
import { Badge, RoleBadge, Select, Spinner } from './components/ui';
import { cn } from './lib/utils';

export function AppShell() {
  const { me, loading, needsSetup } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (loading) return;
    if (needsSetup) nav('/setup', { replace: true });
    else if (!me) nav(`/login?next=${encodeURIComponent(loc.pathname)}`, { replace: true });
  }, [loading, me, needsSetup, nav, loc.pathname]);
  if (loading || !me) return <Spinner label="Signing you in…" />;
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const { me, logout, isAdmin } = useAuth();
  const ws = useWorkspace();
  const projectsQ = useProjects(ws.workspace?.slug);
  const loc = useLocation();
  const currentProject = useMemo(() => {
    const m = /^\/projects\/([^/]+)/.exec(loc.pathname);
    return m?.[1] && m[1] !== 'new' ? m[1] : projectsQ.data?.[0]?.slug;
  }, [loc.pathname, projectsQ.data]);

  const item = (to: string, label: string, opts: { end?: boolean; hidden?: boolean } = {}) =>
    opts.hidden ? null : (
      <NavLink
        to={to}
        end={opts.end}
        className={({ isActive }) =>
          cn(
            'block rounded-md px-2.5 py-1.5 text-sm hover:bg-[var(--panel-2)]',
            isActive && 'bg-brand-500/15 font-medium text-brand-600 dark:text-brand-100',
          )
        }
      >
        {label}
      </NavLink>
    );

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-[var(--panel)]">
        <div className="flex items-center gap-2 px-3 py-3">
          <img src="/automax-logo.svg" alt="AutoMax" className="h-8" />
        </div>
        <div className="space-y-2 px-3 pb-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide muted">Organization</span>
            <Select
              value={ws.org?.slug ?? ''}
              onChange={(e) => ws.setOrg(e.target.value)}
              aria-label="Organization"
            >
              {ws.orgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </Select>
          </label>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide muted">Workspaces</span>
              <NavLink to="/workspaces" className="text-[10px] text-brand-600 hover:underline">
                manage
              </NavLink>
            </div>
            <ul className="mt-1 space-y-0.5" aria-label="Workspaces">
              {ws.workspaces.map((w) => (
                <li key={w.slug}>
                  <button
                    type="button"
                    data-testid={`workspace-${w.slug}`}
                    data-role={w.myRole ?? ''}
                    onClick={() => ws.setWorkspace(w.slug)}
                    className={cn(
                      'flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-[var(--panel-2)]',
                      ws.workspace?.slug === w.slug && 'bg-[var(--panel-2)] font-medium',
                    )}
                  >
                    <span className="truncate">{w.name}</span>
                    <RoleBadge role={w.myRole} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-auto px-3 text-sm scrollbar-thin">
          <div className="space-y-0.5">
            {item('/', 'Dashboard', { end: true })}
            {item('/projects', 'Projects', { end: true })}
            {item('/runs', 'Runs')}
            {item('/agents', 'Agents')}
            {item('/schedules', 'Schedules')}
          </div>
          {currentProject && (
            <div>
              <div className="mb-1 flex items-center gap-1 px-2 text-[10px] uppercase tracking-wide muted">
                Project <Badge>{currentProject}</Badge>
              </div>
              <div className="space-y-0.5">
                {item(`/projects/${currentProject}/edit`, 'Settings')}
                {item(`/projects/${currentProject}/editor`, 'Feature editor')}
                {item(`/projects/${currentProject}/processes`, 'Processes')}
                {item(`/projects/${currentProject}/envs`, 'Environments')}
                {item(`/projects/${currentProject}/datasets`, 'Datasets')}
                {item(`/projects/${currentProject}/pool`, 'User pool')}
                {item(`/projects/${currentProject}/recorder`, 'Recorder')}
                {item(`/projects/${currentProject}/integrations`, 'Integrations')}
                {item(`/projects/${currentProject}/schedules`, 'Schedules')}
              </div>
            </div>
          )}
          <div className="space-y-0.5">
            <div className="px-2 text-[10px] uppercase tracking-wide muted">Account</div>
            {item('/settings/tokens', 'API tokens')}
            {item('/settings/mcp', 'MCP clients')}
            {item('/users', 'Users', { hidden: !isAdmin })}
          </div>
        </nav>
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs">
          <span className="truncate">
            {me?.user.username} <RoleBadge role={me?.user.role} />
          </span>
          <button type="button" onClick={() => void logout()} className="muted hover:underline">
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-5 scrollbar-thin">
        <Outlet />
      </main>
    </div>
  );
}
