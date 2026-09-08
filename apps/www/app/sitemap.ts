import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/links';

export const dynamic = 'force-static';

/**
 * Every page worth indexing, with the priority reflecting what a visitor is usually looking for.
 *
 * Hand-maintained, so it needs a line when a route is added — /download and /questions had been
 * missing since they shipped, which meant the page the whole desktop release exists to serve was
 * not in the sitemap at all.
 */
const PAGES: Array<[path: string, priority: number]> = [
  ['/', 1],
  ['/install/', 0.9],
  ['/download/', 0.9],
  ['/roadmap/', 0.6],
  ['/questions/', 0.6],
  ['/feedback/', 0.6],
  // A repository address that happens to have a page. Worth indexing so someone searching for the
  // apt setup finds it, but it is not a destination anyone browses to.
  ['/apt/', 0.4],
  ['/privacy/', 0.3],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map(([path, priority]) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority,
  }));
}
