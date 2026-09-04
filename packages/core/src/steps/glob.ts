import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute glob of the core step library. Built from this file's real path so Playwright's
 * TS transform sees a workspace path (not node_modules) and playwright-bdd loads it.
 */
export function coreStepsDir(): string {
  return dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
}

export function coreStepsGlob(): string {
  return `${coreStepsDir()}/*.steps.ts`;
}
