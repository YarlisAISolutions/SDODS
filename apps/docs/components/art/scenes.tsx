/**
 * The illustrations used on the getting-started pages and in the workshop.
 *
 * Each scene answers one question the prose next to it is about to answer, so the drawing is
 * read before the paragraph rather than instead of it. Scenes are registered in `SCENES` and
 * placed from MDX with `<Art scene="…" caption="…" />`.
 */
import { C, Chip, HAIR, Label, Person, Robot, SKIN, TerminalBox, Tick, Tile } from './kit';

const tile = { viewBox: '0 0 320 220', className: 'h-auto w-full', role: 'img' as const };
const wide = { viewBox: '0 0 640 240', className: 'h-auto w-full', role: 'img' as const };

/* ─────────────────────────────  Installation  ───────────────────────────── */

/** One command, five things it does, one doctor check at the end. */
function InstallOneCommand() {
  const stops = [
    { label: 'Node 22', hint: 'checked' },
    { label: 'Bun', hint: 'installed' },
    { label: '~/.sdods', hint: 'cloned' },
    { label: 'Chromium', hint: 'downloaded' },
    { label: 'sdods', hint: 'on PATH' },
  ];
  return (
    <svg {...wide} aria-labelledby="art-install-one">
      <title id="art-install-one">
        One installer command running along a rail through five stops — Node, Bun, the checkout,
        Chromium and the sdods command — and finishing with a passing doctor check
      </title>
      <Tile width={640} height={240}>
        <TerminalBox
          x={22}
          y={38}
          width={210}
          height={96}
          command="curl -fsSL … | sh"
          lines={[
            { text: 'checking node …', fill: C.slate },
            { text: 'installing bun …', fill: C.slate },
            { text: 'fetching sdods …', fill: C.teal },
          ]}
        />
        {/* the rail: the brand mark drawn long */}
        <path d="M240 128h356" stroke={C.line} strokeWidth="6" strokeLinecap="round" />
        {stops.map((s, i) => {
          const x = 250 + i * 74;
          const last = i === stops.length - 1;
          return (
            <g key={s.label}>
              <circle cx={x} cy={128} r={last ? 13 : 10} fill={last ? C.amber : C.indigo} />
              {last && <circle cx={x} cy={128} r="5" fill={C.paper} />}
              <rect
                x={x - 35}
                y={72}
                width="70"
                height="38"
                rx="9"
                fill={C.paper}
                stroke={C.line}
              />
              <Label x={x} y={88} anchor="middle" size={9} fill={C.ink} weight="600" mono>
                {s.label}
              </Label>
              <Label x={x} y={101} anchor="middle" size={9}>
                {s.hint}
              </Label>
              <path d={`M${x} 110v8`} stroke={C.line} strokeWidth="3" strokeLinecap="round" />
            </g>
          );
        })}
        <Tick x={608} y={128} r={14} />
        <Label x={608} y={162} anchor="middle" size={10} fill={C.tealDeep} weight="600">
          doctor
        </Label>
        <Label x={132} y={158} size={10} fill={C.slate}>
          about two minutes
        </Label>
        <Person
          x={64}
          y={148}
          scale={0.85}
          skin={SKIN[1]}
          hair={HAIR[1]}
          hairStyle="curly"
          shirt={C.teal}
          trouser={C.tealDeep}
          armUp
          mood="delighted"
        />
      </Tile>
    </svg>
  );
}

/** Where the bytes land, and what stays untouched. */
function InstallWhereThingsLand() {
  const shelves = [
    { label: '~/.sdods/app', hint: 'the checkout', fill: '#e0e7ff' },
    { label: '~/.sdods/.bun', hint: 'only if missing', fill: '#ccfbf1' },
    { label: '~/.local/bin', hint: 'the sdods shim', fill: '#fef3c7' },
    { label: 'ms-playwright', hint: 'shared browser cache', fill: '#fee2e2' },
  ];
  return (
    <svg {...tile} aria-labelledby="art-install-where">
      <title id="art-install-where">
        Four labelled crates on a shelf showing where the installer writes, with the rest of the
        machine behind a padlock
      </title>
      <Tile tone="mint">
        {shelves.map((s, i) => (
          <g key={s.label} transform={`translate(20 ${22 + i * 42})`}>
            <rect width="200" height="32" rx="8" fill={s.fill} stroke={C.line} />
            <Label x={12} y={14} size={10} fill={C.ink} weight="600" mono>
              {s.label}
            </Label>
            <Label x={12} y={26} size={9}>
              {s.hint}
            </Label>
          </g>
        ))}
        {/* the rest of the machine, locked */}
        <rect x="238" y="52" width="62" height="86" rx="10" fill={C.paper} stroke={C.line} />
        <rect x="250" y="78" width="38" height="30" rx="6" fill={C.slate} opacity="0.25" />
        <path
          d="M258 78v-8a11 11 0 0122 0v8"
          stroke={C.indigoDeep}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="269" cy="94" r="5" fill={C.indigoDeep} />
        <Label x={269} y={44} anchor="middle" size={9} fill={C.indigoDeep} weight="600">
          your machine
        </Label>
        <Label x={269} y={152} anchor="middle" size={9}>
          untouched
        </Label>
        <Person
          x={247}
          y={160}
          scale={0.55}
          skin={SKIN[2]}
          hair={HAIR[2]}
          hairStyle="bun"
          shirt={C.coral}
          trouser={C.coralDeep}
        />
      </Tile>
    </svg>
  );
}

/** doctor: what is green, what needs a hand. */
function InstallDoctor() {
  const rows = [
    { label: 'Node 22.22', ok: true },
    { label: 'Bun 1.3', ok: true },
    { label: 'chromium', ok: true },
    { label: 'firefox', ok: false },
    { label: 'projects: 2', ok: true },
  ];
  return (
    <svg {...tile} aria-labelledby="art-install-doctor">
      <title id="art-install-doctor">
        A robot holding a checklist against a laptop: four checks pass, one browser is missing and
        is offered a fix
      </title>
      <Tile tone="warm">
        <rect x="130" y="20" width="176" height="176" rx="12" fill={C.paper} stroke={C.line} />
        <Label x={146} y={42} size={11} fill={C.ink} weight="700">
          sdods doctor
        </Label>
        {rows.map((r, i) => (
          <g key={r.label} transform={`translate(146 ${54 + i * 22})`}>
            {r.ok ? (
              <Tick x={8} y={8} r={7} />
            ) : (
              <>
                <circle cx="8" cy="8" r="7" fill={C.amber} />
                <path d="M8 4v5" stroke={C.paper} strokeWidth="2" strokeLinecap="round" />
                <circle cx="8" cy="11.6" r="1.2" fill={C.paper} />
              </>
            )}
            <Label x={24} y={12} size={10} fill={C.ink} mono>
              {r.label}
            </Label>
          </g>
        ))}
        <Chip x={146} y={166} label="--fix installs it" fill="#fef3c7" text={C.amberDeep} />
        <Robot x={22} y={74} scale={1.05} />
      </Tile>
    </svg>
  );
}

/** The locked-down laptop: proxy, private CA, pinned version, no network at all. */
function InstallLockedDown() {
  return (
    <svg {...tile} aria-labelledby="art-install-locked">
      <title id="art-install-locked">
        An installer request crossing a corporate wall through a proxy gate carrying a certificate,
        arriving at a pinned version
      </title>
      <Tile tone="warm">
        <TerminalBox
          x={14}
          y={30}
          width={116}
          height={78}
          scale={0.95}
          command="install.sh"
          lines={[
            { text: '--version v0.2.0', fill: C.amber },
            { text: 'HTTPS_PROXY set', fill: C.slate },
          ]}
        />
        {/* the wall */}
        <g>
          {[0, 1, 2, 3, 4].map((r) => (
            <g key={r}>
              <rect x="152" y={26 + r * 26} width="40" height="22" rx="4" fill="#fed7aa" />
              <rect x="196" y={26 + r * 26} width="26" height="22" rx="4" fill="#fdba74" />
            </g>
          ))}
          {/* the gate */}
          <rect
            x="152"
            y="104"
            width="70"
            height="44"
            rx="8"
            fill={C.paper}
            stroke={C.amber}
            strokeWidth="3"
          />
          <Label x={187} y={122} anchor="middle" size={9} fill={C.amberDeep} weight="700">
            proxy
          </Label>
          <Label x={187} y={136} anchor="middle" size={8.5}>
            + private CA
          </Label>
        </g>
        <path
          d="M132 126h16M226 126h22"
          stroke={C.indigoDeep}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M244 120l8 6-8 6" fill={C.indigoDeep} />
        <rect x="252" y="86" width="54" height="76" rx="10" fill={C.paper} stroke={C.line} />
        <Label x={279} y={108} anchor="middle" size={9} fill={C.ink} weight="600">
          pinned
        </Label>
        <Label x={279} y={122} anchor="middle" size={9} mono fill={C.indigoDeep}>
          v0.2.0
        </Label>
        <Tick x={279} y={144} r={10} />
        <Person
          x={40}
          y={122}
          scale={0.72}
          skin={SKIN[0]}
          hair={HAIR[3]}
          hairStyle="long"
          shirt={C.indigo}
          trouser={C.indigoDeep}
          mood="thinking"
        />
      </Tile>
    </svg>
  );
}

/* ─────────────────────────────  Onboarding  ───────────────────────────── */

/** analyze reads; it does not write. The padlock is the point. */
function OnboardScan() {
  return (
    <svg {...wide} aria-labelledby="art-onboard-scan">
      <title id="art-onboard-scan">
        An engineer passing a magnifier over an application repository while findings — framework,
        routes, test id attribute, existing specs — pop out as labelled stickers; the repository
        carries a read-only padlock
      </title>
      <Tile width={640} height={240}>
        {/* the engineer doing the reading */}
        <Person
          x={18}
          y={104}
          scale={0.95}
          skin={SKIN[3]}
          hair={HAIR[0]}
          shirt={C.teal}
          trouser={C.tealDeep}
          mood="thinking"
        />
        {/* the repository */}
        <rect x={84} y={44} width={166} height={152} rx={14} fill={C.paper} stroke={C.line} />
        <path d="M84 70h166" stroke={C.line} strokeWidth="2" />
        <Label x={100} y={62} size={10} fill={C.ink} weight="700" mono>
          ../your-app
        </Label>
        {['package.json', 'src/containers/', 'backend/routes.ts', 'cypress/tests/', '.env'].map(
          (f, i) => (
            <g key={f}>
              <rect
                x={100}
                y={84 + i * 22}
                width="10"
                height="10"
                rx="2"
                fill={C.indigo}
                opacity="0.4"
              />
              <Label x={118} y={93 + i * 22} size={9.5} mono>
                {f}
              </Label>
            </g>
          ),
        )}
        {/* read-only padlock */}
        <g transform="translate(224 52)">
          <rect width="18" height="14" y="6" rx="3" fill={C.tealDeep} />
          <path d="M4 6V3.5a5 5 0 0110 0V6" stroke={C.tealDeep} strokeWidth="2.6" fill="none" />
        </g>
        <Label x={167} y={212} anchor="middle" size={9} fill={C.tealDeep} weight="600">
          read-only
        </Label>
        {/* magnifier */}
        <circle
          cx={244}
          cy={140}
          r={30}
          fill={C.paper}
          opacity="0.5"
          stroke={C.amber}
          strokeWidth="6"
        />
        <path d="M266 162l16 16" stroke={C.amber} strokeWidth="8" strokeLinecap="round" />
        {/* findings */}
        <Chip x={306} y={30} label="Express 4.20" fill="#e0e7ff" text={C.indigoDeep} />
        <Chip x={306} y={68} label="React Router 5.3" fill="#e0e7ff" text={C.indigoDeep} />
        <Chip x={306} y={106} label="7 pages · 10 endpoints" fill="#ccfbf1" text={C.tealDeep} />
        <Chip x={306} y={144} label="data-test ×107" fill="#fef3c7" text={C.amberDeep} />
        <Chip x={306} y={182} label="33 Cypress specs" fill="#fee2e2" text={C.coralDeep} />
        <Label x={620} y={44} anchor="end" size={9}>
          90% confidence
        </Label>
        <Label x={620} y={82} anchor="end" size={9}>
          80% confidence
        </Label>
        <Label x={620} y={120} anchor="end" size={9}>
          read from the router
        </Label>
        <Label x={620} y={158} anchor="end" size={9}>
          counted, not guessed
        </Label>
        <Label x={620} y={196} anchor="end" size={9}>
          locators to migrate
        </Label>
      </Tile>
    </svg>
  );
}

/** The proposal is handed to a person. Nothing is written until they say so. */
function OnboardProposal() {
  return (
    <svg {...tile} aria-labelledby="art-onboard-proposal">
      <title id="art-onboard-proposal">
        A robot holding out a proposed project file while an engineer reviews it with a pen; the
        folder behind them is still empty
      </title>
      <Tile>
        <rect x="112" y="22" width="126" height="150" rx="10" fill={C.paper} stroke={C.line} />
        <Label x={126} y={42} size={10} fill={C.ink} weight="700" mono>
          sdods.project.yaml
        </Label>
        {[
          'slug: your-app',
          'testIdAttribute:',
          '  data-test',
          'layers: [ui, api]',
          'routes: 7',
          'modules: 6',
        ].map((l, i) => (
          <Label
            key={l}
            x={126}
            y={62 + i * 15}
            size={9}
            mono
            fill={i === 2 ? C.amberDeep : C.slate}
          >
            {l}
          </Label>
        ))}
        <Chip x={126} y={148} label="proposal · not written" fill="#fef3c7" text={C.amberDeep} />
        <Robot x={16} y={70} scale={0.9} />
        <Person
          x={256}
          y={92}
          scale={0.82}
          skin={SKIN[1]}
          hair={HAIR[1]}
          hairStyle="curly"
          shirt={C.coral}
          trouser={C.coralDeep}
          armUp
        />
      </Tile>
    </svg>
  );
}

/** --apply: the files land. */
function OnboardApply() {
  const files = ['sdods.project.yaml', 'envs/local.yaml', 'features/ ×14', 'pages/ · steps/'];
  return (
    <svg {...tile} aria-labelledby="art-onboard-apply">
      <title id="art-onboard-apply">
        Four generated files flying into a project folder, with a green tick on the folder
      </title>
      <Tile tone="mint">
        {files.map((f, i) => (
          <g key={f} transform={`translate(16 ${28 + i * 34})`}>
            <rect width="126" height="26" rx="6" fill={C.paper} stroke={C.line} />
            <Label x={10} y={17} size={9} mono fill={C.ink}>
              {f}
            </Label>
            <path
              d={`M132 13h${28 + i * 4}`}
              stroke={C.teal}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="5 5"
            />
          </g>
        ))}
        {/* folder */}
        <path
          d="M200 66h34l10 12h58a10 10 0 0110 10v78a10 10 0 01-10 10h-102a10 10 0 01-10-10V76a10 10 0 0110-10z"
          fill={C.indigo}
        />
        <rect x="204" y="94" width="102" height="70" rx="8" fill={C.paper} />
        <Label x={255} y={122} anchor="middle" size={10} fill={C.ink} weight="700" mono>
          projects/
        </Label>
        <Label x={255} y={136} anchor="middle" size={9} mono>
          your-app
        </Label>
        <Tick x={300} y={160} r={12} />
      </Tile>
    </svg>
  );
}

/** The first green run: the API layer and, once it has a login, the UI layer. */
function OnboardFirstGreen() {
  return (
    <svg {...wide} aria-labelledby="art-onboard-green">
      <title id="art-onboard-green">
        A terminal showing nine passing API scenarios beside a card showing four passing UI
        scenarios, and a delighted engineer
      </title>
      <Tile width={640} height={240} tone="mint">
        <TerminalBox
          x={26}
          y={40}
          width={268}
          height={150}
          command="sdods run -p rwa-bank -e local -l api"
          lines={[
            { text: '✓ GET /checkAuth responds', fill: C.green },
            { text: '✓ GET /login responds', fill: C.green },
            { text: '✓ GET /profile/{username}', fill: C.green },
            { text: '✓ GET /search responds', fill: C.green },
            { text: '', fill: C.slate },
            { text: '9 passed · 0 failed · 3 s', fill: C.paper },
          ]}
        />
        {/* the UI layer, after the login it was missing */}
        <rect x={306} y={40} width={212} height={150} rx={12} fill={C.paper} stroke={C.line} />
        <Label x={322} y={62} size={10} fill={C.ink} weight="700">
          ui · @smoke · chromium
        </Label>
        {['signin', 'signup', 'personal', 'contacts'].map((r, i) => (
          <g key={r} transform={`translate(322 ${74 + i * 24})`}>
            <Tick x={9} y={9} r={9} />
            <Label x={28} y={13} size={9.5} mono fill={C.ink}>
              {`/${r}`}
            </Label>
            {(r === 'personal' || r === 'contacts') && (
              <Chip x={96} y={0} label="@user:standard" fill="#fef3c7" text={C.amberDeep} />
            )}
          </g>
        ))}
        <Label x={322} y={178} size={9.5} mono fill={C.tealDeep} weight="600">
          4 passed · 0 failed · 5 s
        </Label>
        <Person
          x={548}
          y={92}
          scale={1}
          skin={SKIN[0]}
          hair={HAIR[2]}
          hairStyle="bun"
          shirt={C.amber}
          trouser={C.amberDeep}
          armUp
          mood="delighted"
        />
      </Tile>
    </svg>
  );
}

/** Coverage: reachability is covered, roles are not. */
function OnboardCoverage() {
  const bars = [
    { label: 'routes', done: 4, total: 4 },
    { label: 'endpoints', done: 9, total: 9 },
    { label: 'roles', done: 0, total: 2 },
  ];
  return (
    <svg {...tile} aria-labelledby="art-onboard-coverage">
      <title id="art-onboard-coverage">
        Three coverage bars: routes four of four and endpoints nine of nine are full, roles nought
        of two is empty
      </title>
      <Tile>
        <rect x={18} y={20} width={284} height={140} rx={12} fill={C.paper} stroke={C.line} />
        <Label x={34} y={42} size={10} fill={C.ink} weight="700">
          coverage · rwa-bank
        </Label>
        {bars.map((b, i) => {
          const full = b.done === b.total;
          const w = 150 * (b.total ? b.done / b.total : 0);
          return (
            <g key={b.label} transform={`translate(34 ${56 + i * 32})`}>
              <Label x={0} y={16} size={9.5} mono fill={C.ink}>
                {b.label}
              </Label>
              <rect x={72} y={4} width={150} height={16} rx={8} fill="#e2e8f0" />
              {w > 0 && <rect x={72} y={4} width={w} height={16} rx={8} fill={C.teal} />}
              <Label
                x={234}
                y={16}
                size={9.5}
                mono
                fill={full ? C.tealDeep : C.coralDeep}
                weight="600"
              >
                {`${b.done}/${b.total}`}
              </Label>
            </g>
          );
        })}
        <Chip x={18} y={172} label="13 scenarios · all @smoke" fill="#e0e7ff" text={C.indigoDeep} />
        <Chip x={196} y={172} label="roles: next" fill="#fee2e2" text={C.coralDeep} />
      </Tile>
    </svg>
  );
}

/* ─────────────────────────────  Workshop  ───────────────────────────── */

/** The workshop bench: one real app, ten stations, one afternoon. */
function WorkshopBench() {
  const stations = [
    'analyze',
    'run',
    'record',
    'data',
    'HAR',
    'visual',
    'insights',
    'agents',
    'MCP',
    'CI',
  ];
  return (
    <svg {...wide} aria-labelledby="art-workshop-bench">
      <title id="art-workshop-bench">
        A workbench with a real application on the left and ten labelled stations along a rail,
        worked through by two engineers
      </title>
      <Tile width={640} height={240} tone="warm">
        {/* the app under test */}
        <rect x="26" y="46" width="132" height="104" rx="10" fill={C.paper} stroke={C.line} />
        <rect x="26" y="46" width="132" height="18" rx="10" fill={C.indigo} />
        <circle cx="38" cy="55" r="3" fill={C.paper} opacity="0.8" />
        <rect x="40" y="76" width="52" height="8" rx="4" fill={C.line} />
        <rect x="40" y="92" width="104" height="8" rx="4" fill="#e2e8f0" />
        <rect x="40" y="108" width="80" height="8" rx="4" fill="#e2e8f0" />
        <rect x="40" y="126" width="46" height="14" rx="7" fill={C.teal} />
        <Label x={92} y={166} anchor="middle" size={10} fill={C.ink} weight="600">
          a real open-source app
        </Label>
        {/* the rail of stations */}
        <path d="M186 96h430" stroke={C.line} strokeWidth="6" strokeLinecap="round" />
        {stations.map((s, i) => {
          const x = 200 + i * 46;
          return (
            <g key={s}>
              <circle cx={x} cy={96} r="8" fill={i < 2 ? C.amber : C.indigo} />
              <Label x={x} y={78} anchor="middle" size={8.5} fill={C.ink} weight="600" mono>
                {s}
              </Label>
            </g>
          );
        })}
        <Label x={200} y={126} size={9} fill={C.amberDeep} weight="600">
          start here
        </Label>
        <Person
          x={300}
          y={132}
          scale={0.82}
          skin={SKIN[2]}
          hair={HAIR[0]}
          shirt={C.indigo}
          trouser={C.indigoDeep}
        />
        <Person
          x={370}
          y={132}
          scale={0.82}
          skin={SKIN[3]}
          hair={HAIR[3]}
          hairStyle="long"
          shirt={C.coral}
          trouser={C.coralDeep}
          armUp
          mood="delighted"
        />
        <Robot x={470} y={128} scale={0.72} />
      </Tile>
    </svg>
  );
}

/** Migration: a CSS selector becomes a role or test-id locator, as a proposal. */
function WorkshopMigrate() {
  return (
    <svg {...tile} aria-labelledby="art-workshop-migrate">
      <title id="art-workshop-migrate">
        A brittle CSS selector on the left being rewritten as a test-id locator on the right, with
        the change waiting in a review queue
      </title>
      <Tile>
        <rect x="16" y="34" width="128" height="62" rx="10" fill="#fee2e2" stroke={C.coral} />
        <Label x={28} y={54} size={9} fill={C.coralDeep} weight="700">
          before
        </Label>
        <Label x={28} y={72} size={8.5} mono fill={C.ink}>
          .MuiList &gt; li:nth(2)
        </Label>
        <Label x={28} y={86} size={8.5} mono fill={C.slate}>
          breaks on refactor
        </Label>
        <rect x="176" y="34" width="128" height="62" rx="10" fill="#dcfce7" stroke={C.green} />
        <Label x={188} y={54} size={9} fill={C.tealDeep} weight="700">
          after
        </Label>
        <Label x={188} y={72} size={8.5} mono fill={C.ink}>
          data-test=&quot;user-list&quot;
        </Label>
        <Label x={188} y={86} size={8.5} mono fill={C.slate}>
          survives it
        </Label>
        <path d="M148 66h22" stroke={C.indigoDeep} strokeWidth="4" strokeLinecap="round" />
        <path d="M168 60l8 6-8 6" fill={C.indigoDeep} />
        <rect x="60" y="118" width="200" height="54" rx="10" fill={C.paper} stroke={C.line} />
        <Label x={76} y={138} size={10} fill={C.ink} weight="700">
          proposal queue
        </Label>
        <Label x={76} y={154} size={9}>
          you approve, then it lands
        </Label>
        <Tick x={238} y={146} r={11} />
        <Robot x={16} y={122} scale={0.5} />
      </Tile>
    </svg>
  );
}

/** The suite in CI: sharded, tagged, scheduled, reported. */
function WorkshopShip() {
  return (
    <svg {...tile} aria-labelledby="art-workshop-ship">
      <title id="art-workshop-ship">
        A pull request fanning out into three parallel shards that merge into one report, with a
        nightly clock beside it
      </title>
      <Tile tone="mint">
        <rect x="14" y="86" width="62" height="42" rx="9" fill={C.paper} stroke={C.line} />
        <Label x={45} y={104} anchor="middle" size={9.5} fill={C.ink} weight="700">
          pull
        </Label>
        <Label x={45} y={118} anchor="middle" size={9.5} fill={C.ink} weight="700">
          request
        </Label>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <path
              d={`M78 107C110 107 108 ${52 + i * 55} 136 ${52 + i * 55}`}
              stroke={C.line}
              strokeWidth="3"
              fill="none"
            />
            <rect
              x="136"
              y={38 + i * 55}
              width="76"
              height="30"
              rx="8"
              fill={C.paper}
              stroke={C.indigo}
            />
            <Label x={174} y={57 + i * 55} anchor="middle" size={9} mono fill={C.indigoDeep}>
              {`shard ${i + 1}/3`}
            </Label>
            <path
              d={`M212 ${53 + i * 55}C240 ${53 + i * 55} 238 107 258 107`}
              stroke={C.line}
              strokeWidth="3"
              fill="none"
            />
          </g>
        ))}
        <rect x="252" y="82" width="54" height="50" rx="10" fill={C.paper} stroke={C.line} />
        <Tick x={279} y={100} r={10} />
        <Label x={279} y={124} anchor="middle" size={9} fill={C.ink} weight="600">
          one report
        </Label>
        {/* nightly clock */}
        <circle cx="45" cy="176" r="17" fill={C.paper} stroke={C.amber} strokeWidth="3" />
        <path
          d="M45 166v11l7 4"
          stroke={C.amberDeep}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <Label x={72} y={174} size={9} fill={C.amberDeep} weight="600">
          nightly regression
        </Label>
        <Label x={72} y={186} size={9}>
          on a schedule
        </Label>
      </Tile>
    </svg>
  );
}

export const SCENES = {
  'install-one-command': InstallOneCommand,
  'install-where-things-land': InstallWhereThingsLand,
  'install-doctor': InstallDoctor,
  'install-locked-down': InstallLockedDown,
  'onboard-scan': OnboardScan,
  'onboard-proposal': OnboardProposal,
  'onboard-apply': OnboardApply,
  'onboard-first-green': OnboardFirstGreen,
  'onboard-coverage': OnboardCoverage,
  'workshop-bench': WorkshopBench,
  'workshop-migrate': WorkshopMigrate,
  'workshop-ship': WorkshopShip,
} as const;

export type SceneName = keyof typeof SCENES;
