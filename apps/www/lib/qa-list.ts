/**
 * The shapes the questions list works in.
 *
 * Deliberately plain data with no dependency on `@sdods/qa-archive` at runtime: the browser island
 * that renders the list must not pull the archive (or the Firestore SDK) into its bundle, so
 * everything it needs — display names, avatar colours, excerpts — is computed on the server and
 * handed over as props or fetched from the generated index.
 */

export type Sort = 'newest' | 'unanswered';

export interface PersonChip {
  handle: string;
  display: string;
  maintainer: boolean;
  hue: number;
  initials: string;
}

/** One row in the list, from either source. */
export interface ListItem {
  /** `archive:<slug>` or `live:<id>` — the two namespaces cannot collide. */
  key: string;
  source: 'archive' | 'live';
  href: string;
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  date: string;
  tags: string[];
  /** Live questions carry no vote count; rendering a 0 would read as a downvote. */
  votes: number | null;
  answers: number;
  accepted: boolean;
  views: number | null;
}

export interface IndexRecord {
  s: string;
  t: string;
  x: string;
  g: number[];
  d: string;
  a: string;
  v: number;
  n: number;
  k: 0 | 1;
  w: number;
}

export interface QaIndex {
  tags: string[];
  items: IndexRecord[];
}

export function fromIndex(rec: IndexRecord, tags: string[]): ListItem {
  return {
    key: `archive:${rec.s}`,
    source: 'archive',
    href: `/questions/${rec.s}/`,
    slug: rec.s,
    title: rec.t,
    excerpt: rec.x,
    author: rec.a,
    date: rec.d,
    tags: rec.g.map((i) => tags[i]!).filter(Boolean),
    votes: rec.v,
    answers: rec.n,
    accepted: rec.k === 1,
    views: rec.w,
  };
}

/** Everything the search box looks at, lowercased once so filtering is a substring test. */
export function haystack(item: ListItem): string {
  return `${item.title} ${item.excerpt} ${item.tags.join(' ')} ${item.author}`.toLowerCase();
}

export function sortItems(items: ListItem[], sort: Sort): ListItem[] {
  const out = [...items];
  switch (sort) {
    case 'unanswered':
      return out.filter((i) => i.answers === 0).sort((a, b) => b.date.localeCompare(a.date));
    case 'newest':
    default:
      return out.sort((a, b) => b.date.localeCompare(a.date));
  }
}

export function filterItems(
  items: ListItem[],
  opts: { query: string; tag: string | null; from: string; to: string },
): ListItem[] {
  const q = opts.query.trim().toLowerCase();
  return items.filter((item) => {
    if (opts.tag && !item.tags.includes(opts.tag)) return false;
    if (opts.from && item.date < opts.from) return false;
    if (opts.to && item.date > opts.to) return false;
    if (q && !haystack(item).includes(q)) return false;
    return true;
  });
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
