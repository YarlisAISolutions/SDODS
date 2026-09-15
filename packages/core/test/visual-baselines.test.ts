import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EnvConfigSchema,
  ProjectConfigSchema,
  scenarioFiles,
  type VisualFailure,
} from '@sdods/contracts';
import {
  acceptVisualFailures,
  listVisualFailures,
  parseMaskArgument,
  parseVisualError,
  selectVisualFailures,
  visualCheckOptions,
} from '../src/shots/baselines.js';

const policy = {
  mask: ['[data-test="shopping-cart-badge"]'],
  maxDiffPixelRatio: 0.01,
  baselines: {
    inventory: { mask: ['.inventory_item_price'], maxDiffPixelRatio: 0.02 },
    checkout: { mask: ['[data-test="shopping-cart-badge"]'] },
  },
};

describe('visualCheckOptions', () => {
  it('adds the baseline mask and the step mask to the project mask', () => {
    expect(visualCheckOptions('inventory.png', policy, ['.clock'])).toEqual({
      mask: ['[data-test="shopping-cart-badge"]', '.inventory_item_price', '.clock'],
      maxDiffPixelRatio: 0.02,
    });
  });

  it('falls back to the project threshold and drops duplicate selectors', () => {
    expect(visualCheckOptions('checkout', policy)).toEqual({
      mask: ['[data-test="shopping-cart-badge"]'],
      maxDiffPixelRatio: 0.01,
    });
    expect(
      visualCheckOptions('unknown', { ...policy, maxDiffPixelRatio: 0 }).maxDiffPixelRatio,
    ).toBe(0);
  });
});

describe('parseMaskArgument', () => {
  it('splits on commas and trims', () => {
    expect(parseMaskArgument(' .a , [data-test="b"],, ')).toEqual(['.a', '[data-test="b"]']);
  });
});

describe('screenshot config schema', () => {
  const base = {
    slug: 'x',
    name: 'x',
    layers: ['ui'],
    envs: { default: 'local', available: ['local'] },
  };
  it('defaults maxDiffPixelRatio to 0.01 and baselines to none', () => {
    const p = ProjectConfigSchema.parse(base);
    expect(p.screenshots.maxDiffPixelRatio).toBe(0.01);
    expect(p.screenshots.baselines).toEqual({});
  });
  it('accepts per-baseline settings in the project and the env, and rejects a ratio above 1', () => {
    const p = ProjectConfigSchema.parse({
      ...base,
      screenshots: { baselines: { inventory: { mask: ['.x'], maxDiffPixelRatio: 0.05 } } },
    });
    expect(p.screenshots.baselines.inventory).toEqual({ mask: ['.x'], maxDiffPixelRatio: 0.05 });
    expect(() =>
      ProjectConfigSchema.parse({ ...base, screenshots: { maxDiffPixelRatio: 2 } }),
    ).toThrow();
    const env = EnvConfigSchema.parse({
      name: 'ci',
      ui: { baseUrl: 'http://localhost' },
      api: { baseUrl: 'http://localhost' },
      screenshots: { maxDiffPixelRatio: 0.03 },
    });
    expect(env.screenshots?.maxDiffPixelRatio).toBe(0.03);
  });
});

describe('parseVisualError', () => {
  it('reads the pixel count, a size change and a missing baseline', () => {
    const esc = String.fromCharCode(27);
    expect(
      parseVisualError(
        `Error: ${esc}[2mexpect(${esc}[22mpage).toHaveScreenshot(expected) failed\n\n  75372 pixels (ratio 0.09 of all image pixels) are different.`,
      ),
    ).toEqual({ reason: 'changed', diffPixels: 75372 });
    expect(
      parseVisualError('Expected an image 1280px by 720px, received 1280px by 800px.'),
    ).toEqual({ reason: 'size' });
    expect(
      parseVisualError("A snapshot doesn't exist at /x/linux/home.png, writing actual."),
    ).toEqual({ reason: 'missing' });
  });
});

/** Lay out a run directory the way the narrator leaves it. */
function runWith(
  entries: Array<{ retry: number; kind: 'failure' | 'passed'; rp?: string; name?: string }>,
) {
  const runDir = mkdtempSync(join(tmpdir(), 'sdods-visual-run-'));
  for (const e of entries) {
    const rp = e.rp ?? 'shop--ui--chromium';
    const name = e.name ?? 'home';
    const attempt = join(runDir, 'shop', 'fp1', `r${e.retry}`);
    const rel = (phase: 'actual' | 'diff') =>
      `shop/fp1/r${e.retry}/${scenarioFiles.visualImage(rp, name, phase)}`;
    for (const phase of ['actual', 'diff'] as const) {
      const f = join(runDir, rel(phase));
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, `${phase}-${e.retry}-${rp}`);
    }
    const record: VisualFailure = {
      name,
      snapshot: `${name}.png`,
      project: 'shop',
      runnerProject: rp,
      platform: 'linux',
      fingerprint: 'fp1',
      scenarioName: 'Home',
      featureUri: 'features/home.feature',
      retry: e.retry,
      stepIndex: 2,
      reason: 'changed',
      baseline: `features/__screenshots__/${rp}/linux/${name}.png`,
      actual: rel('actual'),
      diff: rel('diff'),
      maxDiffPixelRatio: 0.01,
      recordedAt: '2026-09-14T00:00:00Z',
    };
    const file = join(
      attempt,
      e.kind === 'failure'
        ? scenarioFiles.visualFailure(rp, name)
        : scenarioFiles.visualPassed(rp, name),
    );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(record));
  }
  return runDir;
}

describe('listVisualFailures', () => {
  it('keeps the last attempt of each check, per browser', () => {
    const runDir = runWith([
      { retry: 0, kind: 'failure' },
      { retry: 1, kind: 'failure' },
      { retry: 0, kind: 'failure', rp: 'shop--ui--firefox' },
    ]);
    const list = listVisualFailures(runDir);
    expect(list.map((f) => `${f.runnerProject}:r${f.retry}`)).toEqual([
      'shop--ui--chromium:r1',
      'shop--ui--firefox:r0',
    ]);
  });

  it('drops a check that passed on a later retry', () => {
    const runDir = runWith([
      { retry: 0, kind: 'failure' },
      { retry: 1, kind: 'passed' },
    ]);
    expect(listVisualFailures(runDir)).toEqual([]);
  });

  it('returns nothing for a run directory that does not exist', () => {
    expect(listVisualFailures(join(tmpdir(), 'sdods-no-such-run'))).toEqual([]);
  });
});

describe('selectVisualFailures', () => {
  const runDir = runWith([
    { retry: 0, kind: 'failure' },
    { retry: 0, kind: 'failure', rp: 'shop--ui--firefox' },
    { retry: 0, kind: 'failure', name: 'cart' },
  ]);
  const failures = listVisualFailures(runDir);

  it('matches a name on every browser, or one browser with <target>/<name>', () => {
    expect(selectVisualFailures(failures, { names: ['home.png'] })).toHaveLength(2);
    expect(
      selectVisualFailures(failures, { names: ['shop--ui--firefox/home'] }).map(
        (f) => f.runnerProject,
      ),
    ).toEqual(['shop--ui--firefox']);
    expect(selectVisualFailures(failures, { all: true })).toHaveLength(3);
  });

  it('refuses no selection and names nothing matches', () => {
    expect(() => selectVisualFailures(failures, {})).toThrow(/--all/);
    expect(() => selectVisualFailures(failures, { names: ['nope'] })).toThrow(/nope/);
  });
});

describe('acceptVisualFailures', () => {
  it('copies the actual image to the baseline path, creating the platform directory', () => {
    const runDir = runWith([{ retry: 0, kind: 'failure' }]);
    const projectRoot = mkdtempSync(join(tmpdir(), 'sdods-visual-project-'));
    const [accepted] = acceptVisualFailures({
      runDir,
      failures: listVisualFailures(runDir),
      projectRoot: () => projectRoot,
    });
    const target = join(projectRoot, 'features/__screenshots__/shop--ui--chromium/linux/home.png');
    expect(accepted).toMatchObject({ to: target, created: true, platform: 'linux' });
    expect(readFileSync(target, 'utf8')).toBe('actual-0-shop--ui--chromium');
    expect(accepted!.diff && existsSync(accepted!.diff)).toBe(true);
  });

  it('writes nothing when any entry points outside features/__screenshots__', () => {
    const runDir = runWith([{ retry: 0, kind: 'failure' }]);
    const projectRoot = mkdtempSync(join(tmpdir(), 'sdods-visual-project-'));
    const [good] = listVisualFailures(runDir);
    const bad = { ...good!, name: 'evil', baseline: '../outside.png' };
    expect(() =>
      acceptVisualFailures({ runDir, failures: [good!, bad], projectRoot: () => projectRoot }),
    ).toThrow(/__screenshots__/);
    expect(existsSync(join(projectRoot, 'features'))).toBe(false);
  });
});
