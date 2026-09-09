import { describe, expect, it } from 'vitest';
import {
  coreStepNames,
  coreStepsDir,
  coreStepsGlob,
  coreStepsPatterns,
} from '../src/steps/glob.js';
import { SdodsError } from '../src/errors.js';

// Why this option exists: the core step libraries and a project's own steps share ONE
// namespace, and playwright-bdd fails generation outright when two definitions match the
// same text. 0.3.0 added ten libraries at once, which broke every consumer that had already
// written those phrasings — with no migration path short of rewriting them all in one
// unverified commit. mybotbox-qa hit 67 collisions.

describe('coreStepNames', () => {
  it('lists the libraries in this build by basename', () => {
    const names = coreStepNames();
    // A representative sample rather than the full list: asserting the exact set would fail
    // every time a library is added, which is a thing we want to be easy.
    expect(names).toEqual(expect.arrayContaining(['api', 'ui', 'a11y', 'dom', 'net', 'browser']));
    expect(names).not.toContain('index');
    expect(names.every((n) => !n.includes('.'))).toBe(true);
  });
});

describe('coreStepsPatterns', () => {
  it('with nothing excluded returns exactly the glob that shipped before', () => {
    // The common path must be byte-identical: this option must not change behaviour for
    // the projects that never set it.
    expect(coreStepsPatterns()).toEqual([coreStepsGlob()]);
    expect(coreStepsPatterns([])).toEqual([`${coreStepsDir()}/*.steps.{js,ts}`]);
  });

  it('drops exactly the excluded libraries and keeps the rest', () => {
    const patterns = coreStepsPatterns(['a11y', 'dom']);
    expect(patterns).not.toContain(`${coreStepsDir()}/a11y.steps.{js,ts}`);
    expect(patterns).not.toContain(`${coreStepsDir()}/dom.steps.{js,ts}`);
    expect(patterns).toContain(`${coreStepsDir()}/api.steps.{js,ts}`);
    expect(patterns).toHaveLength(coreStepNames().length - 2);
  });

  it('still loads api and ui when every optional library is excluded', () => {
    // Excluding everything would leave a suite with no steps at all, which is a mistake a
    // project can make; the option does not stop it, but the result must be honest.
    const patterns = coreStepsPatterns(coreStepNames());
    expect(patterns).toEqual([]);
  });

  it('THROWS on a name that is not a library, rather than silently excluding nothing', () => {
    // The whole point. A typo that no-ops leaves the author believing the collision is
    // handled while generation still fails — and the error they then read points at the
    // step, not at the typo.
    expect(() => coreStepsPatterns(['dmo'])).toThrow(SdodsError);
    expect(() => coreStepsPatterns(['dmo'])).toThrow(/does not exist: dmo/);
    try {
      coreStepsPatterns(['dmo']);
    } catch (e) {
      expect((e as SdodsError).code).toBe('CONFIG_INVALID');
      // The hint has to name the real options, or the reader cannot fix the typo.
      expect((e as SdodsError & { hint?: string }).hint ?? '').toContain('dom');
    }
  });

  it('reports every unknown name, not just the first', () => {
    expect(() => coreStepsPatterns(['dmo', 'a11y', 'nett'])).toThrow(/dmo, nett/);
  });
});
