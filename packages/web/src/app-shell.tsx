import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { SdodsLockup } from './components/sdods-mark';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { UserMenu } from './components/UserMenu';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { useProjects } from './api/queries';
import { RoleBadge, Select, Skeleton, Spinner } from './components/ui';
import { cn } from './lib/utils';
import { readProjectPref, writeProjectPref } from './lib/project-pref';

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
  const ws = useWorkspace();
  const projectsQ = useProjects(ws.workspace?.slug);
  const loc = useLocation();
  const nav = useNavigate();
  const projects = projectsQ.data ?? [];
  const fromUrl = useMemo(() => {
    const m = /^\/projects\/([^/]+)/.exec(loc.pathname);
    return m?.[1] && m[1] !== 'new' ? m[1] : undefined;
  }, [loc.pathname]);
  // The URL wins, then the last project the user picked, then the first one on disk. Without the
  // stored preference the sidebar always snapped back to whatever sorted first, which is what made
  // the reference project look like a default that could not be changed.
  const [preferred, setPreferred] = useState<string | null>(() => readProjectPref());
  const currentProject =
    fromUrl ??
    (preferred && projects.some((p) => p.slug === preferred) ? preferred : projects[0]?.slug);

  useEffect(() => {
    if (currentProject) writeProjectPref(currentProject);
  }, [currentProject]);

  const goToProject = (slug: string) => {
    setPreferred(slug);
    // Keep the section the user is looking at when they switch project, so moving from one
    // project's Runs to another's does not bounce back to Settings.
    const section = fromUrl ? loc.pathname.replace(`/projects/${fromUrl}`, '') : '/edit';
    nav(`/projects/${slug}${section || '/edit'}`);
  };

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
          <SdodsLockup className="h-8" />
        </div>
        <div className="space-y-2 px-3 pb-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide muted">Organization</span>
            <Select
              value={ws.org?.slug ?? ''}
              onChange={(e) => ws.setOrg(e.target.value)}
              aria-label="Organization"
              disabled={ws.loading}
            >
              {ws.loading && <option>Loading…</option>}
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
              {ws.loading && (
                <li className="space-y-1 py-1">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-4/5" />
                </li>
              )}
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
              <div className="mb-1 px-2 text-[10px] uppercase tracking-wide muted">Project</div>
              <div className="mb-1 px-2">
                <Select
                  value={currentProject}
                  onChange={(e) => goToProject(e.target.value)}
                  aria-label="Project"
                  data-testid="project-switcher"
                >
                  {projects.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                  {/* A project in the URL that is not in this workspace still has to render, or
                      the select would silently show the wrong one. */}
                  {!projects.some((p) => p.slug === currentProject) && (
                    <option value={currentProject}>{currentProject}</option>
                  )}
                </Select>
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
        </nav>
        <div className="border-t border-line p-2">
          <UserMenu feedbackUrl={feedbackUrl()} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-5 scrollbar-thin">
        <Outlet />
      </main>
    </div>
  );
}

/** Prefilled GitHub issue form (no backend): feedback goes straight to the maintainers. */
function feedbackUrl(): string {
  const params = new URLSearchParams({
    template: 'feature_request.yml',
    title: '[Feature] ',
    labels: 'enhancement,triage,feedback',
    'sdods-version':
      `web ui ${typeof __SDODS_VERSION__ !== 'undefined' ? __SDODS_VERSION__ : ''}`.trim(),
  });
  return `https://github.com/siri1410/SDODS/issues/new?${params.toString()}`;
}

declare const __SDODS_VERSION__: string | undefined;
