/**
 * The controls over the drawing.
 *
 * Real buttons, positioned as percentages of the same geometry the SVG was drawn from, so they
 * track the picture at every width without anything being measured. Keyboard behaviour is the
 * standard tab pattern: one tab stop for the whole road, arrows to walk it.
 */
import type { Checkpoint, CheckpointState } from '@sdods/roadmap';
import type { RoadGeometry } from './geometry';

const RING: Record<CheckpointState, string> = {
  delivered: 'hover:ring-emerald-400/70',
  now: 'hover:ring-amber-400/70',
  planned: 'hover:ring-indigo-400/70',
  direction: 'hover:ring-slate-400/70',
};

const WHEN: Record<CheckpointState, string> = {
  delivered: 'delivered',
  now: 'today',
  planned: 'planned',
  direction: 'direction',
};

export function RoadStops({
  geometry,
  checkpoints,
  selected,
  onSelect,
  panelId,
  variant,
}: {
  geometry: RoadGeometry;
  checkpoints: readonly Checkpoint[];
  selected: number;
  onSelect: (index: number, fromKeyboard: boolean) => void;
  panelId: string;
  variant: 'wide' | 'narrow';
}) {
  const size = variant === 'wide' ? 'w-[6.5%]' : 'w-[13%]';

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = checkpoints.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? Math.min(index + 1, last)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : index;
    if (next === index) return;
    event.preventDefault();
    onSelect(next, true);
  }

  return (
    <div
      role="tablist"
      aria-label="Roadmap checkpoints"
      aria-orientation="horizontal"
      className="pointer-events-none absolute inset-0 print:hidden"
    >
      {geometry.stops.map((stop, i) => {
        const checkpoint = checkpoints[i];
        if (!checkpoint) return null;
        const isSelected = i === selected;
        return (
          <button
            key={checkpoint.id}
            type="button"
            role="tab"
            id={`road-${variant}-${checkpoint.id}`}
            aria-selected={isSelected}
            aria-controls={panelId}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(i, false)}
            onKeyDown={(event) => onKeyDown(event, i)}
            style={{
              left: `${(stop.x / geometry.width) * 100}%`,
              top: `${(stop.y / geometry.height) * 100}%`,
            }}
            className={`pointer-events-auto absolute ${size} aspect-square -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full ring-4 ring-transparent transition-[box-shadow] ${RING[checkpoint.state]} focus-visible:ring-fd-primary focus-visible:outline-none`}
          >
            <span className="sr-only">
              {checkpoint.label}. {checkpoint.title}, {WHEN[checkpoint.state]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
