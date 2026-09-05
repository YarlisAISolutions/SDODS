import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute glob of the core step library. Built from this file's real path so Playwright's
 * TS transform sees a workspace path (not node_modules) and playwright-bdd loads it.
 */
export function coreStepsDir(): string {
  return dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
}

/**
 * Both extensions, because this resolves against whichever copy of the package is running: the
 * workspace checkout ships `*.steps.ts`, the published package ships the compiled `*.steps.js`.
 * Only one set exists in a given directory, so the brace never double-matches. `.d.ts` files sit
 * outside the pattern. playwright-bdd passes explicit patterns to tinyglobby untouched — it only
 * appends extensions to bare directory patterns — and neither it nor tinyglobby excludes
 * node_modules, so the published layout globs fine.
 */
export function coreStepsGlob(): string {
  return `${coreStepsDir()}/*.steps.{js,ts}`;
}
