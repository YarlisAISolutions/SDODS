/**
 * Sponsorship through Stripe Payment Links. The site is a static export with no backend, so every
 * option is a plain outbound link to Stripe Checkout; nothing here is a secret.
 *
 * This is the only place in the repo that holds Stripe URLs. The README, installer, CLI, web UI
 * and desktop app all link to SPONSOR_URL instead, so a price or link can change with a site
 * deploy and no release.
 *
 * The links belong to the "SDODS Developers" Stripe account. Leave a URL empty until its link
 * exists: while any is empty the page shows only the "large sponsorship" email card and the nav
 * and footer hide the ask. Fill all of them in at once (tests/sponsor.test.ts rejects a half-filled
 * set).
 */
import { SITE_URL } from './links';

export const SPONSOR_PAGE = '/sponsor/';
export const SPONSOR_URL = `${SITE_URL}${SPONSOR_PAGE}`;

export type SponsorCadence = 'once' | 'monthly';

export interface SponsorTier {
  id: string;
  cadence: SponsorCadence;
  label: string;
  /** Whole US dollars. */
  amount: number;
  blurb: string;
  /** Stripe Payment Link (https://buy.stripe.com/...). Empty until it is created. */
  url: string;
}

export const SPONSOR_TIERS: SponsorTier[] = [
  {
    id: 'coffee',
    cadence: 'once',
    label: 'A coffee',
    amount: 5,
    blurb: 'A small thank-you that keeps a maintainer going through one more flaky-test hunt.',
    url: '',
  },
  {
    id: 'supporter',
    cadence: 'once',
    label: 'Supporter',
    amount: 25,
    blurb: 'Helps pay for the CI that runs every change across browsers and operating systems.',
    url: '',
  },
  {
    id: 'champion',
    cadence: 'once',
    label: 'Champion',
    amount: 100,
    blurb: 'Helps keep sdods.com, the docs and the package channels online.',
    url: '',
  },
  {
    id: 'monthly-coffee',
    cadence: 'monthly',
    label: 'Coffee club',
    amount: 5,
    blurb: 'A coffee every month. Small, steady and the kind of support that adds up.',
    url: '',
  },
  {
    id: 'monthly-supporter',
    cadence: 'monthly',
    label: 'Backer',
    amount: 25,
    blurb: 'Steady help with CI, releases and code-signing certificates.',
    url: '',
  },
  {
    id: 'monthly-champion',
    cadence: 'monthly',
    label: 'Patron',
    amount: 100,
    blurb: 'Funds maintainer time for features, fixes and answering questions.',
    url: '',
  },
];

/** One-time payment where the sponsor types the amount, up to Stripe's per-payment maximum. */
export const CUSTOM_AMOUNT_URL = '';

/** Stripe customer-portal login, where monthly sponsors change their card or cancel. */
export const MANAGE_SUBSCRIPTION_URL = '';

/** Every Stripe link the page needs. */
export const SPONSOR_LINKS: string[] = [
  ...SPONSOR_TIERS.map((t) => t.url),
  CUSTOM_AMOUNT_URL,
  MANAGE_SUBSCRIPTION_URL,
];

/** True once every Stripe link exists; the site shows the ask only then. */
export const SPONSOR_PUBLIC = SPONSOR_LINKS.every((u) => u !== '');

export function tiersFor(cadence: SponsorCadence): SponsorTier[] {
  return SPONSOR_TIERS.filter((t) => t.cadence === cadence);
}
