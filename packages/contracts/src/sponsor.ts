/**
 * The one switch for asking people to sponsor SDODS. While it is false nothing offers a payment:
 * the sites hide the sponsor page, nav, footer and support prompts, and the web UI, CLI help,
 * desktop menu, installer, README and FUNDING.yml say nothing about sponsorship.
 *
 * Turn it on only once the "SDODS Developers" Stripe account and its Payment Links exist (see
 * apps/www/lib/sponsor.ts). The installer scripts and the desktop menu cannot import this package
 * and keep their own copy; tests/sponsor.test.ts fails if any copy disagrees.
 */
// Typed as boolean so code written for either value type-checks, not only for the current one.
export const SPONSOR_ENABLED: boolean = false;

/** Every surface links here; only the sponsor page itself holds Stripe URLs. */
export const SPONSOR_URL = 'https://sdods.com/sponsor/';
