export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sdods.com';
export const DOCS_URL = 'https://automax.sdods.com';
export const REPO_URL = 'https://github.com/siri1410/AutoMax';
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
export const IDEAS_URL = `${REPO_URL}/discussions/categories/ideas`;
export const GENERAL_URL = `${REPO_URL}/discussions/categories/general`;
export const LINKEDIN_URL = 'https://www.linkedin.com/in/yarlagadda/';
export const FEEDBACK_EMAIL = 'sireesh.yarlagadda@gmail.com';

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
  const s = encodeURIComponent(`[AutoMax ${kind}] ${subject || ''}`.trim());
  const b = encodeURIComponent(body);
  return `mailto:${FEEDBACK_EMAIL}?subject=${s}&body=${b}`;
}
