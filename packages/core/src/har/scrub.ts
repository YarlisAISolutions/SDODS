import { readFileSync, writeFileSync } from 'node:fs';
import { SECRET_HEADER } from './api-har.js';

/**
 * Strip credentials out of a HAR recorded by the browser.
 *
 * The API layer builds its own HAR and redacts secret headers as it goes. The browser layer does
 * not: Playwright's `routeFromHAR({ update: true })` writes the file itself, verbatim, including
 * the `Cookie`, `Set-Cookie` and `Authorization` headers of the application under test. HARs are
 * meant to be committed — the demo project's are in git — so recording against a real application
 * while signed in wrote a live session into a tracked file.
 *
 * Values are replaced rather than the headers removed, so replay still matches on their presence.
 */
export function scrubHar(har: unknown): { changed: number } {
  let changed = 0;
  const entries = (har as { log?: { entries?: unknown[] } })?.log?.entries;
  if (!Array.isArray(entries)) return { changed };
  for (const entry of entries) {
    for (const side of ['request', 'response'] as const) {
      const headers = (entry as Record<string, { headers?: { name: string; value: string }[] }>)[
        side
      ]?.headers;
      if (!Array.isArray(headers)) continue;
      for (const h of headers) {
        if (h && typeof h.name === 'string' && SECRET_HEADER.test(h.name) && h.value !== '***') {
          h.value = '***';
          changed++;
        }
      }
    }
    // Playwright also records cookies as structured arrays alongside the headers.
    for (const side of ['request', 'response'] as const) {
      const cookies = (entry as Record<string, { cookies?: { value?: string }[] }>)[side]?.cookies;
      if (!Array.isArray(cookies)) continue;
      for (const c of cookies) {
        if (c && typeof c.value === 'string' && c.value !== '***') {
          c.value = '***';
          changed++;
        }
      }
    }
  }
  return { changed };
}

/** Scrub a HAR file in place. Returns how many values were replaced, or -1 if it is not readable. */
export function scrubHarFile(file: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return -1;
  }
  const { changed } = scrubHar(parsed);
  if (changed > 0) writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
  return changed;
}
