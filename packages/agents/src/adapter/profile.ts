import type { Provider } from './types.js';

/**
 * How much of the platform to put in front of a model.
 *
 * A role exposes 33–35 tools, and a browser role adds Playwright's 24 on top. A frontier model
 * copes with that; a 7–8B model does not — past roughly twenty functions it stops choosing one and
 * starts *describing* the call it would make, in prose, forever. That is not a prompt problem, it
 * is a menu problem.
 *
 * The small profile shrinks the menu: a handful of tools chosen for the role, one call per turn, a
 * short turn budget, and the project's real step vocabulary in the system prompt so the model
 * picks phrasing instead of inventing it. It is selected automatically for local models and can
 * always be forced either way.
 */

export type ProfileName = 'full' | 'small';
export type ProfileSetting = 'auto' | ProfileName;

export interface ProfileSettings {
  profile: ProfileName;
  /** Why this profile was chosen, for the status line and `--dry-run`. */
  reason: string;
  /** Cap on turns; the role's own default wins when it is lower. */
  maxTurns?: number;
  /** Small models handle one decision at a time. */
  maxToolCallsPerTurn?: number;
  /** Make the first turn act instead of narrate. */
  firstTurnToolChoice?: 'auto' | 'required';
  /** Cap on one assistant turn, so a rambling model does not eat the context. */
  maxTokens?: number;
  /** How many step patterns to inline in the system prompt. */
  stepVocabularyLimit: number;
  /** Ceiling on tools bridged from MCP servers (the browser server alone offers 24). */
  maxBridgedTools?: number;
  /**
   * Whether a browser role gets the browser server attached.
   *
   * Measured on llama3.1:8b: with the five generator tools it calls `feature_write`; add a single
   * `browser_*` tool and it stops calling anything and describes a plan instead. The browser is a
   * different *kind* of work — explore, then decide — and a small model cannot hold both. So the
   * small profile writes from the project's step vocabulary, and the browser is opt-in.
   */
  attachBrowser: boolean;
  /** Read a tool call out of the prose when the model wrote one instead of making it. */
  recoverTextToolCalls: boolean;
}

const FULL: Omit<ProfileSettings, 'reason'> = {
  profile: 'full',
  stepVocabularyLimit: 0,
  attachBrowser: true,
  recoverTextToolCalls: false,
};

const SMALL: Omit<ProfileSettings, 'reason'> = {
  profile: 'small',
  maxTurns: 10,
  maxToolCallsPerTurn: 1,
  firstTurnToolChoice: 'required',
  // A tool call is a hundred tokens; the cap exists to stop a model that has started rambling,
  // and on a laptop at a few tokens a second a generous cap is a timeout waiting to happen.
  maxTokens: 1024,
  stepVocabularyLimit: 60,
  maxBridgedTools: 6,
  attachBrowser: false,
  recoverTextToolCalls: true,
};

/** Model ids that name their own size: qwen2.5-coder:7b, llama3.1:8b, gemma:2b, phi3:3.8b … */
const SMALL_MODEL = /(^|[-:_.])(0\.5|1|1\.5|2|3|3\.8|4|6|7|8|9|12|13|14)\s*b\b/i;
/** A loopback or private address means someone is running the model themselves. */
const PRIVATE_HOST =
  /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|host\.docker\.internal|[^/]*\.local(:|\/|$))/i;

export function resolveProfile(o: {
  configured?: ProfileSetting;
  provider: Provider;
  model: string;
  baseUrl?: string;
  contextTokens?: number;
  /** From the server, when it reports them: a model without `tools` cannot drive the loop. */
  capabilities?: string[];
}): ProfileSettings {
  const configured = o.configured ?? 'auto';
  if (configured === 'full') return { ...FULL, reason: 'configured' };
  if (configured === 'small') return { ...SMALL, reason: 'configured' };

  if (o.capabilities?.length && !o.capabilities.includes('tools'))
    return { ...SMALL, reason: `${o.model} does not advertise tool calling` };
  if (o.provider === 'ollama') return { ...SMALL, reason: 'a local model' };
  if (o.provider === 'openai-compatible' && o.baseUrl && PRIVATE_HOST.test(o.baseUrl))
    return { ...SMALL, reason: `a model served from ${o.baseUrl}` };
  if (SMALL_MODEL.test(o.model)) return { ...SMALL, reason: `${o.model} is a small model` };
  if (o.contextTokens && o.contextTokens < 16_384)
    return { ...SMALL, reason: `a ${o.contextTokens}-token context` };
  return { ...FULL, reason: 'a hosted model' };
}
