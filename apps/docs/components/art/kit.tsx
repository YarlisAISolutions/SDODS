/**
 * Drawing kit for the documentation illustrations.
 *
 * The scenes on the getting-started pages are inline SVG, drawn from the same geometry and the
 * same palette as the roadmap art on the marketing site: one cartoon skeleton for every person,
 * a light tile behind every scene so the drawing reads identically in both themes, and amber
 * reserved for "this is the step you are on".
 *
 * Nothing here fetches anything. A scene is a component, so it costs one render and scales to
 * whatever width the prose column happens to be.
 */
import type { ReactNode } from 'react';

export const C = {
  ink: '#1f2937',
  line: '#cbd5e1',
  tile: '#eef2ff',
  tileWarm: '#fff7ed',
  tileCool: '#ecfeff',
  indigo: '#6366f1',
  indigoDeep: '#4338ca',
  teal: '#2dd4bf',
  tealDeep: '#0d9488',
  amber: '#f59e0b',
  amberDeep: '#b45309',
  coral: '#fb7185',
  coralDeep: '#9f1239',
  green: '#22c55e',
  paper: '#ffffff',
  slate: '#94a3b8',
  terminal: '#111827',
} as const;

export const SKIN = ['#f2c9a0', '#c68642', '#8d5524', '#ffd9b3'] as const;
export const HAIR = ['#3f3f46', '#7c2d12', '#1e1b4b', '#78350f'] as const;

const FONT = 'ui-sans-serif, Inter, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * One cartoon person in a 44 x 92 box, origin at the top left of the head.
 * Every figure on the site shares this skeleton; that is what makes separate scenes look like
 * one set rather than a pile of clip art.
 */
export function Person({
  x = 0,
  y = 0,
  scale = 1,
  skin = SKIN[0],
  shirt = C.indigo,
  trouser = C.indigoDeep,
  hair = HAIR[0],
  hairStyle = 'short',
  armUp = false,
  mood = 'happy',
}: {
  x?: number;
  y?: number;
  scale?: number;
  skin?: string;
  shirt?: string;
  trouser?: string;
  hair?: string;
  hairStyle?: 'short' | 'bun' | 'long' | 'curly';
  armUp?: boolean;
  mood?: 'happy' | 'thinking' | 'delighted';
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="12" y="62" width="8" height="26" rx="4" fill={trouser} />
      <rect x="24" y="62" width="8" height="26" rx="4" fill={trouser} />
      <rect x="9" y="85" width="13" height="7" rx="3.5" fill={C.ink} />
      <rect x="22" y="85" width="13" height="7" rx="3.5" fill={C.ink} />
      <rect x="7" y="30" width="30" height="35" rx="11" fill={shirt} />
      {armUp ? (
        <g transform="rotate(-20 5 36)">
          <rect x="1.5" y="10" width="7" height="28" rx="3.5" fill={shirt} />
          <circle cx="5" cy="11" r="4.2" fill={skin} />
        </g>
      ) : (
        <>
          <rect x="1" y="32" width="7" height="26" rx="3.5" fill={shirt} />
          <circle cx="4.5" cy="59" r="4.2" fill={skin} />
        </>
      )}
      <rect x="36" y="32" width="7" height="26" rx="3.5" fill={shirt} />
      <circle cx="39.5" cy="59" r="4.2" fill={skin} />
      <rect x="19" y="25" width="6" height="7" rx="3" fill={skin} />
      <circle cx="22" cy="15" r="13" fill={skin} />
      {hairStyle === 'bun' && <circle cx="22" cy="-1" r="6" fill={hair} />}
      {hairStyle === 'long' && (
        <path d="M9 15a13 13 0 0126 0v18h-6V16a7 7 0 00-14 0v17H9z" fill={hair} />
      )}
      {hairStyle === 'curly' && (
        <g fill={hair}>
          <circle cx="13" cy="8" r="6" />
          <circle cx="22" cy="3" r="6.5" />
          <circle cx="31" cy="8" r="6" />
        </g>
      )}
      {(hairStyle === 'short' || hairStyle === 'bun') && (
        <path d="M9 14a13 13 0 0126 0v1H9z" fill={hair} />
      )}
      {mood === 'delighted' ? (
        <>
          <path
            d="M14 15q3 -4 6 0M24 15q3 -4 6 0"
            stroke={C.ink}
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M16 19q6 7 12 0z" fill={C.ink} />
        </>
      ) : (
        <>
          <circle cx="17" cy="15" r="1.8" fill={C.ink} />
          <circle cx="27" cy="15" r="1.8" fill={C.ink} />
          <path
            d={mood === 'thinking' ? 'M17 21q5 -2 10 0' : 'M17 20q5 4.5 10 0'}
            stroke={C.ink}
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )}
    </g>
  );
}

/** The helper robot: it proposes, it never merges. Amber antenna means it is thinking. */
export function Robot({
  x = 0,
  y = 0,
  scale = 1,
  body = C.indigo,
  limb = C.indigoDeep,
}: {
  x?: number;
  y?: number;
  scale?: number;
  body?: string;
  limb?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="8" y="24" width="60" height="52" rx="16" fill={body} />
      <rect x="20" y="38" width="36" height="22" rx="8" fill={C.paper} />
      <circle cx="31" cy="49" r="4.2" fill={C.ink} />
      <circle cx="45" cy="49" r="4.2" fill={C.ink} />
      <path d="M31 58q7 5 14 0" stroke={C.ink} strokeWidth="2" strokeLinecap="round" fill="none" />
      <rect x="34" y="6" width="8" height="14" rx="4" fill={C.slate} />
      <circle cx="38" cy="4" r="5" fill={C.amber} />
      <rect x="0" y="34" width="10" height="28" rx="5" fill={limb} />
      <rect x="66" y="34" width="10" height="28" rx="5" fill={limb} />
      <rect x="18" y="76" width="14" height="10" rx="5" fill={C.ink} />
      <rect x="44" y="76" width="14" height="10" rx="5" fill={C.ink} />
    </g>
  );
}

/** A terminal window with a prompt line and result lines. Text is drawn, never fetched. */
export function TerminalBox({
  x = 0,
  y = 0,
  width = 180,
  height = 104,
  command,
  lines = [],
  scale = 1,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  command: string;
  lines?: Array<{ text: string; fill?: string }>;
  scale?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect width={width} height={height} rx="10" fill={C.terminal} />
      <circle cx="14" cy="13" r="3.5" fill={C.coral} />
      <circle cx="25" cy="13" r="3.5" fill={C.amber} />
      <circle cx="36" cy="13" r="3.5" fill={C.green} />
      <text x="12" y="36" fontSize="9" fontFamily={MONO} fill={C.teal}>
        $ <tspan fill={C.paper}>{command}</tspan>
      </text>
      {lines.map((l, i) => (
        <text
          key={l.text}
          x="12"
          y={50 + i * 13}
          fontSize="8.5"
          fontFamily={MONO}
          fill={l.fill ?? C.slate}
        >
          {l.text}
        </text>
      ))}
    </g>
  );
}

/** A labelled sticker: the detections, the checks, the file names. */
export function Chip({
  x,
  y,
  label,
  fill = C.paper,
  text = C.ink,
  width,
}: {
  x: number;
  y: number;
  label: string;
  fill?: string;
  text?: string;
  width?: number;
}) {
  const w = width ?? Math.max(46, label.length * 5.6 + 16);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height="20" rx="10" fill={fill} stroke={C.line} />
      <text
        x={w / 2}
        y="13.5"
        fontSize="9"
        fontFamily={FONT}
        fill={text}
        textAnchor="middle"
        fontWeight="600"
      >
        {label}
      </text>
    </g>
  );
}

/** A green tick in a disc — the only thing on these pages that means "passed". */
export function Tick({
  x,
  y,
  r = 11,
  fill = C.green,
}: {
  x: number;
  y: number;
  r?: number;
  fill?: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill={fill} />
      <path
        d={`M${-r * 0.45} 0l${r * 0.34} ${r * 0.38} ${r * 0.6} -${r * 0.72}`}
        stroke={C.paper}
        strokeWidth={r * 0.26}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </g>
  );
}

export function Tile({
  children,
  tone = 'cool',
  width = 320,
  height = 220,
}: {
  children: ReactNode;
  tone?: 'cool' | 'warm' | 'mint';
  width?: number;
  height?: number;
}) {
  const fill = tone === 'warm' ? C.tileWarm : tone === 'mint' ? C.tileCool : C.tile;
  return (
    <>
      <rect width={width} height={height} rx="18" fill={fill} />
      {children}
    </>
  );
}

export function Label({
  x,
  y,
  children,
  size = 10,
  fill = C.slate,
  anchor = 'start',
  weight = '500',
  mono = false,
}: {
  x: number;
  y: number;
  children: string;
  size?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  weight?: string;
  mono?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontFamily={mono ? MONO : FONT}
      fill={fill}
      textAnchor={anchor}
      fontWeight={weight}
    >
      {children}
    </text>
  );
}

export const FONTS = { FONT, MONO };
