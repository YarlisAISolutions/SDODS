/* global process */
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/**
 * The site is served at https://docs.sdods.com (basePath '') by default.
 * Set DOCS_BASE_PATH=/SDODS to build for the project GitHub Pages URL instead.
 */
const basePath = (process.env.DOCS_BASE_PATH ?? '').replace(/\/$/, '');
const siteUrl =
  process.env.DOCS_SITE_URL ??
  (basePath === '/SDODS' ? 'https://yarlisaisolutions.github.io' : 'https://docs.sdods.com');

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // The roadmap data is a workspace package of raw TypeScript.
  transpilePackages: ['@sdods/contracts', '@sdods/roadmap', '@sdods/site-kit'],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_URL: siteUrl,
    // The month the roadmap measures itself against (packages/roadmap/src/calendar.ts), fixed at
    // build time so a client component renders the same month the server did.
    ROADMAP_TODAY: process.env.ROADMAP_TODAY || new Date().toISOString().slice(0, 7),
  },
};

export default withMDX(config);
