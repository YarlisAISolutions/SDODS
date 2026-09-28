import { describe, expect, it } from 'vitest';
import {
  DESKTOP_RELEASE,
  isSigned,
  parseSignedPlatforms,
  type DesktopRelease,
  type Platform,
} from '../apps/www/lib/desktop-release.js';

// `desktop:sync-release --signed=<list>` feeds this parser. A single boolean once meant that
// signing macOS also dropped the SmartScreen advice for a Windows installer that still needed it.
describe('parseSignedPlatforms', () => {
  it('accepts one platform, both, or all', () => {
    expect(parseSignedPlatforms('macos')).toEqual(['macos']);
    expect(parseSignedPlatforms('windows')).toEqual(['windows']);
    expect(parseSignedPlatforms('windows, MacOS')).toEqual(['macos', 'windows']);
    expect(parseSignedPlatforms('all')).toEqual(['macos', 'windows']);
  });

  it('refuses a bare flag, so nobody signs every platform by accident', () => {
    expect(() => parseSignedPlatforms('')).toThrow(/needs the platforms/);
  });

  it('refuses linux, which has nothing to sign', () => {
    expect(() => parseSignedPlatforms('macos,linux')).toThrow(/Linux has nothing to sign/);
  });

  it('refuses typos rather than reading them as "not signed"', () => {
    expect(() => parseSignedPlatforms('mac')).toThrow(/unknown platform\(s\) mac/);
  });
});

describe('isSigned', () => {
  const release = (signed: DesktopRelease['signed']): DesktopRelease => ({
    ...DESKTOP_RELEASE,
    signed,
  });

  it('treats Linux as always fine and each OS independently', () => {
    const all: Platform[] = ['macos', 'windows', 'linux'];
    expect(all.map((p) => isSigned(release([]), p))).toEqual([false, false, true]);
    expect(isSigned(release(['macos']), 'macos')).toBe(true);
    expect(isSigned(release(['macos']), 'windows')).toBe(false);
    expect(isSigned(release(['macos', 'windows']), 'windows')).toBe(true);
  });
});
