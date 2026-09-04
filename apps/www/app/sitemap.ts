import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/links';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ['/', '/feedback/', '/roadmap/', '/privacy/'].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.6,
  }));
}
