/* global process */
/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // The roadmap data is a workspace package of raw TypeScript.
  transpilePackages: ['@sdods/roadmap', '@sdods/qa-archive'],
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.WWW_SITE_URL ?? 'https://sdods.com',
  },
};

export default config;
