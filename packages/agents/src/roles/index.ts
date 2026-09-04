import { renderPrompt, ROLE_PROMPTS, type RoleName } from '@automax/mcp/prompts';
import { toAgentSdkTools, type ToolContext, type ToolRegistry } from '@automax/mcp';

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
  needsBrowser: boolean;
  /** budget defaults when the project yaml does not set them */
  defaults: { maxTurns: number; budgetUsd: number };
  buildPrompt(input: RoleInput): string;
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

export const ROLES: Record<RoleName, RoleDefinition> = {
  planner: {
    role: 'planner',
    toolPrefixes: [...COMMON_READ, 'feature_write'],
    needsBrowser: true,
    defaults: { maxTurns: 30, budgetUsd: 5 },
    buildPrompt: (i) =>
      `Plan test coverage for project ${i.project ?? '<unknown>'}${i.env ? ` on ${i.env}` : ''}.\nGoal: ${i.goal ?? 'cover the main user journeys'}.\nWrite the plan as docs/test-plans/<name>.md through feature_write's extraFiles (path relative to the project root: ../../docs/test-plans is NOT allowed; use docs/test-plans/<name>.md under the project).`,
  },
  generator: {
    role: 'generator',
    toolPrefixes: [...COMMON_READ, 'feature_write', 'run_tests'],
    needsBrowser: true,
    defaults: { maxTurns: 40, budgetUsd: 3 },
    buildPrompt: (i) =>
      `Generate feature files for project ${i.project ?? '<unknown>'}${i.env ? ` on ${i.env}` : ''}.\n${i.plan ? `Plan:\n${i.plan}\n` : ''}${i.spec ? `Recorded spec to convert:\n\`\`\`ts\n${i.spec}\n\`\`\`\n` : ''}Goal: ${i.goal ?? 'implement the plan'}.\nCall step_list first, then feature_parse on your draft, then feature_write.`,
  },
  healer: {
    role: 'healer',
    toolPrefixes: [...COMMON_READ, 'feature_write', 'run_tests', 'analyze_failure'],
    needsBrowser: true,
    defaults: { maxTurns: 30, budgetUsd: 2 },
    buildPrompt: (i) =>
      `Heal scenario ${i.scenario ?? '<fingerprint>'} of run ${i.runId ?? 'last'} in project ${i.project ?? '<unknown>'}.\nStart with analyze_failure and run_get_scenario. Propose the minimal fix via feature_write (extraFiles for page objects/steps).`,
  },
  upgrader: {
    role: 'upgrader',
    toolPrefixes: [...COMMON_READ, 'feature_write'],
    needsBrowser: false,
    defaults: { maxTurns: 30, budgetUsd: 3 },
    buildPrompt: (i) =>
      `Upgrade the tests of project ${i.project ?? '<unknown>'} for the change ${i.diff ?? 'HEAD~1..HEAD'}.\nStart with analyze_change_impact and analyze_coverage.${i.goal ? `\nFocus: ${i.goal}` : ''}`,
  },
  reviewer: {
    role: 'reviewer',
    toolPrefixes: [...COMMON_READ, 'feature_write'],
    needsBrowser: false,
    defaults: { maxTurns: 15, budgetUsd: 1 },
    buildPrompt: (i) =>
      `Review ${i.files?.length ? i.files.join(', ') : 'all feature files'} of project ${i.project ?? '<unknown>'}.\nUse analyze_best_practices, analyze_locators and feature_parse.${i.goal ? `\nFocus: ${i.goal}` : ''}`,
  },
};

export function roleSystemPrompt(role: RoleName, input: RoleInput, steps?: string[]): string {
  return renderPrompt(role, { project: input.project, env: input.env, goal: input.goal, steps });
}

/** Tools visible to a role (filtered by prefix) as Agent-SDK-ready definitions. */
export function roleTools(role: RoleName, registry: ToolRegistry, ctx: ToolContext) {
  const def = ROLES[role];
  return toAgentSdkTools(registry, ctx).filter((t) =>
    def.toolPrefixes.some((p) => t.name.startsWith(p)),
  );
}
