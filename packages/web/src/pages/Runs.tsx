import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useProjects, useRuns, useStartRun, useProject, useProcesses } from '../api/queries';
import type { RunListItem, StartRunInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  TotalsBar,
} from '../components/ui';
import { DataTable } from '../components/ui/DataTable';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { fmtDuration, fmtRelative, shortSha } from '../lib/utils';

export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const { workspace } = useWorkspace();
  const filters = {
    workspace: workspace?.slug,
    project: params.get('project') ?? undefined,
    env: params.get('env') ?? undefined,
    status: params.get('status') ?? undefined,
    process: params.get('process') ?? undefined,
    module: params.get('module') ?? undefined,
  };
  const q = useRuns(filters);
  const projects = useProjects(workspace?.slug);
  const nav = useNavigate();
  const { canEdit } = useAuth();
  const [starting, setStarting] = useState(false);
  const setF = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Runs"
        subtitle={`${q.data?.total ?? 0} runs in ${workspace?.name ?? 'workspace'}`}
        actions={
          canEdit(workspace?.slug) && (
            <Button variant="primary" data-testid="start-run" onClick={() => setStarting(true)}>
              Start run
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <Select
          className="w-44"
          value={filters.project ?? ''}
          onChange={(e) => setF('project', e.target.value)}
          aria-label="project filter"
        >
          <option value="">{projects.isLoading ? 'Loading projects…' : 'All projects'}</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-36"
          value={filters.status ?? ''}
          onChange={(e) => setF('status', e.target.value)}
          aria-label="status filter"
        >
          <option value="">Any status</option>
          {['queued', 'running', 'passed', 'failed', 'cancelled', 'error'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Input
          className="w-36"
          placeholder="env"
          value={filters.env ?? ''}
          onChange={(e) => setF('env', e.target.value)}
          aria-label="env filter"
        />
        <Input
          className="w-44"
          placeholder="process"
          value={filters.process ?? ''}
          onChange={(e) => setF('process', e.target.value)}
          aria-label="process filter"
        />
        <Input
          className="w-36"
          placeholder="module"
          value={filters.module ?? ''}
          onChange={(e) => setF('module', e.target.value)}
          aria-label="module filter"
        />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : (
        <DataTable<RunListItem>
          data={q.data?.items ?? []}
          onRowClick={(r) => nav(`/runs/${r.id}`)}
          columns={[
            {
              header: 'Status',
              accessorKey: 'status',
              cell: (c) => <StatusPill status={c.getValue<string>()} />,
            },
            {
              header: 'Project',
              accessorKey: 'projectSlug',
              cell: (c) => <span className="mono">{c.getValue<string>()}</span>,
            },
            { header: 'Env', accessorKey: 'env' },
            {
              header: 'Process / tags',
              accessorKey: 'process',
              cell: (c) =>
                c.getValue<string>() ? (
                  <Badge tone="purple">{c.getValue<string>()}</Badge>
                ) : (
                  <span className="mono muted">{c.row.original.tagsExpr ?? '—'}</span>
                ),
            },
            {
              header: 'Layers · browsers',
              id: 'lb',
              cell: (c) =>
                `${c.row.original.layers.join(',')} · ${c.row.original.browsers.join(',') || '—'}`,
            },
            {
              header: 'Results',
              id: 'totals',
              cell: (c) => <TotalsBar totals={c.row.original.totals} />,
            },
            {
              header: 'Trigger',
              accessorKey: 'trigger',
              cell: (c) => <Badge>{c.getValue<string>()}</Badge>,
            },
            {
              header: 'Git',
              id: 'git',
              cell: (c) => (
                <span className="mono muted">
                  {c.row.original.gitBranch} {shortSha(c.row.original.gitSha)}
                </span>
              ),
            },
            {
              header: 'Duration',
              accessorKey: 'durationMs',
              cell: (c) => fmtDuration(c.getValue<number>()),
            },
            {
              header: 'Started',
              accessorKey: 'startedAt',
              cell: (c) => (
                <span title={c.getValue<string>()}>{fmtRelative(c.getValue<string>())}</span>
              ),
            },
          ]}
        />
      )}
      <StartRunDialog
        open={starting}
        onClose={() => setStarting(false)}
        defaultProject={filters.project ?? projects.data?.[0]?.slug}
      />
    </div>
  );
}

export function StartRunDialog({
  open,
  onClose,
  defaultProject,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  defaultProject?: string;
  prefill?: Partial<StartRunInput>;
}) {
  const { workspace } = useWorkspace();
  const projects = useProjects(workspace?.slug);
  const [form, setForm] = useState<StartRunInput>({
    project: defaultProject ?? '',
    env: '',
    tags: '',
    layers: [],
    browsers: [],
    ...prefill,
  });
  const project = useProject(form.project || defaultProject || '');
  const processes = useProcesses(form.project || defaultProject || '');
  const start = useStartRun();
  const nav = useNavigate();
  const { toast } = useToast();
  const p = project.data;
  const submit = () => {
    const input: StartRunInput = {
      ...form,
      project: form.project || defaultProject || '',
      env: form.env || p?.envs.default || '',
      tags: form.tags || undefined,
      layers: form.layers?.length ? form.layers : undefined,
      browsers: form.browsers?.length ? form.browsers : undefined,
      process: form.process || undefined,
    };
    start.mutate(input, {
      onSuccess: (r) => {
        onClose();
        nav(`/runs/${r.runId}`);
      },
      onError: (e) => toast((e as Error).message, 'error'),
    });
  };
  const toggle = <T extends string>(list: T[] | undefined, v: T): T[] =>
    list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Start a run"
      description="Same as `sdods run`. Pick a process to reuse a named recipe, or set tags, layers and browsers by hand."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={start.isPending || !(form.project || defaultProject)}
          >
            {start.isPending ? 'Starting…' : 'Run'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Project">
          <Select
            value={form.project || defaultProject || ''}
            disabled={projects.isLoading}
            onChange={(e) => setForm({ ...form, project: e.target.value, process: undefined })}
          >
            {projects.isLoading && <option>Loading projects…</option>}
            {(projects.data ?? []).map((pr) => (
              <option key={pr.slug} value={pr.slug}>
                {pr.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Environment">
          <Select
            value={form.env || p?.envs.default || ''}
            disabled={project.isLoading}
            onChange={(e) => setForm({ ...form, env: e.target.value })}
          >
            {project.isLoading && <option>Loading environments…</option>}
            {(p?.envs.available ?? []).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </Field>
        <Field label="Process (optional)">
          <Select
            value={form.process ?? ''}
            disabled={processes.isLoading}
            onChange={(e) => setForm({ ...form, process: e.target.value || undefined })}
          >
            {processes.isLoading ? (
              <option>Loading processes…</option>
            ) : (
              <option value="">— manual —</option>
            )}
            {(processes.data ?? []).map((pr) => (
              <option key={pr.name} value={pr.name}>
                {pr.name} ({pr.trigger})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags expression" hint='e.g. "@smoke and not @mock"'>
          <Input
            value={form.tags ?? ''}
            disabled={Boolean(form.process)}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
        </Field>
        <Field label="Layers">
          <div className="flex flex-wrap gap-2 text-sm">
            {(p?.layers ?? ['ui', 'api']).map((l) => (
              <label key={l} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  disabled={Boolean(form.process)}
                  checked={form.layers?.includes(l) ?? false}
                  onChange={() => setForm({ ...form, layers: toggle(form.layers, l) })}
                />{' '}
                {l}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Browsers">
          <div className="flex flex-wrap gap-2 text-sm">
            {(p?.browsers ?? ['chromium']).map((b) => (
              <label key={b} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  disabled={Boolean(form.process)}
                  checked={form.browsers?.includes(b) ?? false}
                  onChange={() => setForm({ ...form, browsers: toggle(form.browsers, b) })}
                />{' '}
                {b}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Workers">
          <Input
            type="number"
            min={1}
            value={form.workers ?? ''}
            onChange={(e) =>
              setForm({ ...form, workers: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </Field>
        <Field label="HAR mode">
          <Select
            value={form.harMode ?? 'off'}
            onChange={(e) =>
              setForm({ ...form, harMode: e.target.value as StartRunInput['harMode'] })
            }
          >
            <option value="off">off (live)</option>
            <option value="replay">replay (offline)</option>
            <option value="update">update (record)</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.headed ?? false}
            onChange={(e) => setForm({ ...form, headed: e.target.checked })}
          />{' '}
          headed (server must have a display)
        </label>
      </div>
      {form.feature && (
        <div className="muted mt-2 text-xs">
          Scoped to <span className="mono">{form.feature}</span>
          {form.scenario && <> › {form.scenario}</>}
        </div>
      )}
      <div className="muted mt-3 text-[11px]">
        Prefer the CLI?{' '}
        <Link to="/settings/mcp" className="underline">
          Use MCP or API tokens
        </Link>{' '}
        to drive the same run from Claude Code or CI.
      </div>
    </Dialog>
  );
}
