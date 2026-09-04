import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCancelRun, useRun } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  PageHeader,
  Spinner,
  StatusPill,
  TotalsBar,
} from '../components/ui';
import { Tabs } from '../components/ui/Tabs';
import { fmtDate, fmtDuration, shortSha } from '../lib/utils';
import { ScenarioTree } from './run/ScenarioTree';
import { LiveLog } from './run/LiveLog';

export function RunDetailPage() {
  const { runId = '' } = useParams();
  const q = useRun(runId, true);
  const cancel = useCancelRun();
  const { canEdit } = useAuth();
  const [tab, setTab] = useState('scenarios');
  const run = q.data;
  const live = run?.status === 'running' || run?.status === 'queued';
  const heals = useMemo(() => (run?.scenarios ?? []).filter((s) => s.healed > 0), [run]);
  if (q.isLoading) return <Spinner />;
  if (q.error || !run)
    return <ErrorBox error={q.error ?? new Error('Run not found')} retry={() => q.refetch()} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <StatusPill status={run.status} />
            <span className="mono">{run.projectSlug}</span>
            <span className="muted font-normal">{run.env}</span>
            {run.process && <Badge tone="purple">{run.process}</Badge>}
            {run.suiteTag && <Badge>{run.suiteTag}</Badge>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span className="mono">{run.id}</span>
            <span>{fmtDate(run.startedAt)}</span>
            <span>{fmtDuration(run.durationMs)}</span>
            <span className="mono">
              {run.gitBranch} {shortSha(run.gitSha)}
            </span>
            <span>
              {run.layers.join(', ')} · {run.browsers.join(', ') || 'no browser'}
            </span>
            <TotalsBar totals={run.totals} />
          </span>
        }
        actions={
          <>
            {run.reportPaths.html && (
              <a href={run.reportPaths.html} target="_blank" rel="noreferrer">
                <Button size="sm">HTML report</Button>
              </a>
            )}
            {run.reportPaths.dashboard && (
              <a href={run.reportPaths.dashboard} target="_blank" rel="noreferrer">
                <Button size="sm">Dashboard</Button>
              </a>
            )}
            {run.reportPaths.junit && (
              <a href={run.reportPaths.junit}>
                <Button size="sm">JUnit</Button>
              </a>
            )}
            {run.reportPaths.messages && (
              <a href={run.reportPaths.messages}>
                <Button size="sm">NDJSON</Button>
              </a>
            )}
            {live && canEdit() && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => cancel.mutate(run.id)}
                disabled={cancel.isPending}
              >
                Cancel
              </Button>
            )}
          </>
        }
      />
      <Tabs
        className="min-h-0 flex-1"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="grid gap-3 lg:grid-cols-3">
                <Card title="Command">
                  <pre className="mono whitespace-pre-wrap">{run.command ?? '—'}</pre>
                  <div className="muted mt-2 text-xs">artifacts: {run.artifactsDir ?? '—'}</div>
                  {run.errorText && (
                    <div className="mt-2 text-xs text-red-500">{run.errorText}</div>
                  )}
                </Card>
                <Card title="By module">
                  <ModuleSummary scenarios={run.scenarios} />
                </Card>
                <Card title="By browser">
                  <BrowserSummary scenarios={run.scenarios} />
                </Card>
              </div>
            ),
          },
          {
            value: 'scenarios',
            label: 'Scenarios',
            count: run.scenarios.length,
            content: <ScenarioTree runId={run.id} scenarios={run.scenarios} />,
          },
          { value: 'log', label: 'Log', content: <LiveLog runId={run.id} live={live} /> },
          {
            value: 'heal',
            label: 'Heal',
            count: heals.length,
            content: (
              <Card title="Scenarios with healed locators">
                {heals.length === 0 ? (
                  <div className="muted text-xs">No self-healing happened in this run.</div>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {heals.map((s) => (
                      <li key={s.id}>
                        <Link className="hover:underline" to={`/runs/${run.id}/scenarios/${s.id}`}>
                          {s.featureName} › {s.scenarioName}
                        </Link>{' '}
                        <Badge tone="amber">
                          {s.healed} heal{s.healed > 1 ? 's' : ''}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ),
          },
          {
            value: 'artifacts',
            label: 'Artifacts',
            content: (
              <Card title="Run-level files">
                <ul className="space-y-1 text-sm">
                  {Object.entries(run.reportPaths).map(([k, v]) => (
                    <li key={k}>
                      <a
                        className="text-brand-600 hover:underline"
                        href={v}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {k}
                      </a>{' '}
                      <span className="mono muted text-xs">{v}</span>
                    </li>
                  ))}
                </ul>
                <div className="muted mt-2 text-xs">
                  Per-scenario screenshots, API snapshots, traces and videos are on each scenario
                  page.
                </div>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}

function ModuleSummary({
  scenarios,
}: {
  scenarios: Array<{ module?: string | null; status: string }>;
}) {
  const groups = new Map<string, { passed: number; failed: number; other: number }>();
  for (const s of scenarios) {
    const g = groups.get(s.module ?? '(no module)') ?? { passed: 0, failed: 0, other: 0 };
    if (s.status === 'passed') g.passed++;
    else if (s.status === 'failed' || s.status === 'timedOut') g.failed++;
    else g.other++;
    groups.set(s.module ?? '(no module)', g);
  }
  return (
    <ul className="space-y-1 text-sm">
      {[...groups.entries()].map(([m, g]) => (
        <li key={m} className="flex justify-between">
          <span className="mono">{m}</span>
          <span>
            <span className="status-passed">{g.passed}</span> /{' '}
            <span className="status-failed">{g.failed}</span> /{' '}
            <span className="status-skipped">{g.other}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function BrowserSummary({
  scenarios,
}: {
  scenarios: Array<{ browser?: string; layer: string; status: string }>;
}) {
  const groups = new Map<string, { passed: number; failed: number }>();
  for (const s of scenarios) {
    const k = s.browser ?? s.layer;
    const g = groups.get(k) ?? { passed: 0, failed: 0 };
    if (s.status === 'passed') g.passed++;
    else if (s.status === 'failed') g.failed++;
    groups.set(k, g);
  }
  return (
    <ul className="space-y-1 text-sm">
      {[...groups.entries()].map(([b, g]) => (
        <li key={b} className="flex justify-between">
          <span>{b}</span>
          <span>
            <span className="status-passed">{g.passed}</span> /{' '}
            <span className="status-failed">{g.failed}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
