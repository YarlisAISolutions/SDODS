/**
 * "Was this page helpful?" clicks, sent to the community service (packages/community, POST
 * /feedback), which stores them for the moderator. Stored rather than mailed: a `mailto:` reaches
 * nobody when the reader has no mail client configured, and they never find out it failed.
 *
 * Off when `NEXT_PUBLIC_COMMUNITY_URL` is unset at build time; the widget then shows only the link
 * to the full feedback form.
 */
const COMMUNITY_URL = (process.env.NEXT_PUBLIC_COMMUNITY_URL ?? '').replace(/\/+$/, '');
export const PAGE_FEEDBACK_ENABLED = COMMUNITY_URL !== '';

export type Verdict = 'helpful' | 'not-helpful';

export async function recordPageFeedback(input: {
  path: string;
  title: string;
  verdict: Verdict;
  note: string;
}): Promise<void> {
  const res = await fetch(`${COMMUNITY_URL}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'page',
      path: input.path.slice(0, 300),
      title: input.title.slice(0, 200),
      verdict: input.verdict,
      note: input.note.trim().slice(0, 2000),
    }),
  });
  if (!res.ok) throw new Error(`page feedback: HTTP ${res.status}`);
}
