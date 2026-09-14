import type { AgentProject, SupportLinks } from '@sdods/site-kit';
import { DOCS_URL, REPO_PUBLIC } from './links';
import { SPONSOR_PUBLIC, SPONSOR_URL } from './sponsor';

/**
 * SDODS as the site-kit components see it. The components are generic; this is the only place the
 * sdods.com site says which package, skills repository and plugin to install.
 */
export const SDODS_AGENT_PROJECT: AgentProject = {
  name: 'SDODS',
  serverName: 'sdods',
  npmPackage: '@sdods/cli',
  skillsRepo: 'siri1410/sdods-skills',
  marketplace: 'sdods',
  plugin: 'sdods',
};

export const AI_TOOLS_GUIDE_URL = `${DOCS_URL}/docs/guides/ai-coding-tools/`;

/**
 * Where the support prompt sends people. Unset links render nothing, so the prompt stays hidden
 * until the ask is live -- see SPONSOR_PUBLIC in ./sponsor.
 */
export const SUPPORT_LINKS: SupportLinks = {
  'sponsor-page': SPONSOR_PUBLIC ? SPONSOR_URL : undefined,
};

export const SUPPORT_PROJECT = {
  name: 'SDODS',
  license: 'Apache-2.0 on npm',
  free: ['unlimited API tokens', 'no paid tier'],
  openSource: REPO_PUBLIC,
};
