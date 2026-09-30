import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCancelRun, useRerunRun } from '../api/queries';
import type { RunStatus, RunTotals } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui';
import { useToast } from './ui/Toast';

export const isLiveRun = (status?: RunStatus | string) =>
  status === 'running' || status === 'queued';

/**
 * Stop, Rerun and Rerun failed for one run: the run detail header, each row of the runs table,
 * the scenario page and the feature editor's run bar all use this, so the rules live in one place.
 *
 * - Stop shows while the run is queued or running. It ends the whole process tree (the CLI,
 *   Playwright, its workers and browsers), on Windows too, so it asks first.
 * - Rerun replays the run's full selection (env, tags, layers, browsers, feature, workers…).
 * - Rerun failed runs only the scenarios that failed; shown when there are any.
 * - `scenarios` narrows Rerun to named scenarios (the scenario page reruns the one it shows).
 */
export function RunControls({
  run,
  scenarios,
  onStarted,
  size = 'sm',
  stopPropagation = false,
  compact = false,
}: {
  run: { id: string; status: RunStatus | string; totals?: Partial<RunTotals> };
  scenarios?: string[];
  /** Called with the new run's id instead of navigating to it. */
  onStarted?: (runId: string) => void;
  size?: 'sm' | 'md';
  /** Inside a clickable table row: keep clicks from opening the row. */
  stopPropagation?: boolean;
  /** One button only (Stop or Rerun), for table rows; Rerun failed lives on the run's own page. */
  compact?: boolean;
}) {
  const { canEdit } = useAuth();
  const cancel = useCancelRun();
  const rerun = useRerunRun();
  const nav = useNavigate();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  if (!canEdit()) return null;

  const live = isLiveRun(run.status);
  const failed = (run.totals?.failed ?? 0) + (run.totals?.timedOut ?? 0);
  const guard = (fn: () => void) => (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    fn();
  };
  const start = (scope: 'all' | 'failed') =>
    rerun.mutate(
      { runId: run.id, scope, scenarios },
      {
        onSuccess: (r) => {
          toast(scope === 'failed' ? 'Rerunning the failed scenarios' : 'Rerun started', 'success');
          if (onStarted) onStarted(r.runId);
          else nav(`/runs/${r.runId}`);
        },
        onError: (e) => toast((e as Error).message, 'error'),
      },
    );

  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      onClick={(e) => stopPropagation && e.stopPropagation()}
    >
      {live ? (
        <Button
          size={size}
          variant="danger"
          data-testid="stop-run"
          disabled={cancel.isPending}
          onClick={guard(() => setConfirming(true))}
        >
          Stop
        </Button>
      ) : (
        <>
          <Button
            size={size}
            data-testid="rerun"
            disabled={rerun.isPending}
            title={scenarios?.length ? 'Run this scenario again' : 'Run the same selection again'}
            onClick={guard(() => start('all'))}
          >
            {scenarios?.length === 1 ? 'Rerun scenario' : 'Rerun'}
          </Button>
          {failed > 0 && !scenarios?.length && !compact && (
            <Button
              size={size}
              data-testid="rerun-failed"
              disabled={rerun.isPending}
              title="Run only the scenarios that failed"
              onClick={guard(() => start('failed'))}
            >
              Rerun failed ({failed})
            </Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Stop this run?"
        description="Playwright, its workers and their browsers are stopped. Results so far are kept."
        confirmLabel="Stop run"
        pending={cancel.isPending}
        error={cancel.error}
        onConfirm={() =>
          cancel.mutate(run.id, {
            onSuccess: () => {
              setConfirming(false);
              toast('Run stopped', 'info');
            },
          })
        }
      />
    </span>
  );
}
