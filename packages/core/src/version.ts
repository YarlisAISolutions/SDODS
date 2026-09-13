import { createRequire } from 'node:module';

/**
 * The SDODS version, read from this package's own manifest.
 *
 * Hand-maintaining this constant drifted: it said 0.2.2 while every publishable package was at
 * 0.3.2. That is load-bearing rather than cosmetic — `sdods init` writes `^${VERSION}` into every
 * scaffolded workspace, and a caret on a 0.x version does not cross the minor, so `^0.2.2` pinned
 * those workspaces (the desktop app's included) to a 0.2.x CLI that predated the commands the web
 * UI calls.
 *
 * Resolves to `packages/core/package.json` from both `src/version.ts` and `dist/version.js`, since
 * `dist` sits one level below the package root.
 */
const manifest = createRequire(import.meta.url)('../package.json') as { version: string };

export const VERSION: string = manifest.version;
