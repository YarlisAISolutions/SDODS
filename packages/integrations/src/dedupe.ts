import type { IssueLink, IssueLinkStore, ProviderName } from './types.js';

export interface DedupeDecision {
  action: 'create' | 'comment' | 'skip';
  link?: IssueLink;
  reason: string;
}

export interface IssueDedupeOptions {
  reopenAfterDays?: number;
  /**
   * Look the fingerprint up in the issue tracker when no open link is stored locally, and return
   * the (saved) link for an open issue. The local store does not survive a fresh CI runner.
   */
  findRemote?: (fingerprint: string) => Promise<IssueLink | undefined>;
}

/**
 * One issue per (project, provider, scenario fingerprint). An open link — stored locally or found
 * by `findRemote` — means "comment, don't create". A closed link younger than `reopenAfterDays` is
 * left alone (skip); older ones get a fresh issue.
 */
export class IssueDedupe {
  constructor(
    private readonly store: IssueLinkStore,
    private readonly opts: IssueDedupeOptions = {},
  ) {}

  async decide(
    projectSlug: string,
    provider: ProviderName,
    fingerprint: string,
  ): Promise<DedupeDecision> {
    const open = await this.store.findOpen(projectSlug, provider, fingerprint);
    if (open)
      return { action: 'comment', link: open, reason: `open issue ${open.externalKey} exists` };
    const remote = await this.opts.findRemote?.(fingerprint);
    if (remote)
      return {
        action: 'comment',
        link: remote,
        reason: `open issue ${remote.externalKey} found by fingerprint`,
      };
    const all = await this.store.list(projectSlug, provider);
    const closed = all
      .filter((l) => l.fingerprint === fingerprint && l.status === 'closed')
      .sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt))[0];
    if (closed) {
      const days = this.opts.reopenAfterDays ?? 0;
      const closedAt = Date.parse(closed.closedAt ?? closed.updatedAt);
      if (days > 0 && Date.now() - closedAt < days * 86_400_000) {
        return {
          action: 'skip',
          link: closed,
          reason: `issue ${closed.externalKey} closed less than ${days} day(s) ago`,
        };
      }
    }
    return { action: 'create', reason: 'no open issue for this scenario' };
  }
}

/** Stable, human-readable issue title used by both providers. */
export function issueTitle(featureName: string, scenarioName: string, browser?: string): string {
  const where = browser ? ` (${browser})` : '';
  return `[SDODS] ${featureName} › ${scenarioName} failing${where}`;
}

export function fingerprintMarker(fingerprint: string): string {
  return `sdods-fingerprint:${fingerprint}`;
}
