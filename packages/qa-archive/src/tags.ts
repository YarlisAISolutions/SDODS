/**
 * The closed tag vocabulary.
 *
 * Deliberately a superset of the scenario tag taxonomy: someone who writes `@ui`, `@smoke` and
 * `@har` every day should find the filter speaking their own language. On top of those sit the
 * topic tags a forum needs and a scenario never carries — `install`, `cli`, `ci` and the rest.
 *
 * The list is closed and `archive.test.ts` rejects anything outside it, because a tag list that
 * accepts new values silently is a tag list that ends up with `ci`, `CI` and `continuous-integration`
 * as three separate filters.
 */

export const TAG_NAMES = [
  'ui',
  'api',
  'hybrid',
  'smoke',
  'regression',
  'sanity',
  'visual',
  'a11y',
  'perf',
  'mock',
  'data-driven',
  'pool',
  'har',
  'install',
  'cli',
  'config',
  'lint',
  'heal',
  'locators',
  'page-objects',
  'data',
  'recording',
  'reporting',
  'ci',
  'mcp',
  'agents',
  'docker',
  'windows',
  'macos',
  'linux',
] as const;

export type Tag = (typeof TAG_NAMES)[number];

export interface TagInfo {
  /** URL segment. */
  name: Tag;
  /** Shown under the heading on the tag page. */
  blurb: string;
  /** Scenario tags are written `@ui` in Gherkin; topic tags exist only here. */
  scenarioTag?: boolean;
}

export const TAGS: TagInfo[] = [
  // --- the scenario taxonomy, as users already write it -------------------------------------
  { name: 'ui', scenarioTag: true, blurb: 'Scenarios that drive a browser.' },
  {
    name: 'api',
    scenarioTag: true,
    blurb: 'Scenarios that talk to an HTTP API and never open a page.',
  },
  {
    name: 'hybrid',
    scenarioTag: true,
    blurb: 'Scenarios that seed through the API and assert in the browser, or the reverse.',
  },
  { name: 'smoke', scenarioTag: true, blurb: 'The fast suite that gates a pull request.' },
  { name: 'regression', scenarioTag: true, blurb: 'The broad suite, usually nightly.' },
  { name: 'sanity', scenarioTag: true, blurb: 'The narrow post-deploy check.' },
  {
    name: 'visual',
    scenarioTag: true,
    blurb: 'Screenshot baselines and how they differ per platform.',
  },
  {
    name: 'a11y',
    scenarioTag: true,
    blurb: 'Accessibility checks and what the runner does with them today.',
  },
  { name: 'perf', scenarioTag: true, blurb: 'Performance budgets and their current status.' },
  { name: 'mock', scenarioTag: true, blurb: 'Scenarios that run against stubbed network traffic.' },
  {
    name: 'data-driven',
    scenarioTag: true,
    blurb: 'Scenario Outlines and dataset-backed examples.',
  },
  {
    name: 'pool',
    scenarioTag: true,
    blurb: 'Leasing accounts from a user pool so workers do not collide.',
  },
  {
    name: 'har',
    scenarioTag: true,
    blurb: 'Recording and replaying network traffic from a HAR file.',
  },

  // --- topic tags a forum needs ---------------------------------------------------------------
  {
    name: 'install',
    blurb: 'Getting SDODS onto a machine, and what the installer says when it will not go.',
  },
  { name: 'cli', blurb: 'The `sdods` command: flags, exit codes and output.' },
  {
    name: 'config',
    blurb: 'sdods.project.yaml, envs/*.yaml, .env files and the order they resolve in.',
  },
  { name: 'lint', blurb: 'What `sdods lint` rejects and why, including the tag rules.' },
  { name: 'heal', blurb: 'Self-healing locators: scoring, probes and the heal report.' },
  { name: 'locators', blurb: 'Choosing a locator that survives the next redesign.' },
  {
    name: 'page-objects',
    blurb: 'Page classes, step decorators and the fixture set they hang off.',
  },
  { name: 'data', blurb: 'Datasets, factories, rows and cleanup.' },
  { name: 'recording', blurb: '`sdods record`, codegen and turning a recording into a feature.' },
  { name: 'reporting', blurb: 'Run artefacts, HTML reports, traces and insights.' },
  { name: 'ci', blurb: 'Running suites on a build server: sharding, artefacts and gates.' },
  { name: 'mcp', blurb: 'The MCP server, its tools, and wiring it into an editor.' },
  {
    name: 'agents',
    blurb: 'The plan/generate/heal/upgrade/review roles and the proposals they write.',
  },
  { name: 'docker', blurb: 'The server image, and the architectures it is published for.' },
  { name: 'windows', blurb: 'PowerShell, paths and the things that only bite on Windows.' },
  { name: 'macos', blurb: 'Gatekeeper, quarantine and Apple silicon.' },
  { name: 'linux', blurb: 'System libraries, apt and headless machines.' },
];

const BY_NAME = new Map(TAGS.map((t) => [t.name, t]));

export function tagInfo(name: string): TagInfo | undefined {
  return BY_NAME.get(name as Tag);
}

/**
 * A question submitted through the site carries a category, not tags. Map it onto the vocabulary
 * so the tag filter applies to live rows too instead of silently dropping them.
 */
export const CATEGORY_TAG: Record<string, Tag | null> = {
  ui: 'ui',
  api: 'api',
  hybrid: 'hybrid',
  // A question filed as "something else" gets no tag rather than a wrong one.
  other: null,
};
