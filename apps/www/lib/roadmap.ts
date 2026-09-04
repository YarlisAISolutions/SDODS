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
  'Hosted API (api.sdods.com) for shared run history',
  'OIDC single sign-on for the web UI',
  'Your idea — open a feature request',
];

export const VERIFICATION = [
  ['Unit + CLI tests', '150 passed'],
  ['Web component tests', '9 passed'],
  ['Demo smoke + sanity matrix', '23/23 on chromium, firefox, webkit'],
  ['Demo regression (chromium)', '27/27'],
  ['API layer', '10/10'],
  ['SDODS testing its own UI', '41/41 across three browsers'],
  ['Docs', '76 pages, 0 broken links'],
] as const;
