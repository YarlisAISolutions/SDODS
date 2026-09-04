/**
 * Base path and site URL, fixed at build time.
 *
 * - Custom domain (default): DOCS_BASE_PATH unset → basePath '' and https://docs.sdods.com
 * - Project GitHub Pages:    DOCS_BASE_PATH=/SDODS → basePath '/SDODS' and https://siri1410.github.io
 *
 * next.config.mjs copies DOCS_BASE_PATH into NEXT_PUBLIC_BASE_PATH so client and server code agree.
 */
export const basePath: string = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const siteUrl: string = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://docs.sdods.com';

/** Prefix an absolute in-site path (`/img/x.svg`) with the base path. */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  return `${basePath}${path}`;
}
