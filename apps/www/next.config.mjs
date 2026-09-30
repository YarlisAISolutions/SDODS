/* global process */

// The site's sign-in. `@sdods/site-kit/identity-impl` is "no sign-in"; a deployment points it at its
// own module exporting `createIdentity()` (sdods.com: ./lib/firebase-identity.ts, set in www.yml).
const identityModule = process.env.SDODS_IDENTITY_MODULE;

/** @type {import('next').NextConfig} */
const config = {
  ...(identityModule && {
    turbopack: { resolveAlias: { '@sdods/site-kit/identity-impl': identityModule } },
  }),
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // The roadmap data is a workspace package of raw TypeScript.
  transpilePackages: ['@sdods/contracts', '@sdods/roadmap', '@sdods/qa-archive', '@sdods/site-kit'],
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.WWW_SITE_URL ?? 'https://sdods.com',
  },
};

export default config;
