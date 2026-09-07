/**
 * Illustrations for the roadmap.
 *
 * The SDODS mark is a rail: two endpoints, two gates and a pivot. The roadmap extends that
 * same geometry across five years, so the page is drawn from the brand rather than from a
 * stock timeline. Amber marks the present, exactly as it marks the pivot in the logo.
 *
 * Every scene is inline SVG on its own light tile, so it renders identically in both themes,
 * needs no network request and scales to any width.
 */

const C = {
  ink: '#1f2937',
  line: '#cbd5e1',
  tile: '#eef2ff',
  tileWarm: '#fff7ed',
  indigo: '#6366f1',
  indigoDeep: '#4338ca',
  teal: '#2dd4bf',
  tealDeep: '#0d9488',
  amber: '#f59e0b',
  coral: '#fb7185',
  green: '#22c55e',
  paper: '#ffffff',
  slate: '#94a3b8',
} as const;

const SKIN = ['#f2c9a0', '#c68642', '#8d5524', '#ffd9b3'] as const;
const HAIR = ['#3f3f46', '#7c2d12', '#1e1b4b', '#78350f'] as const;

/**
 * One cartoon person, drawn in a 44 x 92 box with the origin at the top left of the head.
 * Keeping every figure on one skeleton is what makes five separate scenes look like one set.
 */
function Person({
  x = 0,
  y = 0,
  scale = 1,
  skin = SKIN[0],
  shirt = C.indigo,
  trouser = C.indigoDeep,
  hair = HAIR[0],
  hairStyle = 'short',
  armUp = false,
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
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {/* legs and shoes */}
      <rect x="12" y="62" width="8" height="26" rx="4" fill={trouser} />
      <rect x="24" y="62" width="8" height="26" rx="4" fill={trouser} />
      <rect x="9" y="85" width="13" height="7" rx="3.5" fill={C.ink} />
      <rect x="22" y="85" width="13" height="7" rx="3.5" fill={C.ink} />
      {/* torso */}
      <rect x="7" y="30" width="30" height="35" rx="11" fill={shirt} />
      {/* arms */}
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
      {/* neck and head */}
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
      {/* face */}
      <circle cx="17" cy="15" r="1.8" fill={C.ink} />
      <circle cx="27" cy="15" r="1.8" fill={C.ink} />
      <path
        d="M17 20q5 4.5 10 0"
        stroke={C.ink}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

function Tile({ children, warm = false }: { children: React.ReactNode; warm?: boolean }) {
  return (
    <>
      <rect width="320" height="220" rx="18" fill={warm ? C.tileWarm : C.tile} />
      {children}
    </>
  );
}

const svgProps = {
  viewBox: '0 0 320 220',
  className: 'h-auto w-full',
  role: 'img' as const,
};

/** 2026 — Evidence. A failure that explains itself: two captures, a diff, a verdict. */
export function ArtEvidence() {
  return (
    <svg {...svgProps} aria-labelledby="art-evidence">
      <title id="art-evidence">
        A tester holding up a report that pairs a before and after screenshot with a passing verdict
      </title>
      <Tile>
        {/* report board */}
        <rect x="120" y="34" width="176" height="118" rx="12" fill={C.paper} />
        <rect x="132" y="48" width="70" height="46" rx="7" fill="#dbeafe" />
        <rect x="214" y="48" width="70" height="46" rx="7" fill="#dcfce7" />
        <rect x="138" y="56" width="42" height="5" rx="2.5" fill={C.slate} />
        <rect x="138" y="66" width="52" height="5" rx="2.5" fill={C.line} />
        <rect x="138" y="76" width="34" height="5" rx="2.5" fill={C.line} />
        <rect x="220" y="56" width="42" height="5" rx="2.5" fill={C.tealDeep} opacity="0.5" />
        <rect x="220" y="66" width="52" height="5" rx="2.5" fill={C.line} />
        <rect x="220" y="76" width="34" height="5" rx="2.5" fill={C.line} />
        <text x="140" y="110" fontSize="10" fill={C.slate} fontFamily="Inter, sans-serif">
          before
        </text>
        <text x="222" y="110" fontSize="10" fill={C.slate} fontFamily="Inter, sans-serif">
          after
        </text>
        {/* verdict */}
        <circle cx="266" cy="130" r="13" fill={C.green} />
        <path
          d="M259 130l5 5 9-10"
          stroke={C.paper}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect x="132" y="124" width="80" height="6" rx="3" fill={C.line} />
        <rect x="132" y="136" width="56" height="6" rx="3" fill={C.line} />
        {/* magnifier over the diff */}
        <circle cx="202" cy="70" r="20" fill="none" stroke={C.amber} strokeWidth="5" />
        <path d="M216 84l14 14" stroke={C.amber} strokeWidth="6" strokeLinecap="round" />
        <Person
          x={24}
          y={66}
          scale={1.15}
          skin={SKIN[1]}
          hair={HAIR[1]}
          hairStyle="curly"
          shirt={C.teal}
          trouser={C.tealDeep}
          armUp
        />
      </Tile>
    </svg>
  );
}

/** 2027 — Shared truth. Three people, one history, no relitigating. */
export function ArtSharedTruth() {
  return (
    <svg {...svgProps} aria-labelledby="art-shared">
      <title id="art-shared">
        Three teammates looking at one shared dashboard, signed in behind a single key
      </title>
      <Tile>
        {/* shared screen */}
        <rect x="86" y="20" width="150" height="96" rx="10" fill={C.paper} />
        <rect x="98" y="34" width="60" height="6" rx="3" fill={C.line} />
        {/* a small history chart */}
        <rect x="98" y="90" width="12" height="14" rx="3" fill={C.teal} />
        <rect x="116" y="78" width="12" height="26" rx="3" fill={C.teal} />
        <rect x="134" y="84" width="12" height="20" rx="3" fill={C.coral} />
        <rect x="152" y="66" width="12" height="38" rx="3" fill={C.indigo} />
        <rect x="170" y="72" width="12" height="32" rx="3" fill={C.indigo} />
        <rect x="188" y="60" width="12" height="44" rx="3" fill={C.indigo} />
        <rect x="206" y="80" width="12" height="24" rx="3" fill={C.teal} />
        {/* one key for everyone */}
        <circle cx="216" cy="34" r="9" fill={C.amber} />
        <circle cx="216" cy="34" r="3.4" fill={C.paper} />
        <path d="M216 38v9m0-4h5" stroke={C.amber} strokeWidth="3.4" strokeLinecap="round" />
        {/* stand */}
        <rect x="150" y="116" width="22" height="12" fill={C.line} />
        <rect x="128" y="126" width="66" height="7" rx="3.5" fill={C.slate} />
        <Person
          x={14}
          y={112}
          scale={0.82}
          skin={SKIN[0]}
          hair={HAIR[0]}
          shirt={C.indigo}
          trouser={C.indigoDeep}
        />
        <Person
          x={140}
          y={106}
          scale={0.9}
          skin={SKIN[2]}
          hair={HAIR[2]}
          hairStyle="bun"
          shirt={C.coral}
          trouser="#9f1239"
        />
        <Person
          x={256}
          y={112}
          scale={0.82}
          skin={SKIN[3]}
          hair={HAIR[3]}
          hairStyle="long"
          shirt={C.teal}
          trouser={C.tealDeep}
        />
      </Tile>
    </svg>
  );
}

/** 2028 — Self-maintaining. The robot takes the repetitive half. */
export function ArtSelfHealing() {
  return (
    <svg {...svgProps} aria-labelledby="art-healing">
      <title id="art-healing">
        A friendly robot mending a broken link with a wrench while an engineer watches with a coffee
      </title>
      <Tile warm>
        {/* the broken thing being mended */}
        <g transform="translate(150 44)">
          <rect
            x="0"
            y="26"
            width="46"
            height="26"
            rx="13"
            fill="none"
            stroke={C.indigo}
            strokeWidth="7"
          />
          <rect
            x="56"
            y="26"
            width="46"
            height="26"
            rx="13"
            fill="none"
            stroke={C.indigo}
            strokeWidth="7"
          />
          <rect x="40" y="34" width="22" height="10" rx="5" fill={C.green} />
          <path
            d="M30 12l6 10M52 6v12M74 12l-6 10"
            stroke={C.amber}
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>
        {/* robot */}
        <g transform="translate(24 78)">
          <rect x="8" y="24" width="60" height="52" rx="16" fill={C.indigo} />
          <rect x="20" y="38" width="36" height="22" rx="8" fill={C.paper} />
          <circle cx="31" cy="49" r="4.2" fill={C.ink} />
          <circle cx="45" cy="49" r="4.2" fill={C.ink} />
          <path
            d="M31 58q7 5 14 0"
            stroke={C.ink}
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <rect x="34" y="6" width="8" height="14" rx="4" fill={C.slate} />
          <circle cx="38" cy="4" r="5" fill={C.amber} />
          <rect x="0" y="34" width="10" height="28" rx="5" fill={C.indigoDeep} />
          {/* the raised arm and the wrench are one group, so the tool stays in the hand */}
          <g transform="rotate(-34 70 40)">
            <rect x="65" y="8" width="10" height="34" rx="5" fill={C.indigoDeep} />
            <g transform="translate(70 6) rotate(14)">
              <rect x="-3.5" y="-14" width="7" height="20" rx="3.5" fill={C.tealDeep} />
              <path d="M-3.5 -14a7 7 0 117 0z" fill={C.tealDeep} />
              <rect x="-2" y="-17" width="4" height="6" fill={C.tileWarm} />
            </g>
          </g>
          <rect x="20" y="76" width="14" height="16" rx="5" fill={C.indigoDeep} />
          <rect x="42" y="76" width="14" height="16" rx="5" fill={C.indigoDeep} />
        </g>
        {/* the engineer it freed up, reviewing what the agent proposed */}
        <Person
          x={246}
          y={112}
          scale={0.86}
          skin={SKIN[1]}
          hair={HAIR[3]}
          hairStyle="short"
          shirt={C.teal}
          trouser={C.tealDeep}
          armUp
        />
        <g transform="translate(200 92)">
          <rect x="0" y="0" width="54" height="34" rx="7" fill={C.paper} />
          <rect x="10" y="10" width="26" height="4.5" rx="2.25" fill={C.line} />
          <rect x="10" y="19" width="17" height="4.5" rx="2.25" fill={C.line} />
          <circle cx="41" cy="23" r="8" fill={C.green} />
          <path
            d="M37 23l3 3 5.5-6"
            stroke={C.paper}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      </Tile>
    </svg>
  );
}

/** 2029 — Orchestrated. Checks, approvals and the release move together. */
export function ArtOrchestrated() {
  return (
    <svg {...svgProps} aria-labelledby="art-orchestrated">
      <title id="art-orchestrated">
        A release manager conducting three gates on a rail, with an approval stamp landing on the
        last
      </title>
      <Tile>
        {/* the rail, the same shape as the mark */}
        <path
          d="M96 96h180"
          stroke={C.indigo}
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.35"
        />
        <circle cx="96" cy="96" r="9" fill={C.indigo} />
        <circle cx="276" cy="96" r="9" fill={C.indigo} />
        <g fill="none" stroke={C.indigoDeep} strokeWidth="7" strokeLinecap="round">
          <path d="M150 78a18 18 0 000 36" />
          <path d="M222 78a18 18 0 010 36" />
        </g>
        <circle cx="186" cy="96" r="17" fill="none" stroke={C.indigoDeep} strokeWidth="7" />
        <circle cx="186" cy="96" r="6" fill={C.amber} />
        {/* approval stamp */}
        <g transform="translate(244 30) rotate(-12)">
          <rect
            x="0"
            y="0"
            width="66"
            height="30"
            rx="7"
            fill="none"
            stroke={C.green}
            strokeWidth="4"
          />
          <path
            d="M12 16l6 7 12-14"
            stroke={C.green}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <rect x="38" y="11" width="18" height="4.5" rx="2.25" fill={C.green} />
        </g>
        {/* podium and conductor */}
        <rect x="26" y="150" width="66" height="14" rx="5" fill={C.slate} />
        <Person
          x={36}
          y={60}
          scale={0.98}
          skin={SKIN[3]}
          hair={HAIR[0]}
          hairStyle="bun"
          shirt={C.coral}
          trouser="#9f1239"
          armUp
        />
        {/* the baton starts at the raised hand and points away from the face */}
        <path d="M32 72L8 46" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="7" cy="45" r="4.5" fill={C.amber} />
      </Tile>
    </svg>
  );
}

/** 2030 — Governed. The chain from requirement to release, signed. */
export function ArtGoverned() {
  return (
    <svg {...svgProps} aria-labelledby="art-governed">
      <title id="art-governed">
        An auditor beside a shield holding a signed record that links a requirement to a release
      </title>
      <Tile>
        {/* shield */}
        <path
          d="M186 26l58 20v44c0 34-24 58-58 70-34-12-58-36-58-70V46z"
          fill={C.indigo}
          opacity="0.15"
        />
        <path
          d="M186 26l58 20v44c0 34-24 58-58 70-34-12-58-36-58-70V46z"
          fill="none"
          stroke={C.indigoDeep}
          strokeWidth="5"
        />
        {/* the signed record inside it */}
        <rect x="152" y="60" width="68" height="80" rx="8" fill={C.paper} />
        <rect x="162" y="72" width="48" height="5" rx="2.5" fill={C.line} />
        <rect x="162" y="84" width="38" height="5" rx="2.5" fill={C.line} />
        <rect x="162" y="96" width="44" height="5" rx="2.5" fill={C.line} />
        <path
          d="M162 116q8 -9 15 0t15 -6"
          stroke={C.indigoDeep}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="162" y="126" width="30" height="4" rx="2" fill={C.line} />
        {/* wax seal */}
        <circle cx="212" cy="128" r="13" fill={C.coral} />
        <circle cx="212" cy="128" r="6" fill="none" stroke={C.paper} strokeWidth="2.4" />
        {/* the chain it proves: requirement, run, release */}
        <g transform="translate(24 168)">
          <circle cx="8" cy="8" r="8" fill={C.teal} />
          <path d="M16 8h22" stroke={C.slate} strokeWidth="3" strokeLinecap="round" />
          <circle cx="46" cy="8" r="8" fill={C.indigo} />
          <path d="M54 8h22" stroke={C.slate} strokeWidth="3" strokeLinecap="round" />
          <circle cx="84" cy="8" r="8" fill={C.amber} />
        </g>
        <Person
          x={34}
          y={62}
          scale={0.94}
          skin={SKIN[2]}
          hair={HAIR[2]}
          hairStyle="long"
          shirt={C.indigo}
          trouser={C.indigoDeep}
        />
      </Tile>
    </svg>
  );
}

/**
 * Maxi, the tutor.
 *
 * The same robot who narrates the checkpoints in the documentation, redrawn here against the
 * marketing site's theme variables rather than the docs theme. Maxi appears at every stretch of
 * the road and says one sentence about it — never a sentence the page does not already prove.
 */
export type MaxiMood = 'idle' | 'talking' | 'thinking' | 'happy';

const MAXI_FACE: Record<MaxiMood, { left: string; right: string; mouth: string }> = {
  idle: { left: 'M26 40h7', right: 'M43 40h7', mouth: 'M32 51q6 4 12 0' },
  talking: { left: 'M26 40h7', right: 'M43 40h7', mouth: 'M32 49q6 7 12 0' },
  thinking: { left: 'M26 41h7', right: 'M43 38h7', mouth: 'M33 52q5 -3 10 0' },
  happy: { left: 'M26 42q3.5 -6 7 0', right: 'M43 42q3.5 -6 7 0', mouth: 'M31 48q7 9 14 0z' },
};

/** A 76 × 96 tutor. The antenna carries the mood, so it reads before the face does. */
export function MaxiAvatar({ mood = 'idle', size = 56 }: { mood?: MaxiMood; size?: number }) {
  const face = MAXI_FACE[mood];
  const antenna = mood === 'happy' ? C.green : mood === 'thinking' ? C.teal : C.amber;
  return (
    <svg
      viewBox="0 0 76 96"
      width={size}
      height={(size * 96) / 76}
      // The name and the sentence are already beside the drawing, so it adds nothing to read.
      aria-hidden
      className="shrink-0"
    >
      <ellipse cx="38" cy="92" rx="22" ry="4" fill={C.line} opacity="0.5" />
      <rect x="24" y="8" width="3.5" height="12" rx="1.75" fill={C.slate} />
      <circle cx="25.7" cy="7" r="4.5" fill={antenna} />
      <rect x="6" y="20" width="64" height="46" rx="16" fill={C.indigo} />
      <rect x="14" y="29" width="48" height="28" rx="11" fill={C.paper} />
      <g stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d={face.left} />
        <path d={face.right} />
      </g>
      {mood === 'happy' ? (
        <path d={face.mouth} fill={C.ink} />
      ) : (
        <path d={face.mouth} stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      )}
      <rect x="0" y="34" width="8" height="22" rx="4" fill={C.indigoDeep} />
      <rect x="68" y="34" width="8" height="22" rx="4" fill={C.indigoDeep} />
      <rect x="18" y="66" width="40" height="20" rx="8" fill={C.indigoDeep} />
      <rect x="27" y="72" width="22" height="8" rx="4" fill={C.teal} />
    </svg>
  );
}

/** Maxi and one sentence, in a bubble that points back at the avatar. */
export function MaxiSays({
  mood = 'talking',
  children,
  className = '',
}: {
  mood?: MaxiMood;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-3 ${className}`}>
      <MaxiAvatar mood={mood} size={52} />
      <div className="card flex-1 rounded-xl rounded-bl-none px-4 py-3 text-sm leading-relaxed">
        <span className="muted mb-0.5 block text-xs font-semibold uppercase tracking-wide">
          Maxi
        </span>
        {children}
      </div>
    </div>
  );
}

/** 2015–2018 — the grid years. One rack, many browsers, and a failure that says nothing. */
export function ArtGridYears() {
  return (
    <svg {...svgProps} aria-labelledby="art-grid">
      <title id="art-grid">
        An engineer beside a rack of browser windows, one of them failed, asking a question mark
        because the report says nothing more
      </title>
      <Tile>
        {/* the rack: one machine everything depends on */}
        <rect x="150" y="26" width="146" height="164" rx="12" fill={C.paper} />
        {[0, 1, 2].map((row) =>
          [0, 1].map((col) => {
            const x = 164 + col * 66;
            const y = 40 + row * 50;
            const failed = row === 1 && col === 1;
            return (
              <g key={`${row}-${col}`}>
                <rect
                  x={x}
                  y={y}
                  width="54"
                  height="38"
                  rx="6"
                  fill={failed ? '#fee2e2' : '#e0e7ff'}
                  stroke={failed ? C.coral : C.line}
                  strokeWidth="2"
                />
                <rect x={x + 6} y={y + 6} width="20" height="4" rx="2" fill={C.slate} />
                {failed ? (
                  <path
                    d={`M${x + 20} ${y + 18}l14 14m0-14l-14 14`}
                    stroke={C.coral}
                    strokeWidth="3.4"
                    strokeLinecap="round"
                  />
                ) : (
                  <>
                    <rect x={x + 6} y={y + 18} width="34" height="4" rx="2" fill={C.line} />
                    <rect x={x + 6} y={y + 27} width="24" height="4" rx="2" fill={C.line} />
                  </>
                )}
              </g>
            );
          }),
        )}
        {/* a hand-turned crank: the grid somebody maintained personally */}
        <circle cx="296" cy="108" r="14" fill="none" stroke={C.slate} strokeWidth="5" />
        <path d="M296 108l9-9" stroke={C.slate} strokeWidth="5" strokeLinecap="round" />
        {/* the question the report cannot answer */}
        <g transform="translate(84 30)">
          <rect x="0" y="0" width="50" height="40" rx="12" fill={C.paper} />
          <path d="M14 40l-2 14 16-14z" fill={C.paper} />
          <text
            x="25"
            y="30"
            textAnchor="middle"
            fontSize="26"
            fontWeight="800"
            fill={C.coral}
            fontFamily="Inter, sans-serif"
          >
            ?
          </text>
        </g>
        <Person
          x={68}
          y={92}
          scale={1.05}
          skin={SKIN[0]}
          hair={HAIR[0]}
          shirt={C.indigo}
          trouser={C.indigoDeep}
        />
      </Tile>
    </svg>
  );
}

/** 2019–2022 — the pipeline years. The build is the only machine, and it is red more than it should be. */
export function ArtPipelineYears() {
  return (
    <svg {...svgProps} aria-labelledby="art-pipeline">
      <title id="art-pipeline">
        A build pipeline of four stages on a belt, the third one amber and retrying, with an
        engineer watching a clock
      </title>
      <Tile>
        {/* the belt */}
        <rect x="96" y="118" width="200" height="10" rx="5" fill={C.slate} opacity="0.5" />
        {[0, 1, 2, 3].map((i) => {
          const fill = [C.green, C.green, C.amber, C.line][i]!;
          return (
            <g key={i}>
              <rect
                x={104 + i * 48}
                y={78}
                width="38"
                height="34"
                rx="8"
                fill={C.paper}
                stroke={fill}
                strokeWidth="3"
              />
              <circle cx={123 + i * 48} cy={95} r="8" fill={fill} />
            </g>
          );
        })}
        {/* the retry spinning over the amber stage, which is how a flake stays invisible */}
        <path
          d="M219 39A13 13 0 1 1 206.8 47.6"
          fill="none"
          stroke={C.amber}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M215 32l10 7-10 7z" fill={C.amber} />
        {/* the clock everyone is now watching */}
        <circle cx="272" cy="52" r="22" fill={C.paper} stroke={C.indigoDeep} strokeWidth="4" />
        <path
          d="M272 40v13l9 6"
          stroke={C.indigoDeep}
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
        <Person
          x={30}
          y={94}
          scale={1}
          skin={SKIN[2]}
          hair={HAIR[2]}
          hairStyle="bun"
          shirt={C.coral}
          trouser="#9f1239"
        />
      </Tile>
    </svg>
  );
}

/** 2023–2025 — the agent years. The model writes faster than anyone can read. */
export function ArtAgentYears() {
  return (
    <svg {...svgProps} aria-labelledby="art-agents">
      <title id="art-agents">
        A robot producing a tall stack of generated tests while a reviewer holds up a hand, with one
        page marked accepted
      </title>
      <Tile warm>
        {/* the machine, producing */}
        <g transform="translate(28 74)">
          <rect x="6" y="18" width="58" height="50" rx="15" fill={C.indigo} />
          <rect x="18" y="31" width="34" height="21" rx="8" fill={C.paper} />
          <circle cx="28" cy="41" r="4" fill={C.ink} />
          <circle cx="42" cy="41" r="4" fill={C.ink} />
          <rect x="31" y="2" width="8" height="13" rx="4" fill={C.slate} />
          <circle cx="35" cy="1" r="5" fill={C.amber} />
          <rect x="18" y="68" width="14" height="15" rx="5" fill={C.indigoDeep} />
          <rect x="38" y="68" width="14" height="15" rx="5" fill={C.indigoDeep} />
        </g>
        {/* the stack it produces, faster than it can be read */}
        {[0, 1, 2, 3, 4].map((i) => (
          <g
            key={i}
            transform={`translate(${118 + i * 3} ${152 - i * 24}) rotate(${i % 2 ? -3 : 2})`}
          >
            <rect width="62" height="22" rx="5" fill={C.paper} stroke={C.line} strokeWidth="1.5" />
            <rect x="8" y="7" width="30" height="4" rx="2" fill={C.line} />
            <rect x="8" y="14" width="18" height="4" rx="2" fill={C.line} />
          </g>
        ))}
        {/* one of them reviewed and accepted: the proposal that a person let through */}
        <g transform="translate(196 34)">
          <rect width="62" height="26" rx="6" fill={C.paper} stroke={C.green} strokeWidth="2.5" />
          <path
            d="M12 13l6 7 12-13"
            stroke={C.green}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <rect x="38" y="11" width="16" height="4" rx="2" fill={C.green} />
        </g>
        {/* the reviewer, holding the queue back */}
        <Person
          x={252}
          y={92}
          scale={1}
          skin={SKIN[1]}
          hair={HAIR[1]}
          hairStyle="curly"
          shirt={C.teal}
          trouser={C.tealDeep}
          armUp
        />
      </Tile>
    </svg>
  );
}

/** Era order → its scene. */
export const ERA_ART: Record<number, () => React.JSX.Element> = {
  1: ArtGridYears,
  2: ArtPipelineYears,
  3: ArtAgentYears,
};

export const YEAR_ART: Record<number, () => React.JSX.Element> = {
  2026: ArtEvidence,
  2027: ArtSharedTruth,
  2028: ArtSelfHealing,
  2029: ArtOrchestrated,
  2030: ArtGoverned,
};

/**
 * The hero at phone width, drawn as two rows instead of one road.
 *
 * The wide rail is one continuous line, which is the right picture and the wrong one for 390px:
 * the ladder — the part of the page that is actually a roadmap — ends up off-screen behind a
 * horizontal scroll, and so does the today marker. So a narrow screen gets the same story broken
 * at the join it already has: the years behind on top, the five ahead beneath, both whole.
 *
 * The per-year labels go: eleven of them will not fit legibly, and the era brackets carry the
 * same information. The range is spelled out underneath instead.
 */
function JourneyRailStacked({
  past,
  eras,
  years,
  current,
  description,
}: {
  past: readonly { year: number; era: number }[];
  eras: readonly { order: number; name: string }[];
  years: readonly number[];
  current: number;
  description: string;
}) {
  const pastY = 46;
  const ladderY = 164;
  const pastX = (i: number) => 24 + (i * 312) / (past.length - 1);
  const ladderX = [40, 108, 176, 244, 312];
  const eraColor = [C.slate, C.tealDeep, C.indigo];
  const currentIndex = years.indexOf(current);
  const todayX = currentIndex === -1 ? pastX(past.length - 1) : ladderX[currentIndex]!;
  const todayY = currentIndex === -1 ? pastY : ladderY;

  return (
    <svg viewBox="0 0 360 236" className="h-auto w-full" role="img" aria-labelledby="art-journey-s">
      <title id="art-journey-s">{description}</title>

      {/* row one: the years behind, as eras */}
      <path
        d={`M${pastX(0)} ${pastY}H${pastX(past.length - 1)}`}
        stroke={C.slate}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.4"
      />
      {past.map((stop, i) => (
        <circle
          key={stop.year}
          cx={pastX(i)}
          cy={pastY}
          r="5"
          fill={eraColor[stop.era - 1] ?? C.slate}
        />
      ))}
      {eras.map((era) => {
        const indexes = past.flatMap((stop, i) => (stop.era === era.order ? [i] : []));
        const from = pastX(indexes[0]!);
        const to = pastX(indexes[indexes.length - 1]!);
        return (
          <g key={era.order}>
            <path
              d={`M${from - 8} ${pastY + 16}v5h${to - from + 16}v-5`}
              fill="none"
              stroke={eraColor[era.order - 1] ?? C.slate}
              strokeWidth="2"
              opacity="0.7"
            />
            <text
              x={(from + to) / 2}
              y={pastY + 37}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="var(--muted)"
              fontFamily="Inter, sans-serif"
            >
              {era.name}
            </text>
          </g>
        );
      })}
      {/* The range labels the row from above; centred underneath it collided with an era name. */}
      <text
        x="24"
        y={pastY - 14}
        fontSize="13"
        fontWeight="700"
        fill="var(--fg)"
        fontFamily="Inter, sans-serif"
      >
        {`${past[0]?.year}\u2013${past[past.length - 1]?.year}`}
      </text>

      {/* row two: the mark unrolled, at phone scale */}
      <path
        d={`M${ladderX[0]} ${ladderY}H${ladderX[4]}`}
        stroke="var(--brand)"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.28"
      />
      <circle cx={ladderX[0]} cy={ladderY} r="9" fill="var(--brand)" />
      <circle cx={ladderX[4]} cy={ladderY} r="9" fill="var(--brand)" />
      <path
        d={`M${ladderX[1]! + 9} ${ladderY - 16}a18 18 0 000 32`}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d={`M${ladderX[3]! - 9} ${ladderY - 16}a18 18 0 010 32`}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle
        cx={ladderX[2]}
        cy={ladderY}
        r="15"
        fill="none"
        stroke="var(--brand)"
        strokeWidth="6"
      />
      <circle cx={ladderX[2]} cy={ladderY} r="5" fill="var(--brand)" />

      <g>
        <circle
          className="pulse-today"
          cx={todayX}
          cy={todayY}
          r="17"
          fill="none"
          stroke={C.amber}
          strokeWidth="3"
        />
        <path
          d={`M${todayX} ${todayY - 25}v-14`}
          stroke={C.amber}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect x={todayX + 1} y={todayY - 55} width="44" height="17" rx="5" fill={C.amber} />
        <text
          x={todayX + 8}
          y={todayY - 43}
          fontSize="11"
          fontWeight="700"
          fill="#3b1d00"
          fontFamily="Inter, sans-serif"
        >
          today
        </text>
      </g>

      {years.map((yr, i) => (
        <g key={yr}>
          <text
            x={ladderX[i]}
            y={ladderY + 36}
            textAnchor="middle"
            fontSize="17"
            fontWeight="800"
            fill="var(--fg)"
            fontFamily="Inter, sans-serif"
          >
            {yr}
          </text>
          <text
            x={ladderX[i]}
            y={ladderY + 52}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted)"
            fontFamily="Inter, sans-serif"
          >
            level {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * The hero: the whole road, from the first year on it to the last rung of the ladder.
 *
 * Two halves, drawn differently on purpose. The years behind us are small, evenly spaced stops
 * grouped into three eras — they are context, not commitments. The five years ahead are the SDODS
 * mark unrolled: an endpoint, a gate, a pivot, a gate and an endpoint, because that is the brand
 * and it is exactly five elements long. Amber means today, and nothing else on this page is amber.
 */
interface RailProps {
  past: readonly { year: number; era: number }[];
  eras: readonly { order: number; name: string }[];
  years: readonly number[];
  current: number;
}

function JourneyRailWide({
  past,
  eras,
  years,
  current,
  description,
}: RailProps & { description: string }) {
  const y = 104;
  const pastX = (i: number) => 56 + i * 42;
  const futureX = [620, 760, 900, 1040, 1180];
  const eraColor = [C.slate, C.tealDeep, C.indigo];
  const lastPast = pastX(past.length - 1);
  // The today flag sits on a year in the ladder half, or on the last stop behind us if the
  // calendar has not reached the ladder yet.
  const currentIndex = years.indexOf(current);
  const todayX = currentIndex === -1 ? lastPast : futureX[currentIndex]!;

  return (
    <svg viewBox="0 0 1240 200" className="h-auto w-full" role="img" aria-labelledby="art-journey">
      <title id="art-journey">{description}</title>

      {/* the road behind: thin, because it is context rather than commitment */}
      <path
        d={`M${pastX(0)} ${y}H${lastPast}`}
        stroke={C.slate}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.4"
      />
      {/* the join between the two halves, dashed where the story hands over */}
      <path
        d={`M${lastPast} ${y}H${futureX[0]}`}
        stroke={C.slate}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="2 12"
        opacity="0.5"
      />
      {/* the road ahead: the brand weight */}
      <path
        d={`M${futureX[0]} ${y}H${futureX[4]}`}
        stroke="var(--brand)"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.28"
      />

      {past.map((stop, i) => (
        <g key={stop.year}>
          <circle cx={pastX(i)} cy={y} r="6.5" fill={eraColor[stop.era - 1] ?? C.slate} />
          <text
            x={pastX(i)}
            y={y + 26}
            textAnchor="middle"
            fontSize="15"
            fill="var(--muted)"
            fontFamily="Inter, sans-serif"
          >
            {stop.year}
          </text>
        </g>
      ))}

      {/* one bracket per era, under the years it covers */}
      {eras.map((era) => {
        const indexes = past.flatMap((stop, i) => (stop.era === era.order ? [i] : []));
        const from = pastX(indexes[0]!);
        const to = pastX(indexes[indexes.length - 1]!);
        return (
          <g key={era.order}>
            <path
              d={`M${from - 12} ${y + 40}v6h${to - from + 24}v-6`}
              fill="none"
              stroke={eraColor[era.order - 1] ?? C.slate}
              strokeWidth="2.5"
              opacity="0.7"
            />
            <text
              x={(from + to) / 2}
              y={y + 66}
              textAnchor="middle"
              fontSize="14"
              fontWeight="600"
              fill="var(--muted)"
              fontFamily="Inter, sans-serif"
            >
              {era.name}
            </text>
          </g>
        );
      })}

      {/* the mark, unrolled. Endpoints first and last, gates either side of the pivot. */}
      <circle cx={futureX[0]} cy={y} r="14" fill="var(--brand)" />
      <circle cx={futureX[4]} cy={y} r="14" fill="var(--brand)" />
      <path
        d={`M${futureX[1]! + 14} ${y - 26}a30 30 0 000 52`}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d={`M${futureX[3]! - 14} ${y - 26}a30 30 0 010 52`}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <circle cx={futureX[2]} cy={y} r="24" fill="none" stroke="var(--brand)" strokeWidth="9" />
      <circle cx={futureX[2]} cy={y} r="8" fill="var(--brand)" />

      {/* today */}
      <g>
        <circle
          className="pulse-today"
          cx={todayX}
          cy={y}
          r="26"
          fill="none"
          stroke={C.amber}
          strokeWidth="4"
        />
        <path
          d={`M${todayX} ${y - 40}v-26`}
          stroke={C.amber}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect x={todayX + 2} y={y - 72} width="62" height="22" rx="6" fill={C.amber} />
        <text
          x={todayX + 12}
          y={y - 56}
          fontSize="14"
          fontWeight="700"
          fill="#3b1d00"
          fontFamily="Inter, sans-serif"
        >
          today
        </text>
      </g>

      {years.map((yr, i) => (
        <g key={yr}>
          <text
            x={futureX[i]}
            y={y + 52}
            textAnchor="middle"
            fontSize="26"
            fontWeight="800"
            fill="var(--fg)"
            fontFamily="Inter, sans-serif"
          >
            {yr}
          </text>
          <text
            x={futureX[i]}
            y={y + 72}
            textAnchor="middle"
            fontSize="14"
            fill="var(--muted)"
            fontFamily="Inter, sans-serif"
          >
            level {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * The hero rail, in whichever shape the screen can actually hold.
 *
 * A phone gets the two-row version, whole. Anything wider gets the one continuous road, inside a
 * scroll region with a fade, because sixteen years is genuinely wider than a laptop at the size
 * the years need to be readable.
 */
export function JourneyRail(props: RailProps) {
  const { past, eras, years, current } = props;
  // One string, not interpolated children: React splits mixed text and expressions into separate
  // text nodes, which the SVG <title> element hydrates as a mismatch.
  const description =
    `One road from ${past[0]?.year} to ${years[years.length - 1]}: ${past.length} small stops ` +
    `grouped into ${eras.map((e) => e.name.toLowerCase()).join(', ')}, then the five years of ` +
    `the ladder drawn as the SDODS mark unrolled, with today marked on ${current}`;

  return (
    <>
      <div className="md:hidden">
        <JourneyRailStacked {...props} description={description} />
      </div>
      <div className="relative hidden md:block">
        <div
          tabIndex={0}
          role="region"
          aria-label={`The road from ${past[0]?.year} to ${years[years.length - 1]}, scrolls sideways`}
          className="overflow-x-auto"
        >
          <div className="min-w-[900px]">
            <JourneyRailWide {...props} description={description} />
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[var(--bg)] to-transparent lg:hidden"
        />
      </div>
    </>
  );
}
