export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sdods.com';
export const DOCS_URL = 'https://docs.sdods.com';
export const REPO_URL = 'https://github.com/siri1410/SDODS';
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
export const IDEAS_URL = `${REPO_URL}/discussions/categories/ideas`;
export const GENERAL_URL = `${REPO_URL}/discussions/categories/general`;
export const FEEDBACK_EMAIL = 'admin@sdods.com';
export const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

/**
 * The repository is private. Everything that links to it — the GitHub buttons, Discussions,
 * prefilled issue forms, `blob/main/...` links — 404s for a visitor, so it stays hidden.
 * Set NEXT_PUBLIC_REPO_PUBLIC=true at build time to show it again once the repo is public.
 */
export const REPO_PUBLIC = process.env.NEXT_PUBLIC_REPO_PUBLIC === 'true';

export type FeedbackKind = 'feature' | 'bug' | 'feedback';

/** Prefilled GitHub issue-form URL. No backend: the browser opens GitHub with the fields filled. */
export function issueUrl(kind: FeedbackKind, fields: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (kind === 'feature') {
    params.set('template', 'feature_request.yml');
    params.set('title', fields.title ? `[Feature] ${fields.title}` : '[Feature] ');
    params.set('labels', 'enhancement,triage');
  } else if (kind === 'bug') {
    params.set('template', 'bug_report.yml');
    params.set('title', fields.title ? `[Bug] ${fields.title}` : '[Bug] ');
    params.set('labels', 'bug,triage');
  } else {
    params.set('template', 'feature_request.yml');
    params.set('title', fields.title ? `[Feedback] ${fields.title}` : '[Feedback] ');
    params.set('labels', 'feedback,triage');
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'title' || !v) continue;
    params.set(k, v);
  }
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

export function mailtoUrl(kind: FeedbackKind, subject: string, body: string): string {
  const s = encodeURIComponent(`[SDODS ${kind}] ${subject || ''}`.trim());
  const b = encodeURIComponent(body);
  return `mailto:${FEEDBACK_EMAIL}?subject=${s}&body=${b}`;
}
