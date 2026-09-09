import { describe, expect, it } from 'vitest';
import { buildSessionLaunch, type ResolvedForBrowser } from '../src/browser/config.js';

/**
 * Getting this mapping wrong is silent: a session that drops the project's test-id attribute or its
 * storage state still runs, it just matches the wrong elements and is logged out. So it is asserted
 * without spawning anything.
 */
const resolved: ResolvedForBrowser = {
  project: {
    slug: 'demo-shop',
    testIdAttribute: 'data-test',
    screenshots: { viewport: { width: 1280, height: 720 } },
    timeouts: { action: 15_000, navigation: 30_000 },
  },
  env: {
    name: 'staging',
    ui: { baseUrl: 'https://www.saucedemo.com' },
    use: { locale: 'en-US', timezoneId: 'America/New_York' },
  },
  runtime: { repoRoot: '/repo', runId: 'run-1', artifactsDir: '/repo/.sdods/runs' },
};

const launch = (spec: Partial<Parameters<typeof buildSessionLaunch>[1]> = {}, opts = {}) =>
  buildSessionLaunch(resolved, { sessionId: 'default', project: 'demo-shop', ...spec }, opts);

describe('buildSessionLaunch', () => {
  it('always isolates the context', () => {
    // Without --isolated the child reuses the existing browser context and every value in
    // contextOptions is silently discarded — storage state, locale, viewport, headers.
    const l = launch();
    expect((l.configFile.browser as any).isolated).toBe(true);
    expect(l.argv).toContain('--isolated');
  });

  it('carries the project test-id attribute and env use options into the context', () => {
    const l = launch();
    expect(l.configFile.testIdAttribute).toBe('data-test');
    const ctxOpts = (l.configFile.browser as any).contextOptions;
    expect(ctxOpts.locale).toBe('en-US');
    expect(ctxOpts.timezoneId).toBe('America/New_York');
    expect(ctxOpts.viewport).toEqual({ width: 1280, height: 720 });
  });

  it('always names the browser explicitly, and maps edge to the msedge channel', () => {
    // The child's own default is chromium on the `chrome` channel — real Google Chrome, which is
    // not on a CI runner and is not what -b chromium means anywhere else in SDODS.
    expect(launch({ browser: 'chromium' }).argv).toContain('chromium');
    expect(launch({ browser: 'edge' }).argv.join(' ')).toContain('--browser msedge');
    expect(launch({ browser: 'firefox' }).argv.join(' ')).toContain('--browser firefox');
  });

  it('maps the mobile profiles to an engine plus a device', () => {
    expect(launch({ browser: 'mobile-safari' }).argv.join(' ')).toContain(
      '--browser webkit --device iPhone 15',
    );
    expect(launch({ browser: 'mobile-chrome' }).argv.join(' ')).toContain(
      '--browser chromium --device Pixel 7',
    );
  });

  it('is headless unless asked otherwise', () => {
    expect(launch().argv).toContain('--headless');
    expect((launch().configFile.browser as any).launchOptions.headless).toBe(true);
    expect(launch({ headed: true }).argv).not.toContain('--headless');
  });

  it('writes artifacts under the run directory, by absolute path', () => {
    const l = launch();
    // Relative paths would resolve against the child's cwd, not the run.
    expect(l.outputDir.startsWith('/repo/.sdods/runs/run-1/browser/')).toBe(true);
    expect(l.configFile.outputDir).toBe(l.outputDir);
  });

  it('leaves origins unrestricted unless the environment declares them', () => {
    // Deriving an allowlist from the app's own baseUrl would block fonts, CDNs, analytics and SSO
    // redirects — and upstream says the flag is not a security boundary.
    expect(launch().configFile.network).toBeUndefined();
    const withOrigins = buildSessionLaunch(
      {
        ...resolved,
        env: { ...resolved.env, ui: { allowedOrigins: ['https://app.example.com/x'] } },
      },
      { sessionId: 'default', project: 'demo-shop' },
    );
    expect((withOrigins.configFile.network as any).allowedOrigins).toEqual([
      'https://app.example.com',
    ]);
  });

  it('keeps secrets on the command line, never in the config file', () => {
    // --secrets is parsed by the child into VALUES; putting it in the config would write those
    // values into a file under .sdods/runs.
    const l = launch({}, { secretsFile: '/repo/.env.staging' });
    expect(l.argv.join(' ')).toContain('--secrets /repo/.env.staging');
    expect(JSON.stringify(l.configFile)).not.toContain('.env.staging');
  });

  it('passes a role storage state through the context', () => {
    const l = launch({ role: 'standard' }, { storageStateFile: '/repo/.sdods/auth/standard.json' });
    expect((l.configFile.browser as any).contextOptions.storageState).toBe(
      '/repo/.sdods/auth/standard.json',
    );
  });

  it('forwards the opt-in packs and response controls', () => {
    const l = launch({ caps: ['vision', 'pdf'], snapshotMode: 'none', images: 'omit' });
    expect(l.argv.join(' ')).toContain('--caps vision,pdf');
    expect(l.argv.join(' ')).toContain('--snapshot-mode none');
    expect(l.argv.join(' ')).toContain('--image-responses omit');
  });
});
