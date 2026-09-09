import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The gate has to decide BEFORE a pool account is leased, and declaration order does
 * not achieve that. Playwright instantiates fixtures in dependency order: `user` is
 * pulled in by `storageState`, which the browser context needs, so the lease ran
 * first no matter where `$sdodsTagGate` sat in the object.
 *
 * Observed on mybotbox-qa: an `@env:local @user:noconsent` scenario run against
 * staging failed with `No users with role "noconsent" in dataset "users"` instead of
 * skipping. 16 of 72 `@env:local` scenarios failed that way — including two that
 * exist to fire a deliberate burst at a rate limiter, which is precisely the kind of
 * scenario the tag is there to keep off a shared environment. With the dependency in
 * place: 72 skipped, 0 failed.
 *
 * A behavioural test would need a real Playwright run against a real pool. This reads
 * the declaration instead, which is where the guarantee actually lives — if someone
 * removes the dependency to tidy up an "unused" parameter, this fails.
 */
const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/fixtures/test.ts'),
  'utf8',
);

/** The destructured dependency list of a fixture, as written in its signature. */
function dependenciesOf(fixture: string): string[] {
  // `$` in `$sdodsTagGate` is a regex metacharacter — escape the name, not the pattern.
  const name = fixture.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const m = new RegExp(String.raw`\n  ${name}: (?:\[\s*)?async \(\{([^}]*)\}`).exec(SOURCE);
  if (!m) throw new Error(`no fixture named "${fixture}" in fixtures/test.ts`);
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('tag gate ordering', () => {
  it('user depends on $sdodsTagGate, so the gate decides before the lease', () => {
    expect(dependenciesOf('user')).toContain('$sdodsTagGate');
  });

  it('the gate itself depends on nothing that could lease or launch', () => {
    // If the gate ever needed `user`, `browser` or `storageState` the dependency
    // would be circular and the ordering guarantee would invert.
    const deps = dependenciesOf('$sdodsTagGate');
    for (const forbidden of ['user', 'browser', 'storageState', 'context', 'page']) {
      expect(deps).not.toContain(forbidden);
    }
  });

  it('storageState still reaches the pool through user, not around it', () => {
    // The ordering only holds while `user` is the single door to the pool. A second
    // fixture leasing directly would bypass the gate again.
    expect(dependenciesOf('storageState')).toContain('user');
    const leases = SOURCE.match(/userPool\.lease\(/g) ?? [];
    expect(leases).toHaveLength(1);
  });
});
