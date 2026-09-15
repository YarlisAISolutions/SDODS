import { useState } from 'react';
import type { ArtifactRef } from '../../api/types';
import { useAcceptBaselines } from '../../api/queries';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui';
import { useToast } from '../../components/ui/Toast';

/**
 * "Accept as baseline" for a failed visual check. The confirm shows the expected, actual and diff
 * images so nobody accepts pixels they have not looked at; the server copies the actual image to
 * `features/__screenshots__/<run target>/<platform>/<name>.png` — the same as
 * `sdods baselines accept <name> --run <id>`.
 */
export function AcceptBaseline({
  runId,
  runnerProject,
  name,
  expected,
  actual,
  diff,
}: {
  runId: string;
  runnerProject?: string;
  name: string;
  expected?: ArtifactRef;
  actual?: ArtifactRef;
  diff?: ArtifactRef;
}) {
  const [open, setOpen] = useState(false);
  const accept = useAcceptBaselines(runId);
  const { toast } = useToast();
  const target = runnerProject ? `${runnerProject}/${name}` : name;
  if (!actual) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="accept-baseline">
        Accept as baseline
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) accept.reset();
        }}
        title={`Accept "${name}" as the new baseline?`}
        description={
          <>
            The actual screenshot replaces the committed baseline for{' '}
            <span className="mono">{runnerProject ?? 'this run target'}</span> on the platform this
            run happened on. Commit the PNG it writes with the change that moved the pixels.
          </>
        }
        confirmLabel="Accept as baseline"
        pending={accept.isPending}
        error={accept.error}
        onConfirm={() =>
          accept.mutate(
            { names: [target] },
            {
              onSuccess: (res) => {
                setOpen(false);
                toast(
                  res.accepted
                    .map((a) => `${a.created ? 'Created' : 'Updated'} ${a.baseline}`)
                    .join('\n'),
                  'success',
                );
              },
            },
          )
        }
      >
        <div className="grid gap-2 sm:grid-cols-3" data-testid="accept-baseline-review">
          {(
            [
              ['expected', expected],
              ['actual', actual],
              ['diff', diff],
            ] as const
          ).map(([label, ref]) =>
            ref ? (
              <figure key={label} className="min-w-0">
                <img src={ref.url} alt={label} className="w-full rounded border border-line" />
                <figcaption className="muted text-[11px]">{label}</figcaption>
              </figure>
            ) : (
              <div key={label} className="muted text-[11px]">
                no {label} image{label === 'expected' ? ' (new baseline)' : ''}
              </div>
            ),
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
