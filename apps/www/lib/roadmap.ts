export interface RoadmapPhase {
  phase: number;
  scope: string;
  status: 'done' | 'in progress' | 'planned';
  detail?: string;
}

/** Mirrors the roadmap table in README.md and the docs. */
export const ROADMAP: RoadmapPhase[] = [
  { phase: 0, scope: 'Monorepo, config precedence, registry, CLI skeleton', status: 'done' },
  { phase: 1, scope: 'API layer end to end (no browser)', status: 'done' },
  { phase: 2, scope: 'UI layer, page objects, self-healing, dashboard', status: 'done' },
  { phase: 3, scope: 'Data providers, user pool, auth capture, hybrid', status: 'done' },
  { phase: 4, scope: 'Screenshot narratives, NDJSON', status: 'done' },
  { phase: 5, scope: 'Database, ingest, switch', status: 'done' },
  { phase: 6, scope: 'Recorder and HAR', status: 'done' },
  { phase: 7, scope: 'MCP server', status: 'done' },
  { phase: 8, scope: 'Agents and insights', status: 'done' },
  { phase: 9, scope: 'Server', status: 'done' },
  { phase: 10, scope: 'Web UI', status: 'done' },
  { phase: 11, scope: 'GitHub, Jira, CI workflows', status: 'done' },
  { phase: 12, scope: 'Onboarding analysis, cross-browser matrix', status: 'done' },
  { phase: 13, scope: 'Docs site, packaging', status: 'done' },
];

export const NEXT_UP: string[] = [
  'Cross-platform visual baselines (Linux in CI)',
  'HAR fixtures per scenario for the sanity and user-pool suites',
  'Flake budgets with automatic quarantine',
  'OIDC single sign-on for the web UI',
  'Your idea — open a feature request',
];

export const VERIFICATION = [
  ['Unit + CLI tests', '182 passed'],
  ['Web component tests', '9 passed'],
  ['Demo smoke + sanity matrix', '23/23 on chromium, firefox, webkit'],
  ['Demo regression (chromium)', '27/27'],
  ['API layer', '10/10'],
  ['SDODS testing its own UI', '41/41 across three browsers'],
  ['Docs', '80 pages, 0 broken links'],
] as const;

export type HorizonStatus = 'shipped' | 'building' | 'planned' | 'direction';

export interface HorizonYear {
  year: number;
  /** Maturity level this year reaches. A real ladder: each level needs the one below it. */
  level: number;
  /** Two or three words a reader can repeat back. */
  name: string;
  status: HorizonStatus;
  /** What the customer gets, in their words, not ours. */
  value: string;
  /** Why it is worth paying attention to, one sentence. */
  because: string;
  /** What ships to deliver that value. */
  features: string[];
  /** The single thing that proves the year landed. */
  milestone: string;
}

/**
 * The five-year horizon. 2026 is delivered and verifiable today; the later years are
 * direction rather than dated commitment, and the page says so.
 */
export const HORIZON: HorizonYear[] = [
  {
    year: 2026,
    level: 1,
    name: 'Evidence',
    status: 'shipped',
    value: 'You can defend a release without being the person who remembers.',
    because:
      'Every scenario is tied to a business capability, every run reproduces from one command, and every failure carries the screenshots and requests that caused it.',
    features: [
      'BDD across UI, API and hybrid flows with one merged fixture set',
      'Before and after screenshots for every UI step, with a pixel diff',
      'Self-healing locators that record why they healed',
      'Run history in SQLite or Postgres, switchable with one flag',
      'Recorder, HAR replay, MCP server, agents, web UI, GitHub and Jira',
    ],
    milestone: 'Fourteen phases delivered, published to npm, installable in one line.',
  },
  {
    year: 2027,
    level: 2,
    name: 'Shared truth',
    status: 'building',
    value: 'Everyone reads the same history, so no one relitigates a failure.',
    because:
      'Run history moves off laptops and into one place your whole team signs into, with the flaky tests named and budgeted rather than argued about.',
    features: [
      'Hosted run history with single sign-on and existing roles',
      'Cross-platform visual baselines, so CI and laptops agree',
      'Flake budgets, automatic quarantine and a weekly digest',
      'Per-scenario network fixtures for offline suites',
      'Scheduled runs with change-aware selection',
    ],
    milestone: 'A stable 1.0 with a compatibility promise for the CLI and the run format.',
  },
  {
    year: 2028,
    level: 3,
    name: 'Self-maintaining',
    status: 'planned',
    value: 'The suite repairs itself and tells you what it changed.',
    because:
      'Maintenance is the reason automation dies. Agents take the repetitive half and leave a reviewable pull request instead of a surprise.',
    features: [
      'Agents open pull requests for locator drift, with the heal history as evidence',
      'Coverage gaps found by comparing real traffic against covered journeys',
      'Test data synthesised per environment, with sensitive fields never leaving it',
      'Failures clustered by cause, so one incident is one item and not forty',
      'Suggested scenarios from a change set, ranked by the risk they cover',
    ],
    milestone: 'Most locator drift is fixed and merged without anyone writing a selector.',
  },
  {
    year: 2029,
    level: 4,
    name: 'Orchestrated',
    status: 'direction',
    value: 'The checks, the approvals and the release live in one place.',
    because:
      'Confidence is not only tests. It is who approved, what evidence they saw, and what the system did next, held together rather than spread across four tools.',
    features: [
      'Release gates that read the evidence and hold or pass a deployment',
      'Approvals and sign-off recorded against the run that justified them',
      'Event-driven workflows across environments, data and deployments',
      'Environment provisioning hooks, so a suite can create what it needs',
      'Connectors for the trackers, chat tools and pipelines already in use',
    ],
    milestone: 'The release gate becomes the record teams point at when asked why they shipped.',
  },
  {
    year: 2030,
    level: 5,
    name: 'Governed',
    status: 'direction',
    value: 'The people who sign off get an audit trail they trust.',
    because:
      'Regulated teams need to show a chain from requirement to release. That chain is worthless unless it is complete, tamper-evident and exportable.',
    features: [
      'Policy as code: rules for tagging, coverage and approval, enforced at run time',
      'Federation across organisations, with retention and residency controls',
      'Evidence export shaped for auditors rather than for engineers',
      'Private and on-premises agent runtimes for regulated environments',
      'A signed trail from requirement through run to release',
    ],
    milestone: 'An auditor can follow one requirement to one release without asking a human.',
  },
];

/** Shown under the ladder so a reader can place their own team on it. */
export const LEVELS: ReadonlyArray<readonly [number, string, string]> = [
  [1, 'Evidence', 'Failures explain themselves'],
  [2, 'Shared truth', 'One history the team trusts'],
  [3, 'Self-maintaining', 'The suite repairs itself'],
  [4, 'Orchestrated', 'Checks and releases meet'],
  [5, 'Governed', 'Sign-off is auditable'],
] as const;
