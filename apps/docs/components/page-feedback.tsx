import { FEEDBACK_URL, REPO_PUBLIC, REPO_URL, mailtoUrl } from '@/lib/links';

type Kind = 'helpful' | 'not-helpful' | 'feature';

function issue(kind: Kind, path: string, title: string): string {
  const params = new URLSearchParams();
  if (kind === 'feature') {
    params.set('template', 'feature_request.yml');
    params.set('title', `[Feature] `);
    params.set('labels', 'enhancement,triage');
    params.set('problem', `Context: reading "${title}" (${path})\n\n`);
  } else {
    params.set('template', 'feature_request.yml');
    params.set(
      'labels',
      kind === 'helpful' ? 'documentation,feedback' : 'documentation,feedback,triage',
    );
    params.set('title', `[Docs] ${kind === 'helpful' ? 'Helpful' : 'Not helpful'}: ${title}`);
    params.set('area', 'Documentation');
    params.set(
      'problem',
      kind === 'helpful'
        ? `Page: ${path}\n\nWhat worked well:\n`
        : `Page: ${path}\n\nWhat was missing or wrong:\n`,
    );
  }
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

/** Same three prompts by email while the repository is private. */
function email(kind: Kind, path: string, title: string): string {
  if (kind === 'feature') {
    return mailtoUrl('[SDODS feature] ', `Context: reading "${title}" (${path})\n\n`);
  }
  return mailtoUrl(
    `[SDODS docs] ${kind === 'helpful' ? 'Helpful' : 'Not helpful'}: ${title}`,
    kind === 'helpful'
      ? `Page: ${path}\n\nWhat worked well:\n`
      : `Page: ${path}\n\nWhat was missing or wrong:\n`,
  );
}

/** Per-page footer: "Was this page helpful?" + feature request, each a prefilled issue or email. */
export function PageFeedback({ path, title }: { path: string; title: string }) {
  const link = 'rounded-md border border-fd-border px-3 py-1 text-sm hover:bg-fd-accent';
  const href = (kind: Kind) => (REPO_PUBLIC ? issue(kind, path, title) : email(kind, path, title));
  return (
    <aside
      aria-label="Page feedback"
      className="mt-12 flex flex-wrap items-center gap-3 rounded-lg border border-fd-border bg-fd-card p-4 text-sm"
    >
      <span className="font-medium">Was this page helpful?</span>
      <a className={link} href={href('helpful')} target="_blank" rel="noreferrer">
        Yes
      </a>
      <a className={link} href={href('not-helpful')} target="_blank" rel="noreferrer">
        No
      </a>
      <span className="text-fd-muted-foreground">·</span>
      <a className={link} href={href('feature')} target="_blank" rel="noreferrer">
        Request a feature
      </a>
      <a className="ml-auto text-fd-muted-foreground underline" href={FEEDBACK_URL}>
        All feedback options
      </a>
    </aside>
  );
}
