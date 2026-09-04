import { Link } from 'react-router';
import { useProjects } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui';

export function ProjectsPage() {
  const { workspace, org } = useWorkspace();
  const { canEdit } = useAuth();
  const q = useProjects(workspace?.slug);
  const editable = canEdit(workspace?.slug, org?.slug);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const projects = q.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        subtitle={`Workspace ${workspace?.name ?? ''} · ${projects.length} project${projects.length === 1 ? '' : 's'}`}
        actions={
          editable && (
            <Link to="/projects/new">
              <Button variant="primary">New project</Button>
            </Link>
          )
        }
      />
      {projects.length === 0 && (
        <EmptyState
          title="No projects in this workspace"
          hint="Create one here or run `automax project create <slug>` and set `workspace:` in its yaml."
        />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <Card
            key={p.slug}
            title={
              <Link to={`/projects/${p.slug}/edit`} className="hover:underline">
                {p.name}
              </Link>
            }
            actions={<Badge className="mono">{p.slug}</Badge>}
          >
            <div className="muted mb-2 text-xs">{p.description ?? '—'}</div>
            <div className="flex flex-wrap gap-1">
              {p.layers.map((l) => (
                <Badge key={l} tone="blue">
                  {l}
                </Badge>
              ))}
              {p.browsers.map((b) => (
                <Badge key={b}>{b}</Badge>
              ))}
            </div>
            <div className="mt-2 text-xs">
              <span className="muted">modules:</span>{' '}
              {p.modules.map((m) => m.name).join(', ') || '—'}
            </div>
            <div className="text-xs">
              <span className="muted">processes:</span>{' '}
              {p.processes.map((m) => m.name).join(', ') || 'workspace defaults'}
            </div>
            <div className="mt-3 flex flex-wrap gap-1 text-xs">
              <Link to={`/projects/${p.slug}/editor`} className="text-brand-600 hover:underline">
                Editor
              </Link>
              ·
              <Link to={`/runs?project=${p.slug}`} className="text-brand-600 hover:underline">
                Runs
              </Link>
              ·
              <Link to={`/projects/${p.slug}/processes`} className="text-brand-600 hover:underline">
                Processes
              </Link>
              ·
              <Link to={`/projects/${p.slug}/envs`} className="text-brand-600 hover:underline">
                Environments
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
