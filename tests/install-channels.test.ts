import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  INSTALL_CHANNELS,
  TAB_CHANNELS,
  alternatesFor,
  defaultTabFor,
} from '../apps/www/lib/install-channels.js';

const repoRoot = join(import.meta.dirname, '..');
const packaging = join(repoRoot, 'packaging');

describe('install channels', () => {
  it('every alternate hangs off a channel that owns a tab', () => {
    // An alternate whose parent is missing or is itself an alternate renders nowhere: the panel
    // it names is never drawn, so the command silently disappears from the page.
    const owners = new Set(INSTALL_CHANNELS.filter((c) => !c.under).map((c) => c.id));
    const orphans = INSTALL_CHANNELS.filter((c) => c.under && !owners.has(c.under));
    expect(orphans.map((c) => c.id)).toEqual([]);
  });

  it('a live alternate is never stranded under a channel that is not live', () => {
    // alternatesFor() only reaches channels whose parent panel is rendered, so a live winget under
    // a dead Windows tab would be published-but-invisible — the worst of both states.
    const live = new Map(INSTALL_CHANNELS.map((c) => [c.id, c.live]));
    const stranded = INSTALL_CHANNELS.filter((c) => c.live && c.under && !live.get(c.under));
    expect(stranded.map((c) => c.id)).toEqual([]);
  });

  it('no install command spans more than one line', () => {
    // A command that wraps gets pasted in two halves. That has already happened once to a real
    // person, which is why every command here is one line and the box scrolls instead.
    const wrapped = INSTALL_CHANNELS.filter((c) => /[\r\n]/.test(c.command));
    expect(wrapped.map((c) => c.id)).toEqual([]);
  });

  it('the default tab is always a script, on every platform', () => {
    // Package managers are a preference; the script is the one path that works for a visitor who
    // has none of them installed. Autodetect must never land on Homebrew.
    for (const os of ['macos', 'linux', 'windows'] as const) {
      expect(defaultTabFor(os)).toMatch(/^script-/);
    }
  });

  it('the compact home-page tab set is never empty', () => {
    // The scripts are hard-coded live, so this is a guard on someone marking them false: an empty
    // tablist renders nothing at all and the home page loses its only call to action.
    const compact = TAB_CHANNELS.filter((c) => c.id === 'script-unix' || c.id === 'script-windows');
    expect(compact.length).toBe(2);
  });

  it('a live channel names the artifact it actually installs', () => {
    // The failure this guards is a channel flipped live while its command still points at the
    // placeholder it was written with.
    const expected: Record<string, RegExp> = {
      npm: /@sdods\/cli/,
      homebrew: /^brew install \S+$/,
      docker: /ghcr\.io\//,
      winget: /^winget install \S+$/,
      scoop: /scoop/,
    };
    for (const channel of INSTALL_CHANNELS.filter((c) => c.live)) {
      const pattern = expected[channel.id];
      if (pattern) expect(channel.command, channel.id).toMatch(pattern);
    }
  });

  it('no rendered manifest still contains a template placeholder', () => {
    // Rendering writes the manifest next to its .tmpl. A leftover {{VERSION}} would be pushed to
    // a tap or a bucket and fail for every user, having passed every check here.
    const rendered: string[] = [];
    for (const dir of readdirSync(packaging, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const file of readdirSync(join(packaging, dir.name))) {
        if (file.endsWith('.tmpl') || file === 'README.md') continue;
        const full = join(packaging, dir.name, file);
        if (readFileSync(full, 'utf8').includes('{{')) rendered.push(`${dir.name}/${file}`);
      }
    }
    expect(rendered, 'run: bun run channels:sync').toEqual([]);
  });

  it('the Homebrew formula carries a real sha256 and the version it claims', () => {
    const formula = join(packaging, 'homebrew', 'sdods.rb');
    if (!existsSync(formula)) return; // not rendered until the package is published
    const source = readFileSync(formula, 'utf8');
    const sha = /sha256 "([^"]+)"/.exec(source)?.[1];
    // 64 hex characters, not a sha1 copied off a registry page and not a truncated paste.
    expect(sha).toMatch(/^[0-9a-f]{64}$/);

    // No `version` field: Homebrew scans it from the tarball name and `brew audit --strict`
    // rejects restating it, so the URL is the only place the version appears.
    expect(/\/cli-[\d.]+\.tgz/.test(source)).toBe(true);
    // The formula's own test must read the version back from Homebrew rather than bake it in --
    // a baked literal is the same redundancy audit rejects, one level down.
    expect(source).toContain('assert_match version.to_s');
  });

  it('every packaging directory has a template for what it publishes', () => {
    // A directory with a rendered manifest but no template is one somebody hand-edited, which is
    // the state this whole pipeline exists to prevent.
    for (const dir of ['homebrew', 'scoop', 'winget']) {
      const files = readdirSync(join(packaging, dir));
      expect(
        files.some((f) => f.endsWith('.tmpl')),
        `${dir} has no template`,
      ).toBe(true);
    }
  });

  it('the Scoop template renders to valid JSON and comments only under "##"', () => {
    // Scoop's schema sets additionalProperties:false and allows exactly one comment key, "##".
    // A "##installer" note reads like a comment and fails validation for the whole manifest.
    const tmpl = readFileSync(join(packaging, 'scoop', 'sdods.json.tmpl'), 'utf8');
    const manifest = JSON.parse(tmpl.replace(/\{\{\w+\}\}/g, 'x')) as Record<string, unknown>;
    const badComments = Object.keys(manifest).filter((k) => k.startsWith('##') && k !== '##');
    expect(badComments).toEqual([]);
  });

  it('the winget manifests parse, and ReleaseDate stays a string', () => {
    // Unquoted, YAML types `2026-09-07` as a date, and winget's schema requires a string —
    // `datetime.date is not of type 'string'`. It validates everywhere except the one queue that
    // matters, so the quoting is load-bearing.
    const dir = join(packaging, 'winget');
    const yamls = readdirSync(dir).filter((f) => f.endsWith('.yaml'));
    for (const file of yamls) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text, file).toMatch(/^PackageIdentifier: SDODS\.SDODS$/m);
      const date = /^ReleaseDate: (.+)$/m.exec(text)?.[1];
      // Either quote works -- both are YAML strings. What must not happen is a bare 2026-09-07,
      // which YAML types as a date and the winget schema rejects.
      if (date !== undefined)
        expect(date, `${file} ReleaseDate must be quoted`).toMatch(/^(".*"|'.*')$/);
    }
  });

  it('alternatesFor returns only live channels', () => {
    for (const channel of TAB_CHANNELS) {
      for (const alt of alternatesFor(channel.id)) {
        expect(alt.live, alt.id).toBe(true);
        expect(alt.under).toBe(channel.id);
      }
    }
  });

  it('every apt address a reader is told to use is the one the probe checks', () => {
    // The docs once told readers to fetch the keyring from GitHub Pages on sdods-releases, which
    // was never switched on, while the repository itself was live on sdods.com/apt. The probe
    // pointed at the same dead address, so the page reported a working channel as missing.
    const sync = readFileSync(join(repoRoot, 'scripts/sync-channels.ts'), 'utf8');
    const aptUrl = /const APT_URL = process\.env\.SDODS_APT_URL \?\? '([^']+)'/.exec(sync)?.[1];
    expect(aptUrl).toBe('https://sdods.com/apt');
    for (const file of [
      'apps/docs/content/docs/getting-started/installation.mdx',
      'apps/www/app/apt/page.tsx',
    ]) {
      const text = readFileSync(join(repoRoot, file), 'utf8');
      const urls = text.match(/https:\/\/[^\s"'`)]+\/apt(?:\/[^\s"'`)]*)?/g) ?? [];
      expect(urls.length, file).toBeGreaterThan(0);
      expect(
        urls.filter((u) => !u.startsWith(aptUrl!)),
        file,
      ).toEqual([]);
    }
  });
});
