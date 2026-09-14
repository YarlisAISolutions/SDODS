import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DOCS_URL, FEEDBACK_EMAIL } from '@/lib/links';
import { SPONSOR_ENABLED } from '@/lib/sponsor';

// Stripe Checkout redirects here after a payment. It says nothing a search engine should index.
// While sponsorship is off the page is a 404 and keeps its title out of the tab.
export const metadata: Metadata = {
  ...(SPONSOR_ENABLED && { title: 'Thank you for sponsoring SDODS' }),
  robots: { index: false, follow: true },
};

export default function SponsorThanksPage() {
  if (!SPONSOR_ENABLED) notFound();
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="text-5xl" aria-hidden="true">
        ☕
      </p>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight md:text-4xl">Thank you</h1>
      <p className="muted mt-4">
        Your sponsorship went through. Stripe emails you a receipt. It genuinely helps keep SDODS
        free, open and moving.
      </p>
      <p className="muted mt-2 text-sm">
        Anything wrong with the payment? Email {FEEDBACK_EMAIL} and we will sort it out.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <a href={DOCS_URL} className="btn btn-primary text-sm">
          Read the docs
        </a>
        <Link href="/questions/" className="btn btn-secondary text-sm">
          Browse questions
        </Link>
      </div>
    </div>
  );
}
