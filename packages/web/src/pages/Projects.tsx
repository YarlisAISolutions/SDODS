import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useDeleteProject, useHealth, useProjects } from '../api/queries';
import type { Project } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportProjectDialog } from '../components/project/ImportProjectDialog';
import { NewProjectDialog } from '../components/project/NewProjectDialog';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { clearProjectPref } from '../lib/project-pref';

export function ProjectsPage() {
  const { workspace, org } = useWorkspace();
  const { canEdit, isAdmin } = useAuth();
  const { toast } = useToast();
  const q = useProjects(workspace?.slug);
  const health = useHealth();
  const editable = canEdit(workspace?.slug, org?.slug);

  // `/projects/new` used to be a page of its own. It now redirects here with the dialog open, so
  // bookmarks and the docs' links keep working.
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const remove = useDeleteProject();
  const closeCreate = (open: boolean) => {
    setCreating(open);
    if (!open && params.has('new')) {
      params.delete('new');
      setParams(params, { replace: true });
    }
  };

  // The CLI is a separate package a workspace upgrades on its own, so these two actions can be
  // unavailable against an older binary. Saying why beats an `unknown command` from the server.
  // Only a *known* answer disables anything: when the server could not read the binary's
  // capabilities there is no reason to take the buttons away, and the API still answers clearly.
  const cli = health.data?.cli;
  const known = Boolean(cli?.version);
  const canImport = !known || cli!.projectImport;
  const canDelete = !known || cli!.projectDelete;
  const tooOld = `Your SDODS CLI (${cli?.version ?? 'unknown'}) does not support this yet. Run \`sdods upgrade --apply\` in the workspace.`;

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
            <div className="flex gap-2">
              <Button
                onClick={() => setImporting(true)}
                disabled={!canImport}
                title={canImport ? undefined : tooOld}
                data-testid="import-project-open"
              >
                Import project
              </Button>
              <Button
                variant="primary"
                onClick={() => setCreating(true)}
                data-testid="new-project-open"
              >
                New project
              </Button>
            </div>
          )
        }
      />
      {projects.length === 0 && (
        <EmptyState
          title="No projects in this workspace"
          hint={
            editable
              ? 'Create one, import a project you already have, or run `sdods project create <slug>` and set `workspace:` in its yaml.'
              : 'Ask an editor to create one, or run `sdods project create <slug>` and set `workspace:` in its yaml.'
          }
          action={
            editable ? (
              <div className="flex justify-center gap-2">
                <Button onClick={() => setImporting(true)} disabled={!canImport}>
                  Import project
                </Button>
                <Button variant="primary" onClick={() => setCreating(true)}>
                  New project
                </Button>
              </div>
            ) : undefined
          }
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
            <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
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
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setPendingDelete(p)}
                  disabled={!canDelete}
                  title={canDelete ? undefined : tooOld}
                  className="ml-auto text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                  data-testid={`delete-${p.slug}`}
                >
                  Delete
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <NewProjectDialog open={creating} onOpenChange={closeCreate} />
      <ImportProjectDialog open={importing} onOpenChange={setImporting} />
      <DeleteProjectDialog
        project={pendingDelete}
        onClose={() => setPendingDelete(null)}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={(slug) =>
          remove.mutate(slug, {
            onSuccess: (res) => {
              toast(`Deleted ${slug}`, 'success');
              clearProjectPref(slug);
              setPendingDelete(null);
              if (res.trashedTo) toast(`Moved to ${res.trashedTo}`);
            },
          })
        }
      />
    </div>
  );
}

/** Shared by the projects list and the settings page's danger zone. */
export function DeleteProjectDialog({
  project,
  onClose,
  pending,
  error,
  onConfirm,
}: {
  project: Project | null;
  onClose: () => void;
  pending: boolean;
  error: unknown;
  onConfirm: (slug: string) => void;
}) {
  return (
    <ConfirmDialog
      open={Boolean(project)}
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${project?.name ?? ''}?`}
      description="The project folder moves to .sdods/trash so you can put it back by hand."
      confirmText={project?.slug}
      confirmLabel="Delete project"
      pending={pending}
      error={error}
      onConfirm={() => project && onConfirm(project.slug)}
    >
      <ul className="muted space-y-1 text-xs">
        <li>
          · <span className="mono">projects/{project?.slug}</span> — features, steps, pages and
          recorded specs — is moved out of the workspace.
        </li>
        <li>· Its schedules are removed, so nothing keeps firing for a project that is gone.</li>
        <li>· Past runs and reports stay in Runs history.</li>
      </ul>
    </ConfirmDialog>
  );
}
