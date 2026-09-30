import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useRun, useScenario } from '../../api/queries';
import { RunControls } from '../../components/RunControls';
import { useAuth } from '../../auth/AuthContext';
import {
  Badge,
  Button,
  ErrorBox,
  PageHeader,
  Spinner,
  StatusPill,
  TagChip,
} from '../../components/ui';
import { fmtDuration } from '../../lib/utils';
import { StepTimeline } from './StepTimeline';

export function ScenarioPage() {
  const { runId = '', sid = '' } = useParams();
  const q = useScenario(runId, sid);
  const run = useRun(runId);
  const [attemptIdx, setAttemptIdx] = useState<number | null>(null);
  const { canEdit } = useAuth();
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data)
    return (
      <ErrorBox error={q.error ?? new Error('Scenario not found')} retry={() => q.refetch()} />
    );
  const s = q.data;
  const idx = attemptIdx ?? s.attempts.length - 1;
  const attempt = s.attempts[idx]!;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <StatusPill status={s.status} />
            <span>{s.scenarioName}</span>
            {s.exampleIndex != null && <Badge>example {s.exampleIndex + 1}</Badge>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link to={`/runs/${runId}`} className="hover:underline">
              ← run {runId}
            </Link>
            <span className="mono">{s.featureUri}</span>
            <Badge tone="purple">{s.module ?? 'no module'}</Badge>
            <Badge>{s.runnerProject}</Badge>
            <span>{fmtDuration(s.durationMs)}</span>
            {s.tags.map((t) => (
              <TagChip key={t} tag={t} />
            ))}
            {s.issueLinks.map((l) => (
              <a key={l.key} href={l.url} target="_blank" rel="noreferrer">
                <Badge tone={l.status === 'open' ? 'amber' : 'green'}>
                  {l.provider} {l.key} · {l.status}
                </Badge>
              </a>
            ))}
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {run.data && <RunControls run={run.data} scenarios={[s.scenarioName]} />}
            {s.attempts.length > 1 && (
              <div className="flex items-center gap-1 text-xs" role="tablist" aria-label="attempts">
                attempt
                {s.attempts.map((a, i) => (
                  <Button
                    key={a.id}
                    size="sm"
                    role="tab"
                    aria-selected={i === idx}
                    variant={i === idx ? 'primary' : 'default'}
                    onClick={() => setAttemptIdx(i)}
                  >
                    {i + 1} <StatusPill status={a.status} />
                  </Button>
                ))}
              </div>
            )}
          </span>
        }
      />
      {s.flaky && (
        <div className="panel border-amber-500/50 p-2 text-xs">
          This scenario is flaky in this run: it failed and then passed on retry. Consider
          `@retries:` or a healer proposal.
        </div>
      )}
      <StepTimeline
        attempt={attempt}
        projectSlug={run.data?.projectSlug ?? ''}
        fingerprint={s.fingerprint}
        runId={runId}
        runnerProject={s.runnerProject}
        canAcceptBaseline={canEdit()}
      />
    </div>
  );
}
