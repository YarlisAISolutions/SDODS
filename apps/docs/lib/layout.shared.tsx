import { withBase } from '@/lib/base-path';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { REPO_PUBLIC, REPO_URL } from '@/lib/links';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <img src={withBase('/img/favicon.svg')} alt="" width={22} height={22} />
          SDODS
        </span>
      ),
    },
    githubUrl: REPO_PUBLIC ? REPO_URL : undefined,
    links: [
      // The docs site has a landing page of its own; from inside /docs the only way back was
      // the wordmark, which is not obviously a link.
      { text: 'Home', url: '/' },
      { text: 'Getting started', url: '/docs' },
      { text: 'Guides', url: '/docs/guides/projects-and-environments' },
      { text: 'Reference', url: '/docs/reference/cli' },
      { text: 'Roadmap', url: '/docs/roadmap' },
      { text: 'Feedback', url: 'https://sdods.com/feedback/', external: true },
    ],
  };
}
