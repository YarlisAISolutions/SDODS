import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CUSTOM_AMOUNT_URL,
  MANAGE_SUBSCRIPTION_URL,
  SPONSOR_ENABLED,
  SPONSOR_LINKS,
  SPONSOR_PUBLIC,
  SPONSOR_TIERS,
  SPONSOR_URL,
  tiersFor,
} from '../apps/www/lib/sponsor.js';

const repoRoot = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('sponsorship', () => {
  it('the Stripe links are all set or all empty, never half of each', () => {
    // SPONSOR_PUBLIC turns the whole ask on. With some links filled and others empty the page
    // would show buttons that go nowhere, so a partial set is always a mistake.
    const filled = SPONSOR_LINKS.filter((u) => u !== '');
    expect([0, SPONSOR_LINKS.length]).toContain(filled.length);
    expect(SPONSOR_PUBLIC).toBe(SPONSOR_ENABLED && filled.length === SPONSOR_LINKS.length);
  });

  it('every link goes to Stripe', () => {
    for (const t of SPONSOR_TIERS.filter((t) => t.url)) {
      expect(t.url, t.id).toMatch(/^https:\/\/buy\.stripe\.com\//);
    }
    if (CUSTOM_AMOUNT_URL) expect(CUSTOM_AMOUNT_URL).toMatch(/^https:\/\/buy\.stripe\.com\//);
    if (MANAGE_SUBSCRIPTION_URL) {
      expect(MANAGE_SUBSCRIPTION_URL).toMatch(/^https:\/\/billing\.stripe\.com\/p\/login\//);
    }
  });

  it('offers one-time and monthly tiers, each with a unique id and link', () => {
    expect(tiersFor('once').length).toBeGreaterThan(0);
    expect(tiersFor('monthly').length).toBeGreaterThan(0);
    expect(new Set(SPONSOR_TIERS.map((t) => t.id)).size).toBe(SPONSOR_TIERS.length);
    const urls = SPONSOR_LINKS.filter((u) => u !== '');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('asks for nothing while SPONSOR_ENABLED is off, and every copy of the switch agrees', () => {
    if (!SPONSOR_ENABLED) expect(SPONSOR_PUBLIC).toBe(false);
    // The installers and the desktop menu cannot import @sdods/contracts and keep their own copy.
    expect(read('installer/install.sh')).toContain(`SPONSOR_ENABLED=${SPONSOR_ENABLED ? 1 : 0}\n`);
    expect(read('installer/install.ps1')).toContain(`$SponsorEnabled = $${SPONSOR_ENABLED}\n`);
    expect(read('apps/desktop/src/main/menu.ts')).toContain(
      `const SPONSOR_ENABLED = ${SPONSOR_ENABLED};\n`,
    );
    // README.md and FUNDING.yml cannot branch, so the ask sits in a comment while the switch is off.
    const visible = {
      'README.md': read('README.md').replace(/<!--[\s\S]*?-->/g, ''),
      '.github/FUNDING.yml': read('.github/FUNDING.yml').replace(/^\s*#.*$/gm, ''),
    };
    for (const [path, text] of Object.entries(visible)) {
      expect(text.includes(SPONSOR_URL), path).toBe(SPONSOR_ENABLED);
    }
    // The code surfaces link through the switch rather than unconditionally. In the web UI the
    // link lives in the account menu.
    for (const path of [
      'packages/cli/src/program.ts',
      'packages/web/src/components/UserMenu.tsx',
    ]) {
      expect(read(path), path).toContain('SPONSOR_ENABLED');
    }
    for (const path of ['apps/www/app/sponsor/page.tsx', 'apps/www/app/sponsor/thanks/page.tsx']) {
      expect(read(path), path).toContain('if (!SPONSOR_ENABLED) notFound();');
    }
  });

  it('only the site holds Stripe URLs; everything else links to the sponsor page', () => {
    // Links and prices can then change with a site deploy, without a CLI or desktop release.
    expect(SPONSOR_URL).toBe('https://sdods.com/sponsor/');
    const surfaces = [
      'README.md',
      '.github/FUNDING.yml',
      'installer/install.ps1',
      'apps/desktop/src/main/menu.ts',
    ];
    for (const path of surfaces) {
      const text = read(path);
      expect(text, path).toContain('https://sdods.com/sponsor/');
      expect(text, path).not.toMatch(/(buy|billing)\.stripe\.com/);
    }
    // The CLI and web UI take the URL and the switch from @sdods/contracts.
    for (const path of [
      'packages/cli/src/program.ts',
      'packages/web/src/components/UserMenu.tsx',
    ]) {
      const text = read(path);
      expect(text, path).toContain(
        "import { SPONSOR_ENABLED, SPONSOR_URL } from '@sdods/contracts/sponsor';",
      );
      expect(text, path).not.toMatch(/(buy|billing)\.stripe\.com/);
    }
    // install.sh builds the URL from SITE_URL.
    const sh = read('installer/install.sh');
    expect(sh).toContain("SITE_URL='https://sdods.com'");
    expect(sh).toContain('${SITE_URL}/sponsor/');
    expect(sh).not.toMatch(/(buy|billing)\.stripe\.com/);
  });
});
