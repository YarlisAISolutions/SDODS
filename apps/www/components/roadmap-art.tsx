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

export const YEAR_ART: Record<number, () => React.JSX.Element> = {
  2026: ArtEvidence,
  2027: ArtSharedTruth,
  2028: ArtSelfHealing,
  2029: ArtOrchestrated,
  2030: ArtGoverned,
};

/**
 * The hero. The mark is an endpoint, a gate, a pivot, a gate and an endpoint, so the five
 * years are drawn as exactly those five elements on one rail. Amber means today, and nothing
 * else on this page is amber.
 */
export function RailHero({ years, current }: { years: readonly number[]; current: number }) {
  const xs = [110, 300, 490, 680, 870];
  const y = 100;
  return (
    <svg viewBox="0 0 960 176" className="h-auto w-full" role="img" aria-labelledby="art-rail">
      <title id="art-rail">
        Five years drawn as the SDODS mark unrolled: an endpoint, a gate, a pivot, a gate and an
        endpoint, with today marked on {current}
      </title>
      <path
        d={`M${xs[0]} ${y}H${xs[4]}`}
        stroke="var(--brand)"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.28"
      />
      {/* 2026 and 2030: the endpoints */}
      <circle cx={xs[0]} cy={y} r="14" fill="var(--brand)" />
      <circle cx={xs[4]} cy={y} r="14" fill="var(--brand)" />
      {/* 2027 and 2029: the gates */}
      <path
        d={`M${xs[1] + 14} ${y - 26}a30 30 0 000 52`}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d={`M${xs[3] - 14} ${y - 26}a30 30 0 010 52`}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* 2028: the pivot */}
      <circle cx={xs[2]} cy={y} r="24" fill="none" stroke="var(--brand)" strokeWidth="9" />
      <circle cx={xs[2]} cy={y} r="8" fill="var(--brand)" />

      {/* today */}
      <g>
        <circle
          className="pulse-today"
          cx={xs[years.indexOf(current)] ?? xs[0]}
          cy={y}
          r="26"
          fill="none"
          stroke={C.amber}
          strokeWidth="4"
        />
        <path
          d={`M${xs[years.indexOf(current)] ?? xs[0]} ${y - 40}v-26`}
          stroke={C.amber}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect
          x={(xs[years.indexOf(current)] ?? xs[0]) + 2}
          y={y - 72}
          width="62"
          height="22"
          rx="6"
          fill={C.amber}
        />
        <text
          x={(xs[years.indexOf(current)] ?? xs[0]) + 12}
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
            x={xs[i]}
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
            x={xs[i]}
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
