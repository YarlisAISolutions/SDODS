import { renderPrompt, ROLE_PROMPTS, type RoleName } from '@sdods/mcp/prompts';
import { toAgentSdkTools, type ToolContext, type ToolRegistry } from '@sdods/mcp';
import type { ProfileName } from '../adapter/profile.js';

export type { RoleName };
export { ROLE_PROMPTS };

export interface RoleInput {
  project?: string;
  env?: string;
  goal?: string;
  plan?: string;
  scenario?: string;
  runId?: string;
  diff?: string;
  files?: string[];
  spec?: string;
}

export interface RoleDefinition {
  role: RoleName;
  /** which tools the role may call (name prefixes) */
  toolPrefixes: string[];
  /**
   * The tools this role keeps under the small profile — named exactly, not by prefix, because
   * the point is a menu a 7B model can read. Ordered by when the role should reach for them.
   */
  smallTools: string[];
  needsBrowser: boolean;
  /** budget defaults when the project yaml does not set them */
  defaults: { maxTurns: number; budgetUsd: number };
  buildPrompt(input: RoleInput): string;
  /**
   * The same request for a small model: one action, and only tools the small profile actually
   * has. The full prompts name a sequence of three calls, which a 7B model answers by describing
   * all three instead of making the first.
   */
  buildSmallPrompt(input: RoleInput): string;
}

const COMMON_READ = [
  'project_',
  'workspace_',
  'process_',
  'feature_list',
  'feature_read',
  'feature_parse',
  'feature_lint',
  'step_',
  'run_get',
  'run_list',
  'run_last_failed',
  'heal_',
  'data_',
  'analyze_',
  'proposal_list',
  'proposal_get',
];

/**
 * Browser access for the roles whose job is to look at the application.
 *
 * These used to get it from a separately registered Playwright MCP server, so nothing about the
 * browser was bound to the project under test. The `browser_*` family on the sdods server is the
 * same tools with the project's baseURL, test-id attribute and login state applied.
 *
 * Not added to any `smallTools`: that list is a menu a 7B model has to choose from, and it is
 * capped at six for exactly that reason.
 */
const BROWSER = ['browser_'];

export const ROLES: Record<RoleName, RoleDefinition> = {
  planner: {
    role: 'planner',
    toolPrefixes: [...COMMON_READ, ...BROWSER, 'feature_write'],
    smallTools: [
      'project_get_config',
      'feature_list',
      'analyze_routes',
      'analyze_coverage',
      'step_find',
      'feature_write',
    ],
    needsBrowser: true,
    defaults: { maxTurns: 30, budgetUsd: 5 },
    buildPrompt: (i) =>
      `Plan test coverage for project ${i.project ?? '<unknown>'}${i.env ? ` on ${i.env}` : ''}.\nGoal: ${i.goal ?? 'cover the main user journeys'}.\nWrite the plan as docs/test-plans/<name>.md through feature_write's extraFiles (path relative to the project root: ../../docs/test-plans is NOT allowed; use docs/test-plans/<name>.md under the project).`,
    buildSmallPrompt: (i) =>
      `Write a test plan for project ${i.project ?? '<unknown>'}.\nGoal: ${i.goal ?? 'cover the main user journeys'}.\nCall feature_write once, with the plan as an extra file named docs/test-plans/plan.md.`,
  },
  generator: {
    role: 'generator',
    toolPrefixes: [...COMMON_READ, ...BROWSER, 'feature_write', 'run_tests'],
    // run_tests is deliberately absent: it carries the two largest schemas in the registry and a
    // small model that calls it spends minutes on output it cannot read. A person reviews the
    // proposal anyway.
    smallTools: ['step_find', 'feature_list', 'feature_read', 'feature_parse', 'feature_write'],
    needsBrowser: true,
    defaults: { maxTurns: 40, budgetUsd: 3 },
    buildPrompt: (i) =>
      `Generate feature files for project ${i.project ?? '<unknown>'}${i.env ? ` on ${i.env}` : ''}.\n${i.plan ? `Plan:\n${i.plan}\n` : ''}${i.spec ? `Recorded spec to convert:\n\`\`\`ts\n${i.spec}\n\`\`\`\n` : ''}Goal: ${i.goal ?? 'implement the plan'}.\nCall step_list first, then feature_parse on your draft, then feature_write.`,
    buildSmallPrompt: (i) =>
      `Write one feature file for project ${i.project ?? '<unknown>'}.\nGoal: ${i.goal ?? 'implement the plan'}.\n${i.spec ? `Base it on this recording:\n\`\`\`ts\n${i.spec}\n\`\`\`\n` : ''}Call feature_write now, using only the step patterns listed above.`,
  },
  healer: {
    role: 'healer',
    toolPrefixes: [...COMMON_READ, ...BROWSER, 'feature_write', 'run_tests', 'analyze_failure'],
    smallTools: [
      'analyze_failure',
      'run_get_scenario',
      'heal_events',
      'feature_read',
      'feature_write',
    ],
    needsBrowser: true,
    defaults: { maxTurns: 30, budgetUsd: 2 },
    buildPrompt: (i) =>
      `Heal scenario ${i.scenario ?? '<fingerprint>'} of run ${i.runId ?? 'last'} in project ${i.project ?? '<unknown>'}.\nStart with analyze_failure and run_get_scenario. Propose the minimal fix via feature_write (extraFiles for page objects/steps).`,
    buildSmallPrompt: (i) =>
      `Scenario "${i.scenario ?? '<fingerprint>'}" of run ${i.runId ?? 'last'} in project ${i.project ?? '<unknown>'} is failing.\nCall analyze_failure now to find out why.`,
  },
  upgrader: {
    role: 'upgrader',
    toolPrefixes: [...COMMON_READ, 'feature_write'],
    smallTools: [
      'analyze_change_impact',
      'analyze_coverage',
      'feature_list',
      'feature_read',
      'feature_write',
    ],
    needsBrowser: false,
    defaults: { maxTurns: 30, budgetUsd: 3 },
    buildPrompt: (i) =>
      `Upgrade the tests of project ${i.project ?? '<unknown>'} for the change ${i.diff ?? 'HEAD~1..HEAD'}.\nStart with analyze_change_impact and analyze_coverage.${i.goal ? `\nFocus: ${i.goal}` : ''}`,
    buildSmallPrompt: (i) =>
      `Code changed in project ${i.project ?? '<unknown>'} (${i.diff ?? 'HEAD~1..HEAD'}).\nCall analyze_change_impact now to find the scenarios it affects.`,
  },
  reviewer: {
    role: 'reviewer',
    toolPrefixes: [...COMMON_READ, 'feature_write'],
    smallTools: [
      'feature_list',
      'feature_read',
      'analyze_best_practices',
      'analyze_locators',
      'feature_parse',
    ],
    needsBrowser: false,
    defaults: { maxTurns: 15, budgetUsd: 1 },
    buildPrompt: (i) =>
      `Review ${i.files?.length ? i.files.join(', ') : 'all feature files'} of project ${i.project ?? '<unknown>'}.\nUse analyze_best_practices, analyze_locators and feature_parse.${i.goal ? `\nFocus: ${i.goal}` : ''}`,
    buildSmallPrompt: (i) =>
      `Review the feature files of project ${i.project ?? '<unknown>'}${i.goal ? ` for: ${i.goal}` : ''}.\nCall feature_list now, then read the files it names.`,
  },
};

/** The user-facing request for a role, in the shape the profile can act on. */
export function rolePrompt(
  role: RoleName,
  input: RoleInput,
  profile: ProfileName = 'full',
): string {
  const def = ROLES[role];
  return profile === 'small' ? def.buildSmallPrompt(input) : def.buildPrompt(input);
}

export function roleSystemPrompt(
  role: RoleName,
  input: RoleInput,
  steps?: string[],
  profile: ProfileName = 'full',
): string {
  return renderPrompt(role, {
    project: input.project,
    env: input.env,
    goal: input.goal,
    steps,
    profile,
  });
}

/**
 * Tools visible to a role. The full profile filters by prefix; the small profile takes the
 * role's named allowlist, in its declared order, so the model reads a short list of things it is
 * expected to do rather than a catalogue.
 */
export function roleTools(
  role: RoleName,
  registry: ToolRegistry,
  ctx: ToolContext,
  profile: ProfileName = 'full',
) {
  const def = ROLES[role];
  const all = toAgentSdkTools(registry, ctx);
  if (profile === 'small') {
    const byName = new Map(all.map((t) => [t.name, t]));
    return def.smallTools.map((n) => byName.get(n)).filter((t): t is NonNullable<typeof t> => !!t);
  }
  return all.filter((t) => def.toolPrefixes.some((p) => t.name.startsWith(p)));
}
