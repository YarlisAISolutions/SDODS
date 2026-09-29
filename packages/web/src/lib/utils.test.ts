import { describe, expect, it } from 'vitest';
import { cliInstallUrl } from './utils';

describe('cliInstallUrl', () => {
  it('opens the install page on the tab for the visitor OS', () => {
    expect(cliInstallUrl('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'https://sdods.com/install/?os=windows',
    );
    expect(cliInstallUrl('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(
      'https://sdods.com/install/?os=macos',
    );
    expect(cliInstallUrl('Mozilla/5.0 (X11; Linux x86_64)')).toBe(
      'https://sdods.com/install/?os=linux',
    );
  });
});
