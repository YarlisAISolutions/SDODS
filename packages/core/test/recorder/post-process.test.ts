import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { postProcessRecording } from '../../src/recorder/post-process.js';
import { formatRecordingHeader, parseRecordingHeader } from '../../src/recorder/recording-meta.js';
import { buildCodegenArgs, resolveStartUrl } from '../../src/recorder/codegen.js';
import type { ResolvedConfig } from '../../src/config/resolve.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '..', 'fixtures', 'codegen-1.62.spec.ts'), 'utf8');

const meta = {
  project: 'demo-shop',
  env: 'staging',
  name: 'checkout-standard',
  recordedAt: '2026-09-03T20:00:00.000Z',
  role: 'standard',
  user: 'standard_user',
  browser: 'chromium',
  playwright: '1.62.1',
};

describe('postProcessRecording', () => {
  const result = postProcessRecording(fixture, {
    meta,
    baseUrls: ['https://www.saucedemo.com', 'https://staging.saucedemo.com'],
  });

  it('rewrites the import, relativises known origins, wraps in describe with tags, marks fragile locators', () => {
    expect(result.code).toContain("from '@automax/core/test'");
    expect(result.code).not.toContain("from '@playwright/test'");
    expect(result.code).toContain("page.goto('/')");
    expect(result.code).toContain("toHaveURL('/inventory.html')");
    expect(result.code).toContain(
      "test.describe(\"checkout-standard\", { tag: ['@recorded', '@ui', '@regression'] }, () => {",
    );
    expect(result.wrapped).toBe(true);
    expect(result.rewrittenUrls).toBe(2);
    // #user-name, #password, [data-test=...], .cart_item, //button → 5 fragile; getByRole/getByTestId are fine
    expect(result.fragileLocators).toBe(5);
    expect(result.code.match(/automax:fragile/g)?.length).toBe(5);
    expect(result.warnings.some((w) => w.includes('https://cdn.example.net/help'))).toBe(true);
  });

  it('writes a parseable header and is idempotent', () => {
    expect(parseRecordingHeader(result.code)).toEqual(meta);
    const again = postProcessRecording(result.code, {
      meta,
      baseUrls: ['https://www.saucedemo.com'],
    });
    expect(again.code).toBe(result.code);
    expect(again.wrapped).toBe(false); // already wrapped
    expect(again.fragileLocators).toBe(0); // already annotated
  });

  it('matches the snapshot for the checked-in codegen 1.62 fixture', () => {
    expect(result.code).toMatchSnapshot();
  });

  it('formats a re-record command in the header', () => {
    const header = formatRecordingHeader({
      ...meta,
      device: 'iPhone 15',
      har: 'checkout-standard',
    });
    expect(header).toContain(
      'automax record -p demo-shop -e staging --name checkout-standard --user standard --device "iPhone 15" --save-har',
    );
  });
});

describe('codegen args', () => {
  const config = {
    project: {
      root: '/repo/projects/demo-shop',
      slug: 'demo-shop',
      testIdAttribute: 'data-test',
      routes: { inventory: '/inventory.html' },
      screenshots: { viewport: { width: 1280, height: 720 } },
    },
    env: {
      name: 'staging',
      ui: { baseUrl: 'https://www.saucedemo.com' },
      aliases: [],
      use: { locale: 'en-US', timezoneId: 'America/New_York' },
    },
    runtime: { repoRoot: '/repo', artifactsDir: '/repo/.automax/runs' },
  } as unknown as ResolvedConfig;

  it('resolves route names, paths and absolute URLs', () => {
    expect(resolveStartUrl(config, 'inventory')).toBe('https://www.saucedemo.com/inventory.html');
    expect(resolveStartUrl(config, '/cart.html')).toBe('https://www.saucedemo.com/cart.html');
    expect(resolveStartUrl(config, 'https://other.example.com/x')).toBe(
      'https://other.example.com/x',
    );
    expect(resolveStartUrl(config)).toBe('https://www.saucedemo.com/');
  });

  it('builds the codegen command line', () => {
    const { args, outputFile, harFile } = buildCodegenArgs({
      config,
      name: 'Checkout Flow',
      url: 'inventory',
      device: 'iPhone 15',
      browser: 'webkit',
      storageStatePath: '/repo/projects/demo-shop/.auth/staging/standard-0.json',
      saveHar: true,
    });
    expect(outputFile).toBe('/repo/projects/demo-shop/recorded/checkout-flow.spec.ts');
    expect(harFile).toBe('/repo/projects/demo-shop/har/staging/checkout-flow.har');
    expect(args).toEqual([
      'playwright',
      'codegen',
      '--target',
      'playwright-test',
      '-o',
      outputFile,
      '--test-id-attribute',
      'data-test',
      '-b',
      'webkit',
      '--load-storage',
      '/repo/projects/demo-shop/.auth/staging/standard-0.json',
      '--device',
      'iPhone 15',
      '--lang',
      'en-US',
      '--timezone',
      'America/New_York',
      '--save-har',
      harFile,
      '--save-har-glob',
      '**/*',
      'https://www.saucedemo.com/inventory.html',
    ]);
    const plain = buildCodegenArgs({ config, name: 'x' });
    expect(plain.args).toContain('--viewport-size');
    expect(plain.args[plain.args.indexOf('--viewport-size') + 1]).toBe('1280,720');
  });
});
