import { readPref, writePref } from './utils';

export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_PREFS: ThemePref[] = ['system', 'light', 'dark'];

/** Same key the pre-paint script in index.html reads, so the first frame is already themed. */
const KEY = 'theme';
const media = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function readThemePref(): ThemePref {
  const v = readPref<string>(KEY, 'system');
  return (THEME_PREFS as string[]).includes(v) ? (v as ThemePref) : 'system';
}

export const resolveTheme = (pref: ThemePref): 'light' | 'dark' =>
  pref === 'system' ? (media()?.matches ? 'dark' : 'light') : pref;

/** Writes the resolved theme onto <html>; index.css keys both the tokens and `dark:` off it. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  const resolved = resolveTheme(pref);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

let unwatch: (() => void) | null = null;

/** Save and apply. On "system" the page follows the OS switching while it is open. */
export function setThemePref(pref: ThemePref) {
  writePref(KEY, pref);
  applyTheme(pref);
  unwatch?.();
  unwatch = null;
  const mq = media();
  if (pref === 'system' && mq?.addEventListener) {
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    unwatch = () => mq.removeEventListener('change', onChange);
  }
}

export function initTheme() {
  setThemePref(readThemePref());
}
