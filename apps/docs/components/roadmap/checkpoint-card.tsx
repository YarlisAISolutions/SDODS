/** The stop a reader is standing at, written out: what it is for, what lands, how you know. */
import type { Checkpoint, CheckpointState } from '@sdods/roadmap';
import { isChapter, isMonth, isOverdue } from '@sdods/roadmap';

const BADGE: Record<CheckpointState, { label: string; className: string }> = {
  delivered: {
    label: 'Delivered',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  },
  now: {
    label: 'In progress',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  },
  planned: {
    label: 'Planned',
    className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  },
  direction: {
    label: 'Direction',
    className: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

/** Shown beside the state once a stop's month or year has ended without its proof. */
export const OVERDUE_BADGE = {
  label: 'Overdue',
  className: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
};

/** What to print above the title: a chapter has no date, and that is deliberate. */
export function whenOf(checkpoint: Checkpoint): string {
  if (isChapter(checkpoint))
    return `Chapter ${checkpoint.order} · phases ${checkpoint.phases.map((p) => p.phase).join(', ')}`;
  if (isMonth(checkpoint)) return checkpoint.label;
  return `The ${checkpoint.label} horizon`;
}

export function CheckpointCard({
  checkpoint,
  index,
  total,
  id,
  labelledBy,
}: {
  checkpoint: Checkpoint;
  index: number;
  total: number;
  id: string;
  labelledBy: string;
}) {
  const badge = BADGE[checkpoint.state];
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={0}
      className="min-h-[17rem] rounded-xl border border-fd-border bg-fd-card p-4"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fd-muted-foreground">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${badge.className}`}>
          {badge.label}
        </span>
        {isOverdue(checkpoint) && (
          <span className={`rounded-full px-2 py-0.5 font-semibold ${OVERDUE_BADGE.className}`}>
            {OVERDUE_BADGE.label}
          </span>
        )}
        <span>{whenOf(checkpoint)}</span>
        <span className="ml-auto font-mono">
          {index + 1} / {total}
        </span>
      </p>
      <h3 className="mt-2 text-base font-semibold">{checkpoint.title}</h3>
      <p className="mt-1 text-sm text-fd-muted-foreground">{checkpoint.goal}</p>
      <p className="mt-3 text-xs font-semibold tracking-wide uppercase">
        {checkpoint.state === 'delivered' ? 'What it shipped' : 'What ships'}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fd-muted-foreground">
        {checkpoint.ships.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3 border-l-2 border-fd-primary pl-3 text-sm">
        <span className="font-semibold">
          {checkpoint.state === 'delivered' ? 'Proof. ' : 'You will know it landed when. '}
        </span>
        <span className="text-fd-muted-foreground">{checkpoint.proof}</span>
      </p>
    </div>
  );
}
