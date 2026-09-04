import { Link } from 'react-router';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useProposals, useRuns, useTrends } from '../api/queries';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  Badge,
  Card,
  ErrorBox,
  PageHeader,
  Spinner,
  StatusPill,
  TotalsBar,
} from '../components/ui';
import { fmtDuration, fmtRelative, pct } from '../lib/utils';

export function DashboardPage() {
  const { workspace } = useWorkspace();
  const trends = useTrends({ workspace: workspace?.slug, days: 14 });
  const runs = useRuns({ workspace: workspace?.slug, limit: '10' });
  const proposals = useProposals();
  if (trends.isLoading) return <Spinner />;
  if (trends.error) return <ErrorBox error={trends.error} retry={() => trends.refetch()} />;
  const t = trends.data!;
  const series = t.runs.map((r) => ({
    ...r,
    day: new Date(r.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    passPct: Math.round(r.passRate * 100),
    flakyPct: Math.round(r.flakyRate * 1000) / 10,
    minutes: Math.round(r.durationMs / 60_000),
  }));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={`Workspace ${workspace?.name ?? ''} · last 14 days`}
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Pass rate">
          <div className="h-40">
            <ResponsiveContainer>
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis domain={[80, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="passPct"
                  stroke="#16a34a"
                  fill="#16a34a33"
                  name="pass %"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Duration (minutes)">
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="minutes"
                  stroke="#6366f1"
                  dot={false}
                  name="minutes"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Flaky rate">
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="flakyPct"
                  stroke="#d97706"
                  dot={false}
                  name="flaky %"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Suite health by process">
          <ul className="space-y-2 text-sm">
            {t.health.map((h) => (
              <li key={h.process}>
                <div className="flex justify-between">
                  <span className="mono">{h.process}</span>
                  <span
                    className={
                      h.score >= 0.95
                        ? 'status-passed'
                        : h.score >= 0.85
                          ? 'status-flaky'
                          : 'status-failed'
                    }
                  >
                    {pct(h.score)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded bg-slate-500/20">
                  <div className="h-1.5 rounded bg-brand-500" style={{ width: pct(h.score) }} />
                </div>
                <div className="muted mt-0.5 text-[11px]">
                  pass {pct(h.passRate)} · flaky {pct(h.flaky, 1)} · locator fragility{' '}
                  {pct(h.fragility, 1)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Top flaky scenarios">
          <ul className="space-y-1.5 text-sm">
            {t.flaky.map((f) => (
              <li
                key={`${f.fingerprint}-${f.runnerProject}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {f.scenarioName}{' '}
                  <span className="muted text-[11px]">{f.runnerProject.split('--').pop()}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Badge tone="amber">{pct(f.flakyRate)}</Badge>
                  {f.quarantined && <Badge tone="red">quarantined</Badge>}
                </span>
              </li>
            ))}
            {t.flaky.length === 0 && (
              <li className="muted text-xs">No flaky scenarios in the window.</li>
            )}
          </ul>
        </Card>
        <Card title="Most-failing locators">
          <ul className="space-y-1.5 text-xs">
            {t.locators.map((l) => (
              <li key={l.selector}>
                <div className="flex justify-between">
                  <span className="mono truncate">{l.selector}</span>
                  <span>
                    <Badge tone="red">{l.failCount} fails</Badge>{' '}
                    <Badge tone="amber">{l.healCount} heals</Badge>
                  </span>
                </div>
                {l.suggestedSelector && <div className="muted mono">→ {l.suggestedSelector}</div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card
          title="Latest runs"
          className="lg:col-span-2"
          actions={
            <Link to="/runs" className="text-xs text-brand-600 hover:underline">
              All runs
            </Link>
          }
        >
          <ul className="divide-y divide-[var(--border)] text-sm">
            {(runs.data?.items ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                <Link to={`/runs/${r.id}`} className="flex items-center gap-2 hover:underline">
                  <StatusPill status={r.status} />
                  <span className="mono">{r.projectSlug}</span>
                  <span className="muted">{r.env}</span>
                  {r.process && <Badge tone="purple">{r.process}</Badge>}
                </Link>
                <span className="flex items-center gap-3">
                  <TotalsBar totals={r.totals} />
                  <span className="muted text-xs">
                    {fmtDuration(r.durationMs)} · {fmtRelative(r.startedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Proposals inbox"
          actions={
            <Link to="/agents" className="text-xs text-brand-600 hover:underline">
              Review
            </Link>
          }
        >
          <ul className="space-y-1.5 text-sm">
            {(proposals.data ?? [])
              .filter((p) => p.status === 'pending')
              .map((p) => (
                <li key={p.id}>
                  <Badge tone="purple">{p.role}</Badge> <span>{p.summary}</span>
                </li>
              ))}
            {(proposals.data ?? []).filter((p) => p.status === 'pending').length === 0 && (
              <li className="muted text-xs">Nothing awaiting review.</li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
