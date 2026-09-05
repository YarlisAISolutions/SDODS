/**
 * The shape of the road.
 *
 * A serpentine: rows of gently waving cubic Béziers joined by 180° bends at alternating ends.
 * Three rules keep the arithmetic exact and the drawing honest:
 *
 *  1. every checkpoint is a Bézier *anchor*, never a point sampled along a curve, so its
 *     coordinate is a formula rather than a measurement;
 *  2. the control points either side of an anchor are offset horizontally only, so the road
 *     runs level through every stop and no rotation maths is needed;
 *  3. the first and last stop of a row sit on the row's centre line, so a bend can join two
 *     rows with matching tangents.
 *
 * Nothing here touches the DOM. The docs site is a static export rendered twice — once at
 * build time, once on hydration — and identical output both times is the whole point.
 */

export interface RoadLayout {
  width: number;
  /** Gutter outside the widest point of a bend. */
  margin: number;
  /** Centre line of the first row. */
  topY: number;
  /** Distance between row centre lines; the bend radius is half of it. */
  rowGap: number;
  /** How far a stop may sit above or below its row's centre line. */
  amp: number;
  /** Control-point reach, as a fraction of the gap between two stops. */
  bow: number;
  /** The little tail of road entering the first row and leaving the last. */
  stub: number;
  bottomPad: number;
  /** How many stops each row carries. */
  rows: readonly number[];
}

export interface RoadStop {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  /** Direction of travel through this stop: 1 rightwards, -1 leftwards. */
  dir: 1 | -1;
  /** Which side of the centre line the wave put it: -1 above, 0 on it, 1 below. */
  offset: -1 | 0 | 1;
}

export interface RoadGeometry {
  layout: RoadLayout;
  width: number;
  height: number;
  stops: RoadStop[];
  /** The whole road, one continuous path. */
  d: string;
  /** The same road cut at `breaks`, so each stretch can be painted differently. */
  parts: string[];
}

/** Two decimals is plenty for a drawing and keeps the served HTML small. */
const q = (n: number): number => Math.round(n * 100) / 100;

export function buildRoad(layout: RoadLayout, breaks: readonly number[]): RoadGeometry {
  const { width, margin, topY, rowGap, amp, bow, stub, bottomPad, rows } = layout;
  const r = rowGap / 2;
  const xL = margin + r;
  const xR = width - margin - r;
  if (xR <= xL) throw new Error('roadmap geometry: the road is wider than its canvas');

  const stops: RoadStop[] = [];
  rows.forEach((count, row) => {
    if (count < 1) throw new Error('roadmap geometry: a row needs at least one stop');
    const dir: 1 | -1 = row % 2 === 0 ? 1 : -1;
    const centre = topY + row * rowGap;
    for (let col = 0; col < count; col += 1) {
      const u = count === 1 ? 0.5 : col / (count - 1);
      const x = dir === 1 ? xL + u * (xR - xL) : xR - u * (xR - xL);
      // The ends of a row stay level so the bends meet them cleanly.
      const offset: -1 | 0 | 1 = col === 0 || col === count - 1 ? 0 : col % 2 === 1 ? -1 : 1;
      stops.push({
        index: stops.length,
        row,
        col,
        x: q(x),
        y: q(centre + amp * offset),
        dir,
        offset,
      });
    }
  });

  /** The curve from one stop to the next along a row. */
  const curveTo = (from: RoadStop, to: RoadStop): string => {
    const dx = to.x - from.x;
    return `C ${q(from.x + bow * dx)} ${from.y} ${q(to.x - bow * dx)} ${to.y} ${to.x} ${to.y}`;
  };

  /** The half-circle that turns the road around and drops it into the next row. */
  const bendTo = (from: RoadStop, to: RoadStop): string =>
    `A ${r} ${r} 0 0 ${from.dir === 1 ? 1 : 0} ${to.x} ${to.y}`;

  // Each entry is the piece of road that arrives at that stop; the first is the lead-in tail.
  const pieces: string[] = [];
  const first = stops[0]!;
  pieces.push(`M ${q(first.x - first.dir * stub)} ${first.y} L ${first.x} ${first.y}`);
  for (let i = 1; i < stops.length; i += 1) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    pieces.push(from.row === to.row ? curveTo(from, to) : bendTo(from, to));
  }
  const last = stops[stops.length - 1]!;
  pieces.push(`L ${q(last.x + last.dir * stub)} ${last.y}`);

  const d = pieces.join(' ');

  // Cut the road at each break. A cut is clean because every stop is level.
  const cuts = [0, ...breaks, stops.length];
  const parts: string[] = [];
  for (let s = 0; s < cuts.length - 1; s += 1) {
    const from = cuts[s]!;
    const to = cuts[s + 1]!;
    const start = stops[from]!;
    const body = pieces.slice(from + 1, to + 1).join(' ');
    const head = from === 0 ? pieces[0]! : `M ${start.x} ${start.y}`;
    const tail = to === stops.length ? ` ${pieces[pieces.length - 1]!}` : '';
    parts.push(`${head} ${body}${tail}`.trim());
  }

  return {
    layout,
    width,
    height: topY + (rows.length - 1) * rowGap + bottomPad,
    stops,
    d,
    parts,
  };
}

/** Wide screens: four rows, one per stretch — five chapters, twelve months, three years. */
export const WIDE: RoadLayout = {
  width: 960,
  margin: 21,
  topY: 96,
  rowGap: 150,
  amp: 22,
  bow: 0.42,
  stub: 34,
  bottomPad: 104,
  rows: [5, 6, 6, 3],
};

/** Narrow screens: the same road folded into seven short rows. */
export const NARROW: RoadLayout = {
  width: 360,
  margin: 16,
  topY: 76,
  rowGap: 96,
  amp: 15,
  bow: 0.42,
  stub: 22,
  bottomPad: 78,
  rows: [3, 3, 3, 3, 3, 3, 2],
};
