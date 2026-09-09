import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SdodsError } from '../errors.js';

/**
 * Absolute glob of the core step library. Built from this file's real path so Playwright's
 * TS transform sees a workspace path (not node_modules) and playwright-bdd loads it.
 */
export function coreStepsDir(): string {
  return dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
}

/** The library names present in this build — `a11y` for `a11y.steps.ts`. */
export function coreStepNames(): string[] {
  return readdirSync(coreStepsDir())
    .map((f) => /^(.+)\.steps\.(?:js|ts)$/.exec(f)?.[1])
    .filter((n): n is string => Boolean(n))
    .sort();
}

/**
 * Both extensions, because this resolves against whichever copy of the package is running: the
 * workspace checkout ships `*.steps.ts`, the published package ships the compiled `*.steps.js`.
 * Only one set exists in a given directory, so the brace never double-matches. `.d.ts` files sit
 * outside the pattern. playwright-bdd passes explicit patterns to tinyglobby untouched — it only
 * appends extensions to bare directory patterns — and neither it nor tinyglobby excludes
 * node_modules, so the published layout globs fine.
 * */
export function coreStepsGlob(): string {
  return `${coreStepsDir()}/*.steps.{js,ts}`;
}

/**
 * The patterns bddgen should load, honouring `steps.core.exclude`.
 *
 * Separate from `coreStepsGlob()` because that one is exported API and returns a single string;
 * widening its return type would break every caller for the sake of an option most projects
 * never set. With nothing excluded this returns exactly that same glob, so the common path is
 * byte-identical to what shipped before.
 *
 * An unknown name THROWS rather than being ignored. A silent no-op on a typo would leave the
 * project believing it had excluded a library while the collision it was avoiding still fails
 * generation — and the error it would then read points at the step, not at the typo.
 */
export function coreStepsPatterns(exclude: readonly string[] = []): string[] {
  if (exclude.length === 0) return [coreStepsGlob()];

  const available = coreStepNames();
  const unknown = exclude.filter((n) => !available.includes(n));
  if (unknown.length) {
    throw new SdodsError(
      'CONFIG_INVALID',
      `steps.core.exclude names ${unknown.length === 1 ? 'a library' : 'libraries'} that ` +
        `${unknown.length === 1 ? 'does' : 'do'} not exist: ${unknown.join(', ')}.`,
      {
        hint: `Available: ${available.join(', ')}. Names are the file basenames, so "a11y" for a11y.steps.ts.`,
      },
    );
  }
  // Explicit per-library patterns rather than a negated glob: playwright-bdd hands these to
  // tinyglobby verbatim, and a `!`-prefixed entry in that list is treated as a path, not an
  // exclusion.
  return available
    .filter((n) => !exclude.includes(n))
    .map((n) => `${coreStepsDir()}/${n}.steps.{js,ts}`);
}
