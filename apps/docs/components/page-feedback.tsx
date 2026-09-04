const REPO = 'https://github.com/siri1410/AutoMax';

function issue(kind: 'helpful' | 'not-helpful' | 'feature', path: string, title: string): string {
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
  return `${REPO}/issues/new?${params.toString()}`;
}

/** Per-page footer: "Was this page helpful?" + feature request, each a prefilled GitHub issue. */
export function PageFeedback({ path, title }: { path: string; title: string }) {
  const link = 'rounded-md border border-fd-border px-3 py-1 text-sm hover:bg-fd-accent';
  return (
    <aside
      aria-label="Page feedback"
      className="mt-12 flex flex-wrap items-center gap-3 rounded-lg border border-fd-border bg-fd-card p-4 text-sm"
    >
      <span className="font-medium">Was this page helpful?</span>
      <a className={link} href={issue('helpful', path, title)} target="_blank" rel="noreferrer">
        Yes
      </a>
      <a className={link} href={issue('not-helpful', path, title)} target="_blank" rel="noreferrer">
        No
      </a>
      <span className="text-fd-muted-foreground">·</span>
      <a className={link} href={issue('feature', path, title)} target="_blank" rel="noreferrer">
        Request a feature
      </a>
      <a className="ml-auto text-fd-muted-foreground underline" href="https://sdods.com/feedback/">
        All feedback options
      </a>
    </aside>
  );
}
