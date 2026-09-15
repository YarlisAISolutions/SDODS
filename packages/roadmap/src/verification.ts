import type { VerificationRow } from './types';

/**
 * How the delivered work was checked, with the command that produced each number.
 *
 * Every row carries its own invocation and the date it was measured, so a reader can repeat the
 * measurement rather than trust it, and a figure that has gone stale is obvious instead of
 * invisible. Re-measure with the commands below and edit this file; the documentation site, the
 * marketing site and the README all read it.
 */
export const VERIFICATION: VerificationRow[] = [
  {
    label: 'Unit and CLI end-to-end tests',
    result: '1391 passed, 1 skipped',
    command: 'bun run test',
    measuredOn: '2026-09-15',
    note: 'Measured in the ci workflow, run 34926681357, job lint · typecheck · unit.',
  },
  {
    label: 'Web UI component tests',
    result: '15 passed',
    command: 'cd packages/web && npx vitest run',
    measuredOn: '2026-09-15',
    note: 'Measured in the ci workflow, run 34926681357, job web · build · unit.',
  },
  {
    label: 'Demo API layer, no browser',
    result: '10 passed, 0 failed',
    command: 'bun run demo:api',
    measuredOn: '2026-09-15',
    note: 'CI runs the same command with --har-replay --strict, run 34926681357.',
  },
  {
    label: 'Types, lint and formatting',
    result: 'clean',
    command: 'bun run typecheck && bun run lint',
    measuredOn: '2026-09-15',
    note: 'Lint reports 0 errors and 13 warnings.',
  },
  {
    label: 'Linux visual, accessibility and performance suites',
    result: '@regression green on chromium, firefox and webkit',
    command: 'sdods run -p demo-shop -e staging -l ui -b <browser> -t @regression',
    measuredOn: '2026-09-15',
    note: 'The regression job in the Playwright image, from committed linux/ baselines, run 34926681357. @perf skips webkit, which has no LCP.',
  },
  {
    label: 'Documentation build',
    result: '4434 internal links across 100 pages, 0 broken',
    command: 'bun run docs:build',
    measuredOn: '2026-09-15',
    note: 'Measured in the docs workflow, run 34925639854. Counts generated pages in out/.',
  },
];
