import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Cron } from 'croner';
import { api } from '../api/client';
import { useInvalidate, useProjects, useScheduleHistory, useSchedules } from '../api/queries';
import type { Schedule } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
} from '../components/ui';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { fmtDate, fmtRelative } from '../lib/utils';

const PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every night at 02:00', cron: '0 2 * * *' },
  { label: 'Weekdays 07:30', cron: '30 7 * * 1-5' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Sundays 04:00', cron: '0 4 * * 0' },
];

export function nextFireTimes(cron: string, timezone: string, count = 5): Date[] {
  try {
    const job = new Cron(cron, { timezone, paused: true });
    const out = job.nextRuns(count);
    job.stop();
    return out;
  } catch {
    return [];
  }
}

export function describeCron(cron: string): string {
  const preset = PRESETS.find((p) => p.cron === cron);
  if (preset) return preset.label;
  const [m, h, dom, mon, dow] = cron.split(/\s+/);
  if (!m || !h) return 'custom';
  const t = h.includes('*')
    ? m.startsWith('*/')
      ? `every ${m.slice(2)} minutes`
      : `every hour at :${m.padStart(2, '0')}`
    : `at ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  const days =
    dow && dow !== '*' ? ` on days ${dow}` : dom && dom !== '*' ? ` on day ${dom}` : ' daily';
  return `${t}${mon && mon !== '*' ? ` in month ${mon}` : ''}${days}`;
}

export function SchedulesPage() {
  const { slug } = useParams();
  const { workspace } = useWorkspace();
  const projects = useProjects(workspace?.slug);
  const q = useSchedules(slug);
  const { canEdit } = useAuth();
  const inv = useInvalidate();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null);
  const [historyFor, setHistoryFor] = useState<Schedule | null>(null);
  const save = useMutation({
    mutationFn: (s: Partial<Schedule>) =>
      s.id
        ? api(`/api/schedules/${s.id}`, { method: 'PUT', json: s })
        : api('/api/schedules', { json: s }),
    onSuccess: () => {
      inv(['schedules']);
      setEditing(null);
      toast('Schedule saved', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const toggle = useMutation({
    mutationFn: (s: Schedule) =>
      api(`/api/schedules/${s.id}`, { method: 'PUT', json: { enabled: !s.enabled } }),
    onSuccess: () => inv(['schedules']),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => inv(['schedules']),
  });
  const runNow = useMutation({
    mutationFn: (id: string) =>
      api<{ runId: string }>(`/api/schedules/${id}/run-now`, { method: 'POST' }),
    onSuccess: (r) => toast(`Started ${r.runId}`, 'success'),
  });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Schedules"
        subtitle="Cron-driven runs. YAML-managed schedules come from sdods.project.yaml (version-controlled); database ones are edited here. Without a server, `sdods schedule install` writes crontab/launchd/systemd or a GitHub Actions workflow."
        actions={
          canEdit(workspace?.slug) && (
            <Button
              variant="primary"
              onClick={() =>
                setEditing({
                  projectSlug: slug ?? projects.data?.[0]?.slug,
                  name: '',
                  cron: '0 2 * * *',
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  overlap: 'skip',
                  jitterSeconds: 0,
                  catchUp: false,
                  enabled: true,
                  notify: [],
                })
              }
            >
              New schedule
            </Button>
          )
        }
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {(q.data ?? []).map((s) => (
          <Card
            key={s.id}
            title={
              <span className="flex items-center gap-2">
                <span className="mono">{s.name}</span>
                <Badge tone={s.enabled ? 'green' : 'neutral'}>
                  {s.enabled ? 'enabled' : 'paused'}
                </Badge>
                <Badge>{s.source}</Badge>
              </span>
            }
            actions={
              <span className="flex gap-1">
                <Button size="sm" onClick={() => runNow.mutate(s.id)}>
                  Run now
                </Button>
                <Button size="sm" onClick={() => toggle.mutate(s)} disabled={s.source === 'yaml'}>
                  {s.enabled ? 'Pause' : 'Resume'}
                </Button>
                <Button size="sm" onClick={() => setEditing(s)} disabled={s.source === 'yaml'}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setHistoryFor(s)}>
                  History
                </Button>
                {s.source === 'db' && (
                  <Button size="sm" variant="danger" onClick={() => remove.mutate(s.id)}>
                    Delete
                  </Button>
                )}
              </span>
            }
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="muted">project</dt>
              <dd className="mono">{s.projectSlug}</dd>
              <dt className="muted">cron</dt>
              <dd>
                <span className="mono">{s.cron}</span>{' '}
                <span className="muted">
                  — {describeCron(s.cron)} ({s.timezone})
                </span>
              </dd>
              <dt className="muted">run</dt>
              <dd>
                {s.tags ?? '(all)'} · {s.browsers?.join(', ') ?? 'project browsers'} ·{' '}
                {s.harMode ?? 'live'}
              </dd>
              <dt className="muted">policy</dt>
              <dd>
                overlap {s.overlap} · jitter {s.jitterSeconds}s ·{' '}
                {s.catchUp ? 'catch-up' : 'no catch-up'} · notify {s.notify.join(', ') || '—'}
              </dd>
              <dt className="muted">next</dt>
              <dd>
                {nextFireTimes(s.cron, s.timezone, 3).map((d) => (
                  <span key={d.toISOString()} className="mr-2">
                    {fmtDate(d.toISOString())}
                  </span>
                ))}
              </dd>
              <dt className="muted">last</dt>
              <dd>
                {s.lastStatus ? <StatusPill status={s.lastStatus} /> : '—'}{' '}
                {s.lastRunId && <span className="mono muted">{s.lastRunId}</span>}
              </dd>
            </dl>
          </Card>
        ))}
      </div>
      {editing && (
        <ScheduleDialog
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate(editing)}
          projects={(projects.data ?? []).map((p) => p.slug)}
          projectsLoading={projects.isLoading}
        />
      )}
      {historyFor && <HistoryDialog schedule={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function ScheduleDialog({
  value,
  onChange,
  onClose,
  onSave,
  projects,
  projectsLoading,
}: {
  value: Partial<Schedule>;
  onChange: (v: Partial<Schedule>) => void;
  onClose: () => void;
  onSave: () => void;
  projects: string[];
  projectsLoading?: boolean;
}) {
  const next = useMemo(
    () => nextFireTimes(value.cron ?? '', value.timezone ?? 'UTC', 5),
    [value.cron, value.timezone],
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={value.id ? `Edit ${value.name}` : 'New schedule'}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!value.name || next.length === 0}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name">
          <Input
            value={value.name ?? ''}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </Field>
        <Field label="Project">
          <Select
            value={value.projectSlug ?? ''}
            disabled={projectsLoading}
            onChange={(e) => onChange({ ...value, projectSlug: e.target.value })}
          >
            {projectsLoading && <option>Loading projects…</option>}
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field label="Timezone">
          <Input
            value={value.timezone ?? ''}
            onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          />
        </Field>
        <Field
          label="Cron"
          hint={describeCron(value.cron ?? '')}
          error={next.length === 0 ? 'invalid cron expression' : undefined}
        >
          <Input
            className="mono"
            value={value.cron ?? ''}
            onChange={(e) => onChange({ ...value, cron: e.target.value })}
          />
        </Field>
        <Field label="Presets">
          <Select
            value=""
            onChange={(e) => e.target.value && onChange({ ...value, cron: e.target.value })}
          >
            <option value="">choose…</option>
            {PRESETS.map((p) => (
              <option key={p.cron} value={p.cron}>
                {p.label} ({p.cron})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next 5 fire times">
          <ul className="text-xs">
            {next.map((d) => (
              <li key={d.toISOString()}>
                {fmtDate(d.toISOString())}{' '}
                <span className="muted">({fmtRelative(d.toISOString())})</span>
              </li>
            ))}
          </ul>
        </Field>
        <Field label="Tags expression">
          <Input
            value={value.tags ?? ''}
            onChange={(e) => onChange({ ...value, tags: e.target.value })}
          />
        </Field>
        <Field label="Browsers (comma)">
          <Input
            value={value.browsers?.join(', ') ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                browsers: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean) as Schedule['browsers'],
              })
            }
          />
        </Field>
        <Field label="HAR mode">
          <Select
            value={value.harMode ?? 'off'}
            onChange={(e) => onChange({ ...value, harMode: e.target.value as Schedule['harMode'] })}
          >
            <option value="off">off</option>
            <option value="replay">replay</option>
            <option value="update">update</option>
          </Select>
        </Field>
        <Field label="Overlap policy">
          <Select
            value={value.overlap ?? 'skip'}
            onChange={(e) => onChange({ ...value, overlap: e.target.value as Schedule['overlap'] })}
          >
            <option value="skip">skip if still running</option>
            <option value="queue">queue</option>
            <option value="cancel-previous">cancel previous</option>
          </Select>
        </Field>
        <Field label="Jitter (seconds)">
          <Input
            type="number"
            value={value.jitterSeconds ?? 0}
            onChange={(e) => onChange({ ...value, jitterSeconds: Number(e.target.value) })}
          />
        </Field>
        <Field label="Notify">
          <div className="flex gap-3 text-sm">
            {(['github', 'jira', 'webhook'] as const).map((n) => (
              <label key={n} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={value.notify?.includes(n) ?? false}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      notify: e.target.checked
                        ? [...(value.notify ?? []), n]
                        : (value.notify ?? []).filter((x) => x !== n),
                    })
                  }
                />{' '}
                {n}
              </label>
            ))}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.catchUp ?? false}
            onChange={(e) => onChange({ ...value, catchUp: e.target.checked })}
          />{' '}
          catch up missed runs after downtime
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enabled ?? true}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />{' '}
          enabled
        </label>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const h = useScheduleHistory(schedule.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`History · ${schedule.name}`}>
      {h.isLoading ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-[var(--border)] text-sm">
          {(h.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between py-1.5">
              <span>
                <StatusPill status={r.status} /> {fmtDate(r.firedAt)}
              </span>
              {r.runId && (
                <a className="mono text-brand-600 hover:underline" href={`/runs/${r.runId}`}>
                  {r.runId}
                </a>
              )}
            </li>
          ))}
          {h.data?.length === 0 && <li className="muted text-xs">Never fired.</li>}
        </ul>
      )}
    </Dialog>
  );
}
