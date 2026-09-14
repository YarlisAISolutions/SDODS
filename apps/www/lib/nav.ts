import { DOCS_URL, REPO_PUBLIC, REPO_URL } from './links';
import { DESKTOP_PUBLIC } from './desktop-release';
import { SPONSOR_PAGE, SPONSOR_PUBLIC } from './sponsor';

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
  // Shown once any platform is offered -- see DESKTOP_PLATFORMS in ./desktop-release.
  ...(DESKTOP_PUBLIC ? [{ label: 'Download', href: '/download/' } as NavLink] : []),
  { label: 'Install', href: '/install/' },
  { label: 'Docs', href: DOCS_URL, external: true },
  { label: 'Roadmap', href: '/roadmap/' },
  { label: 'Questions', href: '/questions/' },
  { label: 'Feedback', href: '/feedback/' },
  ...(REPO_PUBLIC ? [{ label: 'GitHub', href: REPO_URL, external: true } as NavLink] : []),
  // Shown once sponsorship is on and every Stripe link exists -- see SPONSOR_PUBLIC in ./sponsor.
  ...(SPONSOR_PUBLIC ? [{ label: 'Sponsor', href: SPONSOR_PAGE } as NavLink] : []),
];
