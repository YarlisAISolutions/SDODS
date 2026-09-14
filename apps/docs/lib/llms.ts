import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { source } from '@/lib/source';
import { basePath, siteUrl } from '@/lib/base-path';

/**
 * The docs as plain Markdown, for /llms.txt, /llms-full.txt and Maxi, the docs assistant.
 *
 * The output has to be byte-for-byte stable for the same content: Maxi caches it as a prompt
 * prefix, and any change (page order, a timestamp) turns every cached read into a fresh write.
 * So pages are sorted by URL and nothing time-dependent goes in.
 */

type Page = ReturnType<typeof source.getPages>[number];

function pagesInOrder(): Page[] {
  return [...source.getPages()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

export function absoluteUrl(url: string): string {
  return `${siteUrl}${basePath}${url}`;
}

/** Pages are exported with trailing slashes; linking the canonical form saves a redirect. */
const pageUrl = (url: string) => absoluteUrl(url.endsWith('/') ? url : `${url}/`);

/** Repository files that orient an agent and are not rendered as docs pages. */
const REPO_FILES = ['AGENT.md', 'SKILL.md'] as const;

function repoFile(name: string): string {
  // next build runs with apps/docs as the working directory.
  return readFileSync(join(process.cwd(), '..', '..', name), 'utf8').trim();
}

export function llmsIndex(): string {
  const lines = [
    '# SDODS',
    '',
    '> SDODS is an automation platform with a reusable architecture: BDD for UI, API and hybrid flows, multi-project, data-driven, self-healing, with an MCP server and AI agents.',
    '',
    `The full text of every page is at ${absoluteUrl('/llms-full.txt')}.`,
    '',
    '## Docs',
    '',
  ];
  for (const page of pagesInOrder()) {
    const description = page.data.description ? `: ${page.data.description}` : '';
    lines.push(`- [${page.data.title}](${pageUrl(page.url)})${description}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function llmsFull(): Promise<string> {
  const parts: string[] = [];
  for (const page of pagesInOrder()) {
    // A component left out of the export leaves its surrounding blank lines behind.
    const body = (await page.data.getText('processed')).replace(/\n{3,}/g, '\n\n').trim();
    const description = page.data.description ? `\n\n${page.data.description}` : '';
    parts.push(`# ${page.data.title}\n\nURL: ${pageUrl(page.url)}${description}\n\n${body}`);
  }
  for (const name of REPO_FILES) {
    parts.push(`# ${name} (repository file)\n\n${repoFile(name)}`);
  }
  return `${parts.join('\n\n---\n\n')}\n`;
}
