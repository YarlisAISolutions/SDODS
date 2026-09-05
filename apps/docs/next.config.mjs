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
  (basePath === '/SDODS' ? 'https://siri1410.github.io' : 'https://docs.sdods.com');

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // The roadmap data is a workspace package of raw TypeScript.
  transpilePackages: ['@sdods/roadmap'],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_URL: siteUrl,
  },
};

export default withMDX(config);
