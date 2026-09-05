/**
 * The picture: a winding road with a marker at every checkpoint.
 *
 * It is deliberately inert — no handlers, no focus, `aria-hidden` — because the controls that
 * sit over it are real HTML buttons. Safari has never reliably honoured `tabindex` on SVG
 * children, so putting the interaction in the drawing would quietly cost keyboard users the page.
 */
import type { Checkpoint, CheckpointState } from '@sdods/roadmap';
import { C, HAIR, Label, Person, SKIN, Tick, Tile } from '../art/kit';
import type { RoadGeometry } from './geometry';

/** Asphalt. Local, rather than pushed into the shared palette for one drawing. */
const ROAD = '#3b4453';

const MARKER: Record<CheckpointState, { r: number }> = {
  delivered: { r: 13 },
  now: { r: 15 },
  planned: { r: 12 },
  direction: { r: 10 },
};

export function RoadSvg({
  geometry,
  checkpoints,
  selected,
  variant,
}: {
  geometry: RoadGeometry;
  checkpoints: readonly Checkpoint[];
  selected: number;
  variant: 'wide' | 'narrow';
}) {
  const { width, height, stops, parts } = geometry;
  const wide = variant === 'wide';
  const labelSize = wide ? 15 : 12;
  const subSize = wide ? 12 : 10;
  const travelled = parts[0] ?? '';
  const horizon = parts[2] ?? '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden focusable="false">
      <Tile width={width} height={height} tone="cool">
        {/* the road: a soft kerb, the asphalt, then the centre line */}
        <g fill="none" strokeLinejoin="round">
          <path
            d={geometry.d}
            stroke={C.ink}
            strokeOpacity={0.1}
            strokeWidth={36}
            strokeLinecap="round"
          />
          <path d={geometry.d} stroke={ROAD} strokeWidth={28} strokeLinecap="round" />
          {/* what is already behind the traveller reads as worn in */}
          <path
            d={travelled}
            stroke={C.tealDeep}
            strokeOpacity={0.3}
            strokeWidth={28}
            strokeLinecap="butt"
          />
          {/* the horizon is the same road, seen through haze */}
          <path
            d={horizon}
            stroke={C.paper}
            strokeOpacity={0.58}
            strokeWidth={30}
            strokeLinecap="butt"
          />
          <path
            d={geometry.d}
            stroke={C.paper}
            strokeWidth={2.6}
            strokeDasharray="12 14"
            strokeLinecap="butt"
          />
        </g>

        {stops.map((stop, i) => {
          const checkpoint = checkpoints[i];
          if (!checkpoint) return null;
          const { r } = MARKER[checkpoint.state];
          const isSelected = i === selected;
          const labelY = stop.offset === 1 ? stop.y + r + 22 : stop.y - r - 14;
          return (
            <g key={checkpoint.id}>
              {checkpoint.state === 'now' && (
                <circle
                  className="sdods-road-today"
                  cx={stop.x}
                  cy={stop.y}
                  r={r + 11}
                  fill="none"
                  stroke={C.amber}
                  strokeWidth={4}
                />
              )}
              {isSelected && (
                <circle
                  cx={stop.x}
                  cy={stop.y}
                  r={r + 9}
                  fill="none"
                  stroke={C.indigoDeep}
                  strokeWidth={2.5}
                />
              )}
              {checkpoint.state === 'delivered' && <Tick x={stop.x} y={stop.y} r={r} />}
              {checkpoint.state === 'now' && (
                <>
                  <circle cx={stop.x} cy={stop.y} r={r} fill={C.amber} />
                  <circle cx={stop.x} cy={stop.y} r={6} fill={C.paper} />
                </>
              )}
              {checkpoint.state === 'planned' && (
                <circle
                  cx={stop.x}
                  cy={stop.y}
                  r={r}
                  fill={C.paper}
                  stroke={C.indigo}
                  strokeWidth={3.5}
                />
              )}
              {checkpoint.state === 'direction' && (
                <circle
                  cx={stop.x}
                  cy={stop.y}
                  r={r}
                  fill={C.paper}
                  stroke={C.slate}
                  strokeWidth={3}
                  strokeDasharray="4 4"
                />
              )}
              <Label
                x={stop.x}
                y={labelY}
                anchor="middle"
                size={labelSize}
                weight={isSelected ? '700' : '600'}
                fill={checkpoint.state === 'direction' ? C.slate : C.ink}
              >
                {checkpoint.label}
              </Label>
              {wide && checkpoint.state === 'now' && (
                <Label
                  x={stop.x}
                  y={stop.offset === 1 ? labelY + 15 : labelY - 15}
                  anchor="middle"
                  size={subSize}
                  fill={C.amberDeep}
                  weight="700"
                >
                  you are here
                </Label>
              )}
            </g>
          );
        })}

        {/* The traveller stands at the stop, on the side the label is not using, so the two never
          collide however the wave placed this stop. */}
        {(() => {
          const stop = stops[selected];
          const checkpoint = checkpoints[selected];
          if (!stop || !checkpoint) return null;
          const scale = wide ? 0.58 : 0.46;
          const labelAbove = stop.offset !== 1;
          const x = stop.x - 22 * scale;
          const y = labelAbove ? stop.y + (wide ? 20 : 16) : stop.y - 92 * scale - (wide ? 20 : 16);
          return (
            <g transform={`translate(${x} ${y}) scale(${scale})`}>
              <Person
                skin={SKIN[1]}
                hair={HAIR[1]}
                hairStyle="curly"
                shirt={C.teal}
                trouser={C.tealDeep}
                armUp={checkpoint.state === 'delivered' || checkpoint.state === 'now'}
                mood={
                  checkpoint.state === 'delivered'
                    ? 'delighted'
                    : checkpoint.state === 'direction'
                      ? 'thinking'
                      : 'happy'
                }
              />
            </g>
          );
        })()}
      </Tile>
    </svg>
  );
}
