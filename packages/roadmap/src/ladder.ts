import type { Arc } from './types';

/**
 * Five rungs, in order, because each one rests on the one below. A team can find itself on
 * this ladder and the next rung is the one worth arguing for.
 *
 * The years are display years for the marketing page, not commitments: level 1 is delivered,
 * level 2 is what the next twelve months add up to, and the rest is direction.
 */
export const LADDER: Arc[] = [
  {
    level: 1,
    name: 'Evidence',
    tagline: 'Failures explain themselves',
    state: 'delivered',
    displayYear: 2026,
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
    milestone: 'Fourteen phases delivered, installable in one line.',
  },
  {
    level: 2,
    name: 'Shared truth',
    tagline: 'One history the team trusts',
    state: 'now',
    displayYear: 2027,
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
    level: 3,
    name: 'Self-maintaining',
    tagline: 'The suite repairs itself',
    state: 'direction',
    displayYear: 2028,
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
    level: 4,
    name: 'Orchestrated',
    tagline: 'Checks and releases meet',
    state: 'direction',
    displayYear: 2029,
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
    level: 5,
    name: 'Governed',
    tagline: 'Sign-off is auditable',
    state: 'direction',
    displayYear: 2030,
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
