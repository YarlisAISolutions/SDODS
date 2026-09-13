import { describe, expect, it } from 'vitest';
import { SdodsError } from '../src/errors.js';
import { normalizeTagExpr, parseTagExpr } from '../src/config/tags.js';

/**
 * One parser for every place a tag expression selects scenarios. `features list` used to compare
 * the whole expression to each tag, so `@ui and @smoke` listed nothing, and `run` passed a broken
 * expression straight to bddgen, which crashed with a stack trace and a hint about undefined steps.
 */
describe('parseTagExpr', () => {
  it('evaluates boolean expressions', () => {
    const e = parseTagExpr('@ui and (@smoke or @sanity) and not @wip');
    expect(e.evaluate(['@ui', '@smoke'])).toBe(true);
    expect(e.evaluate(['@ui', '@smoke', '@wip'])).toBe(false);
    expect(e.evaluate(['@api', '@smoke'])).toBe(false);
  });

  it('accepts the comma shorthand once normalised', () => {
    expect(parseTagExpr(normalizeTagExpr('@smoke,@sanity')!).evaluate(['@sanity'])).toBe(true);
  });

  for (const bad of ['@smoke and (', 'and', '@a @b', 'not']) {
    it(`rejects "${bad}" as a configuration error`, () => {
      let err: unknown;
      try {
        parseTagExpr(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SdodsError);
      expect((err as SdodsError).exitCode).toBe(2);
      expect((err as SdodsError).message).toContain(bad);
    });
  }
});
