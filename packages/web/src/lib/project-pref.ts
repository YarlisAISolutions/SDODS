import { readPref, writePref } from './utils';

/**
 * The project the sidebar shows when the URL does not name one.
 *
 * Organization and workspace have persisted this way since the shell was written; the project did
 * not, so it silently fell back to whichever project sorted first on disk. That is what made
 * demo-shop look like a permanent default.
 */
const KEY = 'project';

export const readProjectPref = () => readPref<string | null>(KEY, null);
export const writeProjectPref = (slug: string) => writePref(KEY, slug);

/** Called after a delete: a stored slug that no longer exists would pin the sidebar to nothing. */
export function clearProjectPref(slug?: string) {
  if (slug && readProjectPref() !== slug) return;
  writePref<string | null>(KEY, null);
}
