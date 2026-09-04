import type { Metadata } from 'next';
import { FEEDBACK_EMAIL, REPO_PUBLIC, REPO_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What this site collects (almost nothing) and where feedback goes.',
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">Privacy</h1>
      <p className="muted mt-3">Short, because there is little to say.</p>
      <div className="prose mt-8 max-w-none text-sm leading-7">
        <h2 className="text-lg font-bold">This site</h2>
        <p>
          sdods.com and docs.sdods.com are static pages served by Firebase Hosting. They set no
          cookies and load no third-party scripts. The only thing stored in your browser is your
          light/dark theme preference, in local storage. Firebase Hosting keeps standard server logs
          (IP address, user agent, requested path) for a limited time, as any web host does.
        </p>
        <h2 className="mt-6 text-lg font-bold">Feedback and feature requests</h2>
        {REPO_PUBLIC ? (
          <p>
            The feedback form composes a GitHub issue in your browser and opens GitHub. Nothing is
            sent to us directly; GitHub's terms and privacy policy apply to what you post there, and
            issues in the{' '}
            <a href={REPO_URL} className="underline" rel="noreferrer">
              SDODS repository
            </a>{' '}
            are public. The email fallback sends a normal email to {FEEDBACK_EMAIL}.
          </p>
        ) : (
          <p>
            The feedback form composes an email in your own mail client and opens it. Nothing is
            sent to us until you press send, and nothing is stored by this site.
          </p>
        )}
        <h2 className="mt-6 text-lg font-bold">The SDODS software</h2>
        <p>
          SDODS itself runs on your machines. It sends no telemetry. Optional integrations (GitHub,
          Jira, LLM providers) only contact the services you configure with your own credentials,
          which are read from environment variables and never stored in YAML or the database.
        </p>
        <h2 className="mt-6 text-lg font-bold">Contact</h2>
        <p>Questions: {FEEDBACK_EMAIL}.</p>
      </div>
    </div>
  );
}
