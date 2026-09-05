export const REPO_URL = 'https://github.com/siri1410/SDODS';
export const FEEDBACK_URL = 'https://sdods.com/feedback/';
export const FEEDBACK_EMAIL = 'feedback@sdods.com';

/**
 * The repository is private. Everything that links to it — the nav icon, the `git clone` line,
 * prefilled issue forms, `tree/main/...` links — 404s for a reader, so it stays hidden.
 * Set NEXT_PUBLIC_REPO_PUBLIC=true at build time to show it again once the repo is public.
 */
export const REPO_PUBLIC = process.env.NEXT_PUBLIC_REPO_PUBLIC === 'true';

/** A prefilled email, used in place of a prefilled GitHub issue while the repo is private. */
export function mailtoUrl(subject: string, body: string): string {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
