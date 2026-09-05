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
    result: '221 passed, 1 skipped',
    command: 'bun run test',
    measuredOn: '2026-09-05',
  },
  {
    label: 'Web UI component tests',
    result: '9 passed',
    command: 'cd packages/web && npx vitest run',
    measuredOn: '2026-09-05',
  },
  {
    label: 'Demo API layer, no browser',
    result: '10 passed, 0 failed',
    command: 'bun run demo:api',
    measuredOn: '2026-09-05',
  },
  {
    label: 'Types, lint and formatting',
    result: 'clean',
    command: 'bun run typecheck && bun run lint',
    measuredOn: '2026-09-05',
  },
  {
    label: 'Documentation build',
    result: '3835 internal links across 92 pages, 0 broken',
    command: 'bun run docs:build',
    measuredOn: '2026-09-05',
    note: 'Counts generated pages in out/, which is more than the 88 authored .mdx files.',
  },
];
