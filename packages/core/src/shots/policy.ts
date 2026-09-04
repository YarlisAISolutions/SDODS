import type { ShotPolicy } from '@sdods/contracts';
import type { ResolvedConfig } from '../config/resolve.js';

export interface ShotPolicyResolved {
  mode: ShotPolicy;
  fullPage: boolean;
  mask: string[];
  viewport: { width: number; height: number };
  /** scenario start/end captures */
  scenario: boolean;
  /** before/after every UI step */
  step: boolean;
  /** toHaveScreenshot baseline checks enabled */
  visual: boolean;
}

/**
 * Specificity: `@visual` > suite tag > any other tag key present > default.
 * `onlyOnFailure` (project/env) or SDODS_SHOTS_ONLY_ON_FAILURE downgrades to on-failure
 * but keeps visual baseline checks.
 */
export function resolvePolicy(tags: readonly string[], config: ResolvedConfig): ShotPolicyResolved {
  const s = config.project.screenshots;
  const policy = s.policy;
  const suites = config.project.tags.suites.map((x) => `@${x}`);
  let mode: ShotPolicy = policy.default ?? 'on-failure';
  const suiteTag = tags.find((t) => suites.includes(t));
  if (suiteTag && policy[suiteTag]) mode = policy[suiteTag]!;
  for (const t of tags) if (t !== suiteTag && t !== '@visual' && policy[t]) mode = policy[t]!;
  if (tags.includes('@visual')) mode = policy['@visual'] ?? 'visual';
  const onlyOnFailure = s.onlyOnFailure || process.env.SDODS_SHOTS_ONLY_ON_FAILURE === '1';
  const visual = mode === 'visual';
  if (onlyOnFailure && mode !== 'off') mode = 'on-failure';
  return {
    mode,
    fullPage: s.fullPage,
    mask: s.mask,
    viewport: s.viewport,
    scenario: mode === 'scenario' || mode === 'step' || mode === 'visual',
    step: mode === 'step' || mode === 'visual',
    visual,
  };
}
