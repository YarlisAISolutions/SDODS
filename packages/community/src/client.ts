import Anthropic from '@anthropic-ai/sdk';

/**
 * The Claude client. A key that is not scoped to a workspace must name one on every request
 * (`anthropic-workspace-id`); ANTHROPIC_WORKSPACE_ID supplies it. Keys scoped to a workspace
 * need nothing extra.
 */
export function createClient(env: NodeJS.ProcessEnv = process.env): Anthropic {
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(
    workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {},
  );
}
