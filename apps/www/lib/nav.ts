import { DOCS_URL, REPO_PUBLIC, REPO_URL } from './links';

export interface NavLink {
  label: string;
  href: string;
  /** Off-site links get no client-side routing and no active state. */
  external?: boolean;
}

/**
 * One list for both navigations. The header shows it inline from `md` up and behind a
 * disclosure below that, and neither copy can drift from the other.
 */
export const NAV_LINKS: NavLink[] = [
  { label: 'Install', href: '/install/' },
  { label: 'Docs', href: DOCS_URL, external: true },
  { label: 'Roadmap', href: '/roadmap/' },
  { label: 'Questions', href: '/questions/' },
  { label: 'Feedback', href: '/feedback/' },
  ...(REPO_PUBLIC ? [{ label: 'GitHub', href: REPO_URL, external: true } as NavLink] : []),
];
