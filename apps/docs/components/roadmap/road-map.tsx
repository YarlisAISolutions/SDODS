'use client';

/**
 * The roadmap as a journey: one winding road, twenty checkpoints, a traveller standing at the
 * one we are on and Maxi explaining why it matters.
 *
 * Two roads are rendered — a wide one and a narrow one — and a container query decides which is
 * visible. Both are laid out at module scope from literal numbers, so the server and the client
 * draw the same thing and there is no measurement, no resize listener and no hydration jump.
 */
import { useRef, useState } from 'react';
import { CHECKPOINTS, TODAY_ID } from '@sdods/roadmap';
import type { CheckpointState } from '@sdods/roadmap';
import { TutorBar, type TutorMood } from '../tutor';
import { CheckpointCard } from './checkpoint-card';
import { buildRoad, NARROW, WIDE } from './geometry';
import { RoadStops } from './road-stops';
import { RoadSvg } from './road-svg';

/** Where each stretch of the road begins. */
const BREAKS = [5, 17] as const;

const GEO_WIDE = buildRoad(WIDE, BREAKS);
const GEO_NARROW = buildRoad(NARROW, BREAKS);

const TODAY_INDEX = Math.max(
  0,
  CHECKPOINTS.findIndex((c) => c.id === TODAY_ID),
);

const MOOD: Record<CheckpointState, TutorMood> = {
  delivered: 'happy',
  now: 'talking',
  planned: 'idle',
  direction: 'thinking',
};

const PANEL_ID = 'roadmap-checkpoint';

export function Roadmap() {
  const [selected, setSelected] = useState(TODAY_INDEX);
  const announce = useRef(false);
  const checkpoint = CHECKPOINTS[selected]!;

  function select(index: number, fromKeyboard: boolean) {
    announce.current = !fromKeyboard;
    setSelected(index);
  }

  const step = (delta: number) => {
    const next = Math.min(CHECKPOINTS.length - 1, Math.max(0, selected + delta));
    if (next !== selected) select(next, false);
  };

  return (
    <div className="not-prose @container my-8">
      <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card">
        <div className="relative hidden @2xl:block sdods-road-wide">
          <RoadSvg
            geometry={GEO_WIDE}
            checkpoints={CHECKPOINTS}
            selected={selected}
            variant="wide"
          />
          <RoadStops
            geometry={GEO_WIDE}
            checkpoints={CHECKPOINTS}
            selected={selected}
            onSelect={select}
            panelId={PANEL_ID}
            variant="wide"
          />
        </div>
        <div className="relative @2xl:hidden sdods-road-narrow">
          <RoadSvg
            geometry={GEO_NARROW}
            checkpoints={CHECKPOINTS}
            selected={selected}
            variant="narrow"
          />
          <RoadStops
            geometry={GEO_NARROW}
            checkpoints={CHECKPOINTS}
            selected={selected}
            onSelect={select}
            panelId={PANEL_ID}
            variant="narrow"
          />
        </div>

        <div className="sticky bottom-0 z-10 border-t border-fd-border bg-fd-card @2xl:static">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 print:hidden">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={selected === 0}
              aria-controls={PANEL_ID}
              className="rounded-md border border-fd-border px-3 py-1.5 text-sm font-medium hover:bg-fd-accent disabled:opacity-50"
            >
              ← Previous stop
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={selected === CHECKPOINTS.length - 1}
              aria-controls={PANEL_ID}
              className="rounded-md border border-fd-border px-3 py-1.5 text-sm font-medium hover:bg-fd-accent disabled:opacity-50"
            >
              Next stop →
            </button>
            <button
              type="button"
              onClick={() => select(TODAY_INDEX, false)}
              className="rounded-md bg-fd-primary px-3 py-1.5 text-sm font-semibold text-fd-primary-foreground"
            >
              Back to today
            </button>
          </div>

          <div className="px-4 pb-4">
            <CheckpointCard
              checkpoint={checkpoint}
              index={selected}
              total={CHECKPOINTS.length}
              id={PANEL_ID}
              labelledBy={`road-wide-${checkpoint.id}`}
            />
          </div>
          <TutorBar
            mood={MOOD[checkpoint.state]}
            text={checkpoint.maxi}
            className="border-t border-fd-border bg-fd-muted/40 px-4 py-3 print:hidden"
          />
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announce.current
          ? `Checkpoint ${selected + 1} of ${CHECKPOINTS.length}. ${checkpoint.title}.`
          : ''}
      </p>
    </div>
  );
}
