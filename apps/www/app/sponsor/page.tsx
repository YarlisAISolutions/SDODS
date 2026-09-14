import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FEEDBACK_EMAIL } from '@/lib/links';
import {
  CUSTOM_AMOUNT_URL,
  MANAGE_SUBSCRIPTION_URL,
  SPONSOR_ENABLED,
  SPONSOR_PUBLIC,
  tiersFor,
  type SponsorTier,
} from '@/lib/sponsor';

// While sponsorship is off the page is a 404, and its title and description would still leak into
// the tab and the HTML head, so it borrows the not-found page's plain metadata instead.
export const metadata: Metadata = SPONSOR_ENABLED
  ? {
      title: 'Sponsor SDODS',
      description:
        'SDODS is free and open source. Buy the maintainers a coffee, back the project monthly or sponsor it as a company.',
    }
  : { robots: { index: false, follow: true } };

const LARGE_SPONSOR_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
  'Sponsoring SDODS',
)}&body=${encodeURIComponent(
  'Company or name:\nAmount and cadence (one-time, monthly, yearly):\nInvoice or bank transfer:\nLogo placement wanted (yes/no):\n',
)}`;

function TierCard({ tier }: { tier: SponsorTier }) {
  return (
    <article className="card flex flex-col p-5">
      <h3 className="font-semibold">{tier.label}</h3>
      <p className="mt-2 text-2xl font-extrabold tracking-tight">
        ${tier.amount}
        {tier.cadence === 'monthly' && <span className="muted text-sm font-normal"> / month</span>}
      </p>
      <p className="muted mt-2 flex-1 text-sm">{tier.blurb}</p>
      <a href={tier.url} className="btn btn-secondary mt-4 text-sm" rel="noreferrer">
        {tier.cadence === 'monthly' ? `Give $${tier.amount} monthly` : `Give $${tier.amount}`}
      </a>
    </article>
  );
}

export default function SponsorPage() {
  if (!SPONSOR_ENABLED) notFound();
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
        Buy SDODS a coffee <span aria-hidden="true">☕</span>
      </h1>
      <p className="muted mt-3 max-w-2xl">
        SDODS is free and open source, API tokens included, and it stays that way. Sponsorship pays
        for what keeps it moving: CI across browsers and operating systems, hosting for the site and
        docs, code-signing certificates for the desktop app and maintainer time for features and
        fixes.
      </p>

      {SPONSOR_PUBLIC && (
        <>
          <div className="mt-8 grid gap-4 md:grid-cols-[2fr_1fr]">
            <article className="card flex flex-col p-6">
              <h2 className="text-xl font-bold">Give any amount</h2>
              <p className="muted mt-2 flex-1 text-sm">
                Pick your own number, from a dollar to a serious contribution. There is no upper
                limit you are likely to hit, and Stripe Checkout offers the payment methods
                available where you are.
              </p>
              <a href={CUSTOM_AMOUNT_URL} className="btn btn-primary mt-4" rel="noreferrer">
                Choose an amount
              </a>
            </article>
            <nav aria-label="Sponsorship options" className="card flex flex-col gap-2 p-6 text-sm">
              <span className="font-semibold">Jump to</span>
              <a href="#once" className="hover:underline">
                One-time
              </a>
              <a href="#monthly" className="hover:underline">
                Monthly
              </a>
              <a href="#company" className="hover:underline">
                Company sponsorship
              </a>
            </nav>
          </div>

          <h2 id="once" className="mt-12 scroll-mt-20 text-xl font-bold">
            One-time
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tiersFor('once').map((t) => (
              <TierCard key={t.id} tier={t} />
            ))}
          </div>

          <h2 id="monthly" className="mt-12 scroll-mt-20 text-xl font-bold">
            Monthly
          </h2>
          <p className="muted mt-1 text-sm">
            Cancel any time with the link at the bottom of this page.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tiersFor('monthly').map((t) => (
              <TierCard key={t.id} tier={t} />
            ))}
          </div>
        </>
      )}

      <h2 id="company" className="mt-12 scroll-mt-20 text-xl font-bold">
        {SPONSOR_PUBLIC ? 'Company or large sponsorship' : 'Sponsor the project'}
      </h2>
      <article className="card mt-4 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <p className="muted flex-1 text-sm">
          Sponsoring as a company, or giving an amount you would rather not put on a card? Email us.
          We can arrange a bank transfer or an invoice, a yearly sponsorship and, if you want it,
          your logo on this page and in the README.
        </p>
        <div>
          <a href={LARGE_SPONSOR_MAILTO} className="btn btn-secondary text-sm">
            Email {FEEDBACK_EMAIL}
          </a>
        </div>
      </article>

      <h2 className="mt-12 text-xl font-bold">Other ways to help</h2>
      <ul className="muted mt-3 list-disc space-y-2 pl-5 text-sm">
        <li>
          Answer a question on the{' '}
          <Link href="/questions/" className="underline">
            questions page
          </Link>
          .
        </li>
        <li>
          Tell us what is missing or broken through{' '}
          <Link href="/feedback/" className="underline">
            feedback
          </Link>
          .
        </li>
        <li>Tell a colleague who still writes tests by hand.</li>
      </ul>

      {SPONSOR_PUBLIC && (
        <p className="muted mt-12 border-t border-[var(--line)] pt-6 text-xs leading-6">
          Payments are processed by Stripe for SDODS Developers. SDODS never sees your card or bank
          details. Sponsorships are gifts to an open-source project, not purchases and not
          tax-deductible donations. Monthly sponsor?{' '}
          <a href={MANAGE_SUBSCRIPTION_URL} className="underline" rel="noreferrer">
            Change your card or cancel
          </a>
          .
        </p>
      )}
    </div>
  );
}
