import { SPONSOR_ENABLED, SPONSOR_URL } from '@sdods/contracts/sponsor';
import type { AgentProject, SupportLinks } from '@sdods/site-kit';
import { withBase } from './base-path';
import { REPO_PUBLIC } from './links';

/** SDODS as the site-kit components see it; the only place the docs say what to install. */
export const SDODS_AGENT_PROJECT: AgentProject = {
  name: 'SDODS',
  serverName: 'sdods',
  npmPackage: '@sdods/cli',
  skillsRepo: 'siri1410/sdods-skills',
  marketplace: 'sdods',
  plugin: 'sdods',
};

export const AI_TOOLS_GUIDE_PATH = '/docs/guides/ai-coding-tools/';
export const AI_TOOLS_GUIDE_HREF = withBase(AI_TOOLS_GUIDE_PATH);

/**
 * Unset links render nothing, so the support prompt stays hidden while SPONSOR_ENABLED is off.
 * The sponsor page itself lives on sdods.com, which also waits for its Stripe links.
 */
export const SUPPORT_LINKS: SupportLinks = {
  'sponsor-page': SPONSOR_ENABLED ? SPONSOR_URL : undefined,
};

export const SUPPORT_PROJECT = {
  name: 'SDODS',
  license: 'Apache-2.0 on npm',
  free: ['unlimited API tokens', 'no paid tier'],
  openSource: REPO_PUBLIC,
};
