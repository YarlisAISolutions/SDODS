import { useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { useInvalidate, useProcesses, useProject } from '../api/queries';
import type { ProcessView } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, ErrorBox, PageHeader, Spinner, StatusPill } from '../components/ui';
import { DataTable } from '../components/ui/DataTable';
import { useToast } from '../components/ui/Toast';
import { fmtRelative } from '../lib/utils';

export function ProcessesPage() {
  const { slug = '' } = useParams();
  const q = useProcesses(slug);
  const project = useProject(slug);
  const { canEdit } = useAuth();
  const editable = canEdit(project.data?.workspace, project.data?.organization);
  const inv = useInvalidate();
  const nav = useNavigate();
  const { toast } = useToast();
  const run = useMutation({
    mutationFn: (name: string) =>
      api<{ runId: string }>(`/api/projects/${slug}/processes/${name}/run`, { method: 'POST' }),
    onSuccess: (r) => {
      inv(['runs'], ['processes', slug]);
      toast('Run started', 'success');
      nav(`/runs/${r.runId}`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Processes"
        subtitle="Named run recipes. Workspace defaults apply unless the project defines the same name. CLI: automax run --process <name>"
      />
      <DataTable<ProcessView>
        data={q.data ?? []}
        columns={[
          {
            header: 'Name',
            accessorKey: 'name',
            cell: (c) => <span className="mono font-medium">{c.getValue<string>()}</span>,
          },
          {
            header: 'Trigger',
            accessorKey: 'trigger',
            cell: (c) => <Badge tone="purple">{c.getValue<string>()}</Badge>,
          },
          {
            header: 'Tags',
            accessorKey: 'tags',
            cell: (c) => <span className="mono">{c.getValue<string>() ?? '—'}</span>,
          },
          {
            header: 'Layers',
            accessorKey: 'layers',
            cell: (c) => c.getValue<string[] | undefined>()?.join(', ') ?? 'all',
          },
          {
            header: 'Browsers',
            accessorKey: 'browsers',
            cell: (c) => c.getValue<string[] | undefined>()?.join(', ') ?? 'project',
          },
          {
            header: 'Gates',
            accessorKey: 'gates',
            cell: (c) => {
              const g = c.getValue<ProcessView['gates']>();
              const row = c.row.original;
              const parts = [
                g.minPassRate != null && `pass ≥ ${g.minPassRate}%`,
                g.maxFlaky != null && `flaky ≤ ${g.maxFlaky}`,
                g.perfBudgets && 'perf',
                g.a11y && 'a11y',
                row.failOnFlaky && 'fail-on-flaky',
              ].filter(Boolean);
              return parts.length ? parts.join(' · ') : '—';
            },
          },
          {
            header: 'Source',
            accessorKey: 'source',
            cell: (c) => <Badge>{c.getValue<string>()}</Badge>,
          },
          {
            header: 'Last run',
            accessorKey: 'lastStatus',
            cell: (c) =>
              c.getValue<string | null>() ? (
                <span className="flex items-center gap-1">
                  <StatusPill status={c.getValue<string>()} />{' '}
                  <span className="muted text-xs">{fmtRelative(c.row.original.lastRunAt)}</span>
                </span>
              ) : (
                <span className="muted">never</span>
              ),
          },
          {
            header: '',
            id: 'actions',
            cell: (c) => (
              <Button
                size="sm"
                variant="primary"
                disabled={!editable || run.isPending}
                onClick={() => run.mutate(c.row.original.name)}
              >
                Run
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
