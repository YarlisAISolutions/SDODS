/**
 * Ways to fund a project, as data. A project passes the links it actually has; everything else is
 * left out, so a site never shows a button that leads nowhere.
 */

export type SupportProviderId =
  | 'sponsor-page'
  | 'github-sponsors'
  | 'open-collective'
  | 'buy-me-a-coffee'
  | 'ko-fi'
  | 'stripe'
  | 'liberapay'
  | 'polar';

export interface SupportProvider {
  id: SupportProviderId;
  /** Button label. */
  label: string;
  /** Hosts a link for this provider may point at; an empty list accepts any https host. */
  hosts: string[];
}

export const SUPPORT_PROVIDERS: Record<SupportProviderId, SupportProvider> = {
  'sponsor-page': { id: 'sponsor-page', label: 'Sponsor', hosts: [] },
  'github-sponsors': { id: 'github-sponsors', label: 'GitHub Sponsors', hosts: ['github.com'] },
  'open-collective': {
    id: 'open-collective',
    label: 'Open Collective',
    hosts: ['opencollective.com'],
  },
  'buy-me-a-coffee': {
    id: 'buy-me-a-coffee',
    label: 'Buy me a coffee',
    hosts: ['buymeacoffee.com', 'www.buymeacoffee.com'],
  },
  'ko-fi': { id: 'ko-fi', label: 'Ko-fi', hosts: ['ko-fi.com'] },
  stripe: { id: 'stripe', label: 'Donate', hosts: ['buy.stripe.com', 'donate.stripe.com'] },
  liberapay: { id: 'liberapay', label: 'Liberapay', hosts: ['liberapay.com'] },
  polar: { id: 'polar', label: 'Polar', hosts: ['polar.sh', 'buy.polar.sh'] },
};

export type SupportLinks = Partial<Record<SupportProviderId, string | undefined>>;

export interface ResolvedSupportLink {
  provider: SupportProvider;
  href: string;
}

/**
 * The links worth rendering, in a stable order: present, https, and on a host that belongs to the
 * provider. A typo or a pasted `javascript:` URL is dropped rather than rendered.
 */
export function resolveSupportLinks(links: SupportLinks): ResolvedSupportLink[] {
  const order = Object.keys(SUPPORT_PROVIDERS) as SupportProviderId[];
  return order.flatMap((id) => {
    const raw = links[id]?.trim();
    if (!raw) return [];
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return [];
    }
    const provider = SUPPORT_PROVIDERS[id];
    if (url.protocol !== 'https:') return [];
    if (provider.hosts.length && !provider.hosts.includes(url.hostname)) return [];
    return [{ provider, href: url.toString() }];
  });
}

export interface SupportMessageInput {
  name: string;
  /** e.g. "Apache-2.0 on npm". */
  license?: string;
  /** What is free, e.g. ["unlimited API tokens", "no paid tier"]. */
  free?: string[];
  /** Say "open source" only when the source is actually public. */
  openSource?: boolean;
}

export function supportMessage(p: SupportMessageInput): string {
  const facts = [p.license, ...(p.free ?? [])].filter(Boolean).join(', ');
  const what = p.openSource ? 'free and open source' : 'free';
  return `${p.name} is ${what}${facts ? ` — ${facts}` : ''}. If it saves your team time, support its development and help keep it that way.`;
}
