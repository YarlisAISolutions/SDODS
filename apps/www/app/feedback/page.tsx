import type { Metadata } from 'next';
import { FeedbackForm } from '@/components/feedback-form';
import { DISCUSSIONS_URL, IDEAS_URL, issueUrl } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Feedback and feature requests',
  description:
    'Request a feature, report a bug or start a discussion. Everything goes to the public AutoMax GitHub repository.',
};

const CARDS = [
  {
    title: 'Request a feature',
    body: 'Tell us the problem, the workflow it blocks and what a good solution looks like. Opens a prefilled issue form.',
    href: issueUrl('feature'),
    cta: 'Open the feature form',
  },
  {
    title: 'Report a bug',
    body: 'Command, expected vs actual, run id and logs. The form asks for `automax doctor --json` output.',
    href: issueUrl('bug'),
    cta: 'Open the bug form',
  },
  {
    title: 'Start a discussion',
    body: 'Not sure it is a feature yet? Ideas, questions and show-and-tell live in GitHub Discussions.',
    href: IDEAS_URL,
    cta: 'Go to Discussions',
  },
];

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
        Feedback and feature requests
      </h1>
      <p className="muted mt-3 max-w-2xl">
        AutoMax is built in the open. Every request lands as a GitHub issue or discussion where the
        maintainers triage it, label it and reply. No login with us, no tracking.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <article key={c.title} className="card flex flex-col p-5">
            <h2 className="font-semibold">{c.title}</h2>
            <p className="muted mt-2 flex-1 text-sm">{c.body}</p>
            <a
              href={c.href}
              className="btn btn-secondary mt-4 text-sm"
              target="_blank"
              rel="noreferrer"
            >
              {c.cta}
            </a>
          </article>
        ))}
      </div>
      <h2 className="mt-14 text-xl font-bold">Or write it here</h2>
      <p className="muted mb-4 mt-1 text-sm">
        The form composes the issue for you and opens GitHub with everything filled in.
      </p>
      <FeedbackForm />
      <h2 className="mt-14 text-xl font-bold">What happens next</h2>
      <ol className="muted mt-3 list-decimal space-y-2 pl-5 text-sm">
        <li>
          A maintainer adds the <code>triage</code> label within a few days and asks for details if
          needed (<code>needs-info</code>).
        </li>
        <li>
          Accepted requests keep the <code>enhancement</code> label and show up on the{' '}
          <a href={DISCUSSIONS_URL} className="underline" rel="noreferrer">
            roadmap discussion
          </a>
          .
        </li>
        <li>Shipped features are announced in the release notes with a link back to your issue.</li>
      </ol>
    </div>
  );
}
