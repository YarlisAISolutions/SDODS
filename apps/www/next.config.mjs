/* global process */
/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.WWW_SITE_URL ?? 'https://sdods.com',
  },
};

export default config;
