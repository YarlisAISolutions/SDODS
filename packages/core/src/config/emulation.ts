import { devices } from '@playwright/test';
import { SdodsError } from '../errors.js';
import { parseTagValues } from './tags.js';

/**
 * Per-scenario browser emulation from tags: `@locale:<bcp47>`, `@timezone:<IANA>`,
 * `@theme:<light|dark|no-preference>`, `@viewport:<W>x<H>` and `@device:<name>`.
 *
 * Six locales × dark/light used to mean twelve env yamls, because the only place a browser
 * context's locale and colour scheme could be set was the env's `use:` block. The tags move that
 * axis onto the scenario (or a Feature, or a tagged `Examples:` block), so one env file covers
 * every combination.
 *
 * Locale and timezone are fixed when Playwright creates the browser context and cannot be
 * changed afterwards, which is why these are tags resolved by fixtures before the context opens,
 * rather than steps. Precedence, highest first: the tag, then the env's `use:`, then Playwright's
 * default. `@viewport:` wins over the viewport of `@device:`.
 *
 * Kept pure (no fixtures, no browser) so the precedence and the validation that lint shares with
 * the runtime are testable on their own — the `scenarioSkipReason` precedent.
 */

export const EMULATION_TAGS = ['locale', 'timezone', 'theme', 'viewport', 'device'] as const;
export type EmulationTag = (typeof EMULATION_TAGS)[number];

export const COLOR_SCHEMES = ['light', 'dark', 'no-preference'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export interface ViewportSize {
  width: number;
  height: number;
}

export interface EmulatedDevice {
  /** The Playwright device descriptor name, e.g. `iPhone 15`. */
  name: string;
  userAgent: string;
  viewport: ViewportSize;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

export interface Emulation {
  locale?: string;
  timezoneId?: string;
  colorScheme?: ColorScheme;
  viewport?: ViewportSize;
  device?: EmulatedDevice;
}

/** `320x640` → `{ width: 320, height: 640 }`, or undefined when it is not a usable size. */
export function parseViewport(value: string): ViewportSize | undefined {
  const m = /^(\d{1,5})x(\d{1,5})$/.exec(value.trim());
  if (!m) return undefined;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * A tag value cannot contain a space, and every Playwright device name does (`iPhone 15`,
 * `Galaxy S9+`). Names match case-insensitively with any run of spaces, hyphens or underscores
 * treated as one separator, so `@device:iPhone-15` and `@device:iphone_15` both find `iPhone 15`.
 */
export function findDevice(value: string): string | undefined {
  if (value in devices) return value;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '-');
  const wanted = norm(value);
  return Object.keys(devices).find((name) => norm(name) === wanted);
}

/** Why `@<key>:<value>` is unusable, or undefined when it is fine. Shared by lint and runtime. */
export function emulationTagProblem(key: EmulationTag, value: string): string | undefined {
  switch (key) {
    case 'locale':
      try {
        // Throws RangeError on anything that is not a structurally valid BCP 47 tag.
        Intl.getCanonicalLocales(value);
        return undefined;
      } catch {
        return `@locale:${value} is not a BCP 47 locale (e.g. fr, fr-FR, pt-BR${value.includes('_') ? ' — use a hyphen, not an underscore' : ''}).`;
      }
    case 'timezone':
      try {
        // Accepts every IANA zone and its aliases (UTC, Etc/GMT+1) — `Intl.supportedValuesOf`
        // lists canonical names only, so it would reject `UTC` on some runtimes.
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return undefined;
      } catch {
        return `@timezone:${value} is not an IANA time zone (e.g. Europe/Paris, America/New_York, UTC).`;
      }
    case 'theme':
      return (COLOR_SCHEMES as readonly string[]).includes(value)
        ? undefined
        : `@theme:${value} must be one of ${COLOR_SCHEMES.join(', ')}.`;
    case 'viewport':
      return parseViewport(value)
        ? undefined
        : `@viewport:${value} must be <width>x<height> in CSS pixels (e.g. @viewport:320x640).`;
    case 'device':
      return findDevice(value)
        ? undefined
        : `@device:${value} is not a Playwright device. Write the descriptor name with hyphens for spaces (e.g. @device:iPhone-15, @device:Pixel-7).`;
  }
}

/**
 * The emulation a scenario's tags ask for. Keys the tags do not mention are absent, so the
 * caller falls back to whatever the env or Playwright would have used.
 *
 * Throws on an unusable value or on two different values for the same key: lint reports both
 * first, and a scenario that reaches the runner anyway must fail loudly rather than run under
 * an emulation nobody asked for.
 */
export function emulationFromTags(tags: readonly string[]): Emulation {
  const one = (key: EmulationTag): string | undefined => {
    const values = [...new Set(parseTagValues(tags, key))];
    if (values.length > 1)
      throw new SdodsError(
        'CONFIG_INVALID',
        `Conflicting tags @${key}:${values.join(` and @${key}:`)} on one scenario.`,
        {
          hint: `A scenario runs in one browser context, so it takes one @${key}: value. Tags on the Feature apply to every scenario in it — remove the duplicate from the scenario or the Feature.`,
        },
      );
    const value = values[0];
    if (value === undefined) return undefined;
    const problem = emulationTagProblem(key, value);
    if (problem) throw new SdodsError('CONFIG_INVALID', problem, { hint: 'Run `sdods lint`.' });
    return value;
  };

  const out: Emulation = {};
  const locale = one('locale');
  // Canonical form (`fr-fr` → `fr-FR`), so the context and `I use the locale` agree on spelling.
  if (locale) out.locale = Intl.getCanonicalLocales(locale)[0];
  const timezone = one('timezone');
  if (timezone) out.timezoneId = timezone;
  const theme = one('theme');
  if (theme) out.colorScheme = theme as ColorScheme;
  const viewport = one('viewport');
  if (viewport) out.viewport = parseViewport(viewport);
  const deviceTag = one('device');
  if (deviceTag) {
    const name = findDevice(deviceTag) as string;
    const d = devices[name]!;
    out.device = {
      name,
      userAgent: d.userAgent,
      viewport: d.viewport,
      deviceScaleFactor: d.deviceScaleFactor,
      isMobile: d.isMobile,
      hasTouch: d.hasTouch,
    };
  }
  return out;
}

/** The browser-context option values a scenario gets: tags first, then what the project resolved. */
export interface ContextEmulationBase {
  locale?: string;
  timezoneId?: string;
  colorScheme?: ColorScheme | null;
  viewport?: ViewportSize | null;
  userAgent?: string;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  browserName?: string;
}

export function applyEmulation<T extends ContextEmulationBase>(
  base: T,
  emulation: Emulation,
): Omit<T, 'browserName'> {
  const { browserName, ...rest } = base;
  const d = emulation.device;
  return {
    ...rest,
    ...(emulation.locale !== undefined ? { locale: emulation.locale } : {}),
    ...(emulation.timezoneId !== undefined ? { timezoneId: emulation.timezoneId } : {}),
    ...(emulation.colorScheme !== undefined ? { colorScheme: emulation.colorScheme } : {}),
    ...(d
      ? {
          viewport: d.viewport,
          userAgent: d.userAgent,
          deviceScaleFactor: d.deviceScaleFactor,
          hasTouch: d.hasTouch,
          // Firefox rejects `isMobile` at context creation. The engine is the run target's, so a
          // device tag on the firefox target emulates size, agent and touch only.
          ...(browserName === 'firefox' ? {} : { isMobile: d.isMobile }),
        }
      : {}),
    ...(emulation.viewport !== undefined ? { viewport: emulation.viewport } : {}),
  } as Omit<T, 'browserName'>;
}
