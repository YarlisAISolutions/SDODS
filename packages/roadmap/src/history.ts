import type { HistoryEra, HistoryYear } from './types';

/**
 * The road behind 2026.
 *
 * This is deliberately **not** a release history for SDODS. The code in this repository is new,
 * and inventing shipped-in-2017 claims would be the one thing this roadmap exists to avoid. What
 * each year records instead is checkable in two halves:
 *
 *   `shift`   — what the industry actually did that year, dated against public releases.
 *   `carried` — the design decision that survived into the product, verifiable in this codebase.
 *
 * So the past reads as lineage rather than as a changelog, and every sentence in it can be
 * checked by someone who was not there. The marketing page says so above the section, in as many
 * words, because a reader who assumes otherwise has been misled by the layout rather than told.
 */

/** Three stretches of road, each with a problem that defined it. */
export const ERAS: HistoryEra[] = [
  {
    id: 'era-grid',
    order: 1,
    name: 'The grid years',
    from: 2015,
    to: 2018,
    tagline: 'Automation ran where it was written, and nowhere else.',
    maxi: 'The whole problem shows up in the first year and then sits there for a decade: the test knows exactly what happened, and the report does not.',
  },
  {
    id: 'era-pipeline',
    order: 2,
    name: 'The pipeline years',
    from: 2019,
    to: 2022,
    tagline: 'CI became the only machine that counted.',
    maxi: 'Once the pipeline is the only machine anyone trusts, two things have to be able to explain themselves — the configuration, and the failure.',
  },
  {
    id: 'era-agent',
    order: 3,
    name: 'The agent years',
    from: 2023,
    to: 2025,
    tagline: 'Writing tests got cheap. Trusting them did not.',
    maxi: 'Generation was never the hard part. Reviewing the output in an amount of time a human actually has is the hard part, and that is why SDODS writes proposals.',
  },
];

/** Eleven years, contiguous, each one a lesson the product still carries. */
export const HISTORY: HistoryYear[] = [
  {
    year: 2015,
    era: 1,
    label: 'The start',
    title: 'A suite that only ran on one machine',
    shift:
      'Selenium WebDriver and a Jenkins box were the whole stack. Scenarios were pinned to CSS selectors, run on a grid somebody maintained by hand, and a failure arrived as a red line and a stack trace.',
    carried:
      'One project per application, with its own environments and its own config — because a suite that borrows another team’s settings is a suite that breaks on Mondays.',
    tech: ['Selenium WebDriver', 'Cucumber-JVM', 'Jenkins', 'Page objects'],
  },
  {
    year: 2016,
    era: 1,
    label: 'A standard',
    title: 'The browser gets a standard, the report does not',
    shift:
      'Selenium 3.0 shipped in October and pushed everyone towards the W3C WebDriver protocol. Browsers finally agreed on how to be driven. Nothing agreed on how to explain a failure.',
    carried:
      'A layered step library: one phrasing style across UI, API and hybrid flows, so a change of driver never rewrites the scenarios on top of it.',
    tech: ['Selenium 3.0', 'W3C WebDriver draft', 'Hosted browser grids', 'Gherkin'],
  },
  {
    year: 2017,
    era: 1,
    label: 'Headless',
    title: 'The browser stops needing a screen',
    shift:
      'Headless Chrome landed in June, Puppeteer in August, and Cypress arrived arguing the runner belongs inside the browser. PhantomJS was retired by its own maintainer.',
    carried:
      'Screenshots as a first-class artefact rather than a debugging afterthought: if nobody is watching the browser, the run has to keep the pictures.',
    tech: ['Headless Chrome 59', 'Puppeteer', 'Cypress', 'Containers in CI'],
  },
  {
    year: 2018,
    era: 1,
    label: 'Below the UI',
    title: 'The cheapest question stops being asked through a browser',
    shift:
      'W3C WebDriver became a Recommendation in June. Contract testing and API-first suites grew, because driving a browser to check a total was the slowest possible way to ask a cheap question.',
    carried:
      'API seeding and hybrid scenarios — arrange the state over HTTP, assert it in the UI, and never click through a five-step wizard to build a fixture.',
    tech: ['W3C WebDriver Rec', 'Contract testing', 'OpenAPI 3', 'API-first suites'],
  },
  {
    year: 2019,
    era: 2,
    label: 'Pipelines',
    title: 'CI becomes the only machine that counts',
    shift:
      'GitHub Actions went generally available in November and the pipeline moved into the repository. From here on “works on my laptop” stopped being a defence and started being the bug report.',
    carried:
      'Six-layer configuration precedence that can name the exact file every value came from — the answer to staging and CI quietly disagreeing.',
    tech: ['GitHub Actions', 'Pipelines as code', 'Ephemeral runners', 'Matrix builds'],
  },
  {
    year: 2020,
    era: 2,
    label: 'One API',
    title: 'Three browsers, one API, no sleeps',
    shift:
      'Playwright’s first release in January brought auto-waiting and a single API across Chromium, Firefox and WebKit. Teams went remote the same season, and shared run history became the only place anyone met.',
    carried:
      'Playwright underneath, not one sleep in the step library, and a cross-browser matrix that is a flag rather than a fork of the suite.',
    tech: ['Playwright', 'Auto-waiting', 'WebKit and Firefox parity', 'Remote-first teams'],
  },
  {
    year: 2021,
    era: 2,
    label: 'Evidence',
    title: 'A failure starts explaining itself',
    shift:
      'The Playwright trace viewer arrived in June and a failed run began shipping with its evidence attached, instead of a log to reconstruct the failure from. Visual baselines went mainstream beside it.',
    carried:
      'Before-and-after screenshots on every UI step with a pixel diff, and a heal record that says which strategy found the element. Level 1 of the ladder is this idea, finished.',
    tech: ['Trace viewer', 'Visual baselines', 'Pixel diffing', 'Step-level capture'],
  },
  {
    year: 2022,
    era: 2,
    label: 'Flake',
    title: 'Flakiness gets a name and a number',
    shift:
      'Suites got large enough that retries stopped hiding the problem, and quarantine, flake rate and per-test ownership entered the vocabulary. In November ChatGPT arrived and every roadmap in the industry was rewritten.',
    carried:
      'Run history in a real database — SQLite or Postgres on one schema — so a flaky test is measured across runs rather than remembered by whoever was on call.',
    tech: ['Quarantine and budgets', 'Flake rate metrics', 'Test impact analysis', 'ChatGPT'],
  },
  {
    year: 2023,
    era: 3,
    label: 'Generation',
    title: 'Models can write tests. Nobody trusts them',
    shift:
      'GPT-4 in March made test generation almost free, and the bottleneck moved the same week: reviewing a hundred generated scenarios you did not ask for is slower than writing the ten you did.',
    carried:
      'Proposals. An agent writes, a person accepts, and nothing edits your working tree unasked — the rule every SDODS agent is held to.',
    tech: ['GPT-4', 'Generated scenarios', 'Self-healing locators', 'Assistants in the editor'],
  },
  {
    year: 2024,
    era: 3,
    label: 'Tools',
    title: 'Assistants learn to read your project',
    shift:
      'The Model Context Protocol was published in November, and an assistant could be handed real tools against a real project instead of guessing from a file somebody pasted into a chat window.',
    carried:
      'The SDODS MCP server: projects, features, steps, runs and results exposed as tools, so an assistant reads your suite rather than a generic one.',
    tech: ['Model Context Protocol', 'Tool-using agents', 'Local models', 'Structured output'],
  },
  {
    year: 2025,
    era: 3,
    label: 'Maintenance',
    title: 'The expensive half turns out to be upkeep',
    shift:
      'Agentic coding became ordinary. Writing tests got cheap enough that the costly part was finally unmistakable: keeping a large suite alive while the application underneath it moves.',
    carried:
      'Five agent roles — planner, generator, healer, upgrader, reviewer — and a healer that records why a locator healed, so the repair is reviewable instead of magic.',
    tech: ['Agentic coding', 'Locator drift repair', 'Review-first workflows', 'Agents over MCP'],
  },
];

/** The years of a given era, in order. */
export const yearsOfEra = (era: HistoryEra): HistoryYear[] =>
  HISTORY.filter((y) => y.era === era.order);

/** The first year on the road. Used for the hero line, so the two cannot drift apart. */
export const HISTORY_FROM: number = HISTORY[0]!.year;
