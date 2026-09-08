import { describe, expect, it } from 'vitest';
import { scenarioSkipReason } from '../src/config/tags.js';

/**
 * `@env:`, `@skip:<browser>` and `@flag:` were validated at LINT time and had no
 * runtime path at all — the linter confirmed the tag was spelled correctly and
 * the runner ignored it. `@quarantine` was not a tag the framework knew about,
 * so every recipe excluded it by hand.
 *
 * The assertions below are written in the SKIP direction first. A gate tested
 * only by "an untagged scenario runs" passes when the gate is deleted, which is
 * exactly the state this fixes.
 */

const RUN = undefined;

describe('@env: is an allow list', () => {
  it('skips a scenario tagged for another environment', () => {
    expect(scenarioSkipReason(['@api', '@env:local'], { env: 'staging' })).toMatch(/@env:local/);
  });

  it('runs a scenario tagged for this environment', () => {
    expect(scenarioSkipReason(['@env:staging'], { env: 'staging' })).toBe(RUN);
  });

  it('runs when this environment is one of several named', () => {
    expect(scenarioSkipReason(['@env:local', '@env:staging'], { env: 'staging' })).toBe(RUN);
  });

  it('leaves an untagged scenario unrestricted', () => {
    expect(scenarioSkipReason(['@api', '@smoke'], { env: 'prod-preview' })).toBe(RUN);
  });

  it('names the environment in the reason, so a skipped run can be read', () => {
    expect(scenarioSkipReason(['@env:local'], { env: 'prod-preview' })).toContain('prod-preview');
  });
});

describe('@skip:<browser> is a deny list — the opposite direction', () => {
  it('skips on the named browser', () => {
    expect(scenarioSkipReason(['@skip:webkit'], { env: 'staging', browser: 'webkit' })).toMatch(
      /@skip:webkit/,
    );
  });

  it('runs on any other browser', () => {
    expect(scenarioSkipReason(['@skip:webkit'], { env: 'staging', browser: 'chromium' })).toBe(RUN);
  });

  it('does not gate when no browser is in play (the api layer)', () => {
    expect(scenarioSkipReason(['@skip:webkit'], { env: 'staging' })).toBe(RUN);
  });
});

describe('@quarantine is excluded unless asked for', () => {
  it('skips by default', () => {
    expect(scenarioSkipReason(['@quarantine'], { env: 'staging' })).toMatch(/@quarantine/);
  });

  it('runs when the operator opts in', () => {
    expect(scenarioSkipReason(['@quarantine'], { env: 'staging', quarantine: 'run' })).toBe(RUN);
  });

  it('says how to opt in, in the reason itself', () => {
    expect(scenarioSkipReason(['@quarantine'], { env: 'staging' })).toContain(
      'SDODS_QUARANTINE=run',
    );
  });
});

describe('@flag: gates on what the build actually carries', () => {
  it('skips when the flag is absent from the environment', () => {
    expect(
      scenarioSkipReason(['@flag:video_editor_v1'], { env: 'staging', flags: ['game_builder_v1'] }),
    ).toMatch(/video_editor_v1/);
  });

  it('runs when the flag is present', () => {
    expect(
      scenarioSkipReason(['@flag:game_builder_v1'], { env: 'staging', flags: ['game_builder_v1'] }),
    ).toBe(RUN);
  });

  it('does NOT gate when the environment declares no flag list', () => {
    // An unknown flag list means "not known". Treating it as "nothing is
    // enabled" would silently skip an entire suite the moment an env yaml
    // omitted the key — a gate that fails closed on missing metadata is how a
    // green run comes to mean nothing.
    expect(scenarioSkipReason(['@flag:anything'], { env: 'staging' })).toBe(RUN);
  });

  it('reports every missing flag, not just the first', () => {
    const reason = scenarioSkipReason(['@flag:a', '@flag:b'], { env: 'staging', flags: [] });
    expect(reason).toContain('a');
    expect(reason).toContain('b');
  });
});

describe('precedence', () => {
  it('reports the environment mismatch before anything else', () => {
    // The env is the coarsest reason and the most useful one to see first: if
    // the scenario was never meant to run here, why it is also quarantined is
    // noise.
    const reason = scenarioSkipReason(['@env:local', '@quarantine', '@skip:webkit'], {
      env: 'staging',
      browser: 'webkit',
    });
    expect(reason).toMatch(/@env:local/);
  });
});
