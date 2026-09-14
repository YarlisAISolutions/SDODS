import type { MetadataRoute } from 'next';
import { HANDLES, TAG_NAMES, THREADS, USE_CASES } from '@sdods/qa-archive';
import { SITE_URL } from '@/lib/links';
import { DESKTOP_PUBLIC } from '@/lib/desktop-release';
import { SPONSOR_PUBLIC } from '@/lib/sponsor';

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
  // Only while at least one platform is offered -- see DESKTOP_PLATFORMS in lib/desktop-release.
  ...(DESKTOP_PUBLIC ? ([['/download/', 0.9]] as Array<[string, number]>) : []),
  ['/roadmap/', 0.6],
  ['/questions/', 0.7],
  ['/questions/tags/', 0.5],
  ['/questions/users/', 0.4],
  ['/questions/use-cases/', 0.6],
  ['/feedback/', 0.6],
  // /sponsor/ always renders, but until the Stripe links exist it is only an email address.
  // /sponsor/thanks/ is where Checkout lands and is never listed.
  ...(SPONSOR_PUBLIC ? ([['/sponsor/', 0.5]] as Array<[string, number]>) : []),
  // A repository address that happens to have a page. Worth indexing so someone searching for the
  // apt setup finds it, but it is not a destination anyone browses to.
  ['/apt/', 0.4],
  ['/privacy/', 0.3],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = PAGES.map(([path, priority]) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority,
  }));

  // Every question, tag and profile page. Generated rather than listed, because the whole point of
  // rendering the archive statically is that a search engine can reach all of it — and a
  // hand-maintained list of several hundred URLs would be wrong within a week.
  // `/questions/live/` is deliberately absent: it renders empty at build time.
  const threads: MetadataRoute.Sitemap = THREADS.map((t) => ({
    url: `${SITE_URL}/questions/${t.slug}/`,
    lastModified: new Date(
      t.answers.reduce((latest, a) => (a.on > latest ? a.on : latest), t.askedOn),
    ),
    changeFrequency: 'yearly',
    priority: 0.5,
  }));

  const tags: MetadataRoute.Sitemap = TAG_NAMES.map((tag) => ({
    url: `${SITE_URL}/questions/tags/${tag}/`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.4,
  }));

  const people: MetadataRoute.Sitemap = HANDLES.map((handle) => ({
    url: `${SITE_URL}/questions/users/${handle}/`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.3,
  }));

  const useCases: MetadataRoute.Sitemap = USE_CASES.map((u) => ({
    url: `${SITE_URL}/questions/use-cases/${u.slug}/`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  return [...pages, ...threads, ...tags, ...people, ...useCases];
}
